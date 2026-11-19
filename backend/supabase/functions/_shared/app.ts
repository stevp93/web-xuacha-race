// API de cobro de Xuacha Race. Una sola aplicación Hono que corre en
// Supabase Edge Functions (Deno) y en Node (servidor propio de respaldo).

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getEvent, rateLimit } from './db.ts';
import { cancelPending, enqueue, templates } from './messages.ts';
import { applyTransactionUpdate } from './payments.ts';
import { computeDiscount, splitAmounts } from './pricing.ts';
import {
  addDays, addHours, ApiError, clampToSendWindow, normalizePhone, otp6, randomToken, safeEqual, sha256Hex, shortId,
} from './util.ts';
import { buildCheckoutUrl, fetchByReference, fetchTransaction, verifyEvent, type WompiConfig } from './wompi.ts';

export type AppConfig = {
  eventId: string;
  siteUrl: string;            // https://www.xuacharace.com (sin barra final)
  allowedOrigins: string[];
  basePath: string;           // '/api'
  wompi: WompiConfig;
  internalApiKey: string;     // n8n -> API
  adminApiKey: string;
  turnstileSecret?: string;   // opcional: desafío anti-bot en el paso 1
  n8nWebhookUrl?: string;     // opcional: aviso para entrega inmediata
};

export type Deps = {
  sql: any;                   // cliente postgres.js
  cfg: AppConfig;
  now?: () => Date;
  fetchImpl?: (input: string, init?: any) => Promise<any>;
  build?: string | null;      // huella del código desplegado, visible en /health
};

export const ACTIVE = ['draft', 'reserved', 'paid'];
export const DOC_TYPES = ['CC', 'CE', 'TI', 'PP'];
export const CHECKOUT_TTL_MIN = 30;

export function createApp({ sql, cfg, now = () => new Date(), fetchImpl = (u, i) => fetch(u, i), build }: Deps) {
  const app = new Hono().basePath(cfg.basePath);

  app.use('*', cors({
    origin: (origin) => (cfg.allowedOrigins.includes(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  }));

  app.onError((err: any, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as any);
    }
    if (err?.code === '23505' && String(err?.constraint_name ?? '').includes('registrations_one_active')) {
      return c.json({ error: { code: 'REGISTRATION_EXISTS', message: 'Ya existe una inscripción con este documento.' } }, 409);
    }
    console.error('unhandled', err);
    return c.json({ error: { code: 'INTERNAL', message: 'Error interno' } }, 500);
  });

  // ---------- utilidades ----------

  const clientIp = (c: any): string =>
    (c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown').split(',')[0].trim();

  async function readJson(c: any): Promise<any> {
    try {
      const body = await c.req.json();
      if (body && typeof body === 'object' && !Array.isArray(body)) return body;
    } catch (_) { /* cae abajo */ }
    throw new ApiError(422, 'VALIDATION_ERROR', 'Cuerpo JSON inválido');
  }

  const bad = (message: string) => new ApiError(422, 'VALIDATION_ERROR', message);

  function requireKey(c: any, expected: string) {
    const got = (c.req.header('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!expected || !safeEqual(got, expected)) throw new ApiError(401, 'UNAUTHORIZED', 'No autorizado');
  }

  async function requireAdmin(c: any) {
    const got = (c.req.header('authorization') || '').replace(/^Bearer\s+/i, '');
    if (cfg.adminApiKey && safeEqual(got, cfg.adminApiKey)) return;
    await rateLimit(sql, `adm:${clientIp(c)}`, 10, 900, now());
    throw new ApiError(401, 'UNAUTHORIZED', 'No autorizado');
  }

  /** Autentica por token de reanudación o de enlace y devuelve la inscripción. */
  async function authRegistration(c: any, db: any = sql, lock = false): Promise<any> {
    const token = (c.req.header('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!/^rt_[\w-]{20,}$/.test(token)) throw new ApiError(401, 'TOKEN_INVALID', 'Sesión inválida o vencida');
    const hash = await sha256Hex(token);
    const t = now();
    const [row] = await db`
      select r.id from registrations r
      where (r.resume_token_hash = ${hash} and r.token_expires_at > ${t})
         or r.id in (select registration_id from link_tokens where token_hash = ${hash} and expires_at > ${t})
      limit 1`;
    if (!row) throw new ApiError(401, 'TOKEN_INVALID', 'Sesión inválida o vencida');
    const [reg] = lock
      ? await db`select * from registrations where id = ${row.id} for update`
      : await db`select * from registrations where id = ${row.id}`;
    return reg;
  }

  function publicEvent(event: any, t: Date) {
    const split = splitAmounts(event.base_cents, event.reserve_pct);
    return {
      id: event.id,
      name: event.name,
      event_date: event.event_date_iso,
      currency: event.currency,
      base_cents: event.base_cents,
      reserve_pct: event.reserve_pct,
      reserve_cents: split.reserve,
      balance_due_at: event.balance_due_at,
      split_available: t < event.split_closes_at,
      registration_open: event.registration_open,
      catalog: event.catalog,
    };
  }

  async function view(db: any, reg: any) {
    const t = now();
    const event = await getEvent(db, reg.event_id);
    const [p] = await db`select * from participants where id = ${reg.participant_id}`;
    const inst = await db`select seq, amount_cents, due_at, status, paid_at from installments where registration_id = ${reg.id} order by seq`;
    const [promo] = reg.promo_code_id ? await db`select code, type, value from promo_codes where id = ${reg.promo_code_id}` : [null];
    const next = inst.find((i: any) => i.status === 'pending') ?? null;
    const [last] = await db`select status, reference from payment_attempts where registration_id = ${reg.id} order by created_at desc limit 1`;
    return {
      id: reg.id,
      short_id: reg.short_id,
      status: reg.status,
      step: reg.step,
      plan: reg.plan,
      distance: reg.distance,
      category: reg.category,
      base_cents: reg.base_cents,
      discount_cents: reg.discount_cents,
      total_cents: reg.total_cents,
      paid_cents: inst.filter((i: any) => i.status === 'paid').reduce((s: number, i: any) => s + i.amount_cents, 0),
      promo: promo ? { code: promo.code, type: promo.type, value: promo.value } : null,
      installments: inst,
      next_installment: next && ACTIVE.includes(reg.status) ? next.seq : null,
      last_attempt: last ? { status: last.status, reference: last.reference } : null,
      form_data: reg.form_data,
      participant: {
        full_name: p.full_name, doc_type: p.doc_type, doc_number: p.doc_number,
        email: p.email, whatsapp: p.whatsapp_e164,
      },
      event: publicEvent(event, t),
    };
  }

  /** Valida un código contra el evento y la inscripción. Lanza PROMO_* si no aplica. */
  async function resolvePromo(db: any, event: any, reg: any, code: string) {
    const clean = String(code ?? '').trim();
    if (!/^[\w-]{3,32}$/.test(clean)) throw new ApiError(422, 'PROMO_INVALID', 'Código no válido');
    const t = now();
    const [promo] = await db`
      select * from promo_codes where event_id = ${event.id} and lower(code) = ${clean.toLowerCase()}`;
    if (!promo || !promo.active) throw new ApiError(422, 'PROMO_INVALID', 'Código no válido');
    if ((promo.valid_from && t < promo.valid_from) || (promo.valid_until && t > promo.valid_until)) {
      throw new ApiError(422, 'PROMO_EXPIRED', 'El código no está vigente');
    }
    if (promo.max_redemptions != null && promo.redeemed_count >= promo.max_redemptions) {
      throw new ApiError(422, 'PROMO_EXHAUSTED', 'El código ya agotó sus usos');
    }
    const [{ used }] = await db`
      select count(*)::int as used from promo_redemptions
      where promo_code_id = ${promo.id} and participant_id = ${reg.participant_id} and registration_id <> ${reg.id}`;
    if (used >= promo.per_document_limit) throw new ApiError(422, 'PROMO_INVALID', 'Ya usaste este código');
    if (promo.allowed_doc_number) {
      const [owner] = await db`select doc_number from participants where id = ${reg.participant_id}`;
      if (!owner || owner.doc_number !== promo.allowed_doc_number) {
        throw new ApiError(422, 'PROMO_INVALID', 'Este código es personal y no corresponde a tu documento');
      }
    }
    const scope: string[] = Array.isArray(promo.applies_to) ? promo.applies_to : [];
    if (scope.length && reg.distance && !scope.includes(reg.distance)) {
      throw new ApiError(422, 'PROMO_INVALID', 'El código no aplica a esta distancia');
    }
    if (reg.base_cents < promo.min_total_cents) throw new ApiError(422, 'PROMO_INVALID', 'El código no aplica a este valor');
    const discount = computeDiscount(promo, reg.base_cents, event.min_total_cents);
    return { promo, discount, total: reg.base_cents - discount };
  }

  /** (Re)crea las cuotas pendientes según el plan y el total vigentes. Solo en borrador. */
  async function rebuildInstallments(tx: any, reg: any, event: any, plan: string, total: number) {
    await tx`delete from installments where registration_id = ${reg.id}`;
    if (plan === 'full') {
      await tx`insert into installments (registration_id, seq, amount_cents) values (${reg.id}, 1, ${total})`;
    } else {
      const { reserve, balance } = splitAmounts(total, event.reserve_pct);
      await tx`insert into installments (registration_id, seq, amount_cents) values (${reg.id}, 1, ${reserve})`;
      await tx`insert into installments (registration_id, seq, amount_cents, due_at) values (${reg.id}, 2, ${balance}, ${event.balance_due_at})`;
    }
  }

  function pingN8n() {
    if (!cfg.n8nWebhookUrl) return;
    // Aviso sin espera: si falla, el sondeo periódico de n8n entrega igual.
    fetchImpl(cfg.n8nWebhookUrl, { method: 'POST', headers: { Authorization: `Bearer ${cfg.internalApiKey}` } })
      .catch(() => {});
  }

  // ---------- públicas ----------

  const gatewayReady = () => Boolean(cfg.wompi.publicKey && cfg.wompi.integritySecret && cfg.wompi.eventsSecret);

  app.get('/health', (c) => c.json({
    ok: true, build: build ?? null, gateway_configured: gatewayReady(),
    admin_configured: Boolean(cfg.adminApiKey), internal_configured: Boolean(cfg.internalApiKey),
  }));

  app.get('/event', async (c) => c.json(publicEvent(await getEvent(sql, cfg.eventId), now())));

  // Paso 1: crea el borrador con los cuatro datos mínimos.
  app.post('/registrations', async (c) => {
    const body = await readJson(c);
    const t = now();
    await rateLimit(sql, `reg:${clientIp(c)}`, 10, 3600, t);

    const fullName = String(body.full_name ?? '').trim().replace(/\s+/g, ' ');
    const docType = String(body.doc_type ?? '').toUpperCase();
    const docNumber = String(body.doc_number ?? '').trim().toUpperCase();
    const email = String(body.email ?? '').trim().toLowerCase();
    if (fullName.length < 5 || fullName.length > 120 || !fullName.includes(' ')) throw bad('Escribe nombre y apellido');
    if (!DOC_TYPES.includes(docType)) throw bad('Tipo de documento inválido');
    if (!/^[0-9A-Z]{5,15}$/.test(docNumber)) throw bad('Número de documento inválido');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 160) throw bad('Correo inválido');
    const whatsapp = normalizePhone(body.whatsapp);
    if (body.consent !== true) throw bad('Debes autorizar el tratamiento de datos');

    if (cfg.turnstileSecret) {
      const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: cfg.turnstileSecret, response: String(body.turnstile_token ?? ''), remoteip: clientIp(c) }),
      });
      const out = await res.json().catch(() => ({}));
      if (!out?.success) throw bad('No pudimos verificar que eres una persona. Recarga la página.');
    }

    const token = randomToken();
    const tokenHash = await sha256Hex(token);

    const reg = await sql.begin(async (tx: any) => {
      const event = await getEvent(tx, cfg.eventId);
      if (!event.registration_open) throw new ApiError(409, 'REGISTRATION_CLOSED', 'Las inscripciones no están abiertas');

      let [person] = await tx`
        select * from participants where doc_type = ${docType} and doc_number = ${docNumber} for update`;
      if (person) {
        const [active] = await tx`
          select id from registrations
          where participant_id = ${person.id} and event_id = ${event.id} and status = any(${ACTIVE})`;
        if (active) throw new ApiError(409, 'REGISTRATION_EXISTS', 'Ya existe una inscripción con este documento.');
        [person] = await tx`
          update participants
          set full_name = ${fullName}, email = ${email}, whatsapp_e164 = ${whatsapp}, consent_at = ${t}, updated_at = ${t}
          where id = ${person.id} returning *`;
      } else {
        [person] = await tx`
          insert into participants (doc_type, doc_number, full_name, email, whatsapp_e164, consent_at, created_at, updated_at)
          values (${docType}, ${docNumber}, ${fullName}, ${email}, ${whatsapp}, ${t}, ${t}, ${t})
          on conflict (doc_type, doc_number) do nothing returning *`;
        if (!person) throw new ApiError(409, 'REGISTRATION_EXISTS', 'Ya existe una inscripción con este documento.');
      }

      const [created] = await tx`
        insert into registrations
          (short_id, event_id, participant_id, base_cents, total_cents, resume_token_hash, token_expires_at, created_at, updated_at)
        values
          (${shortId()}, ${event.id}, ${person.id}, ${event.base_cents}, ${event.base_cents}, ${tokenHash},
           ${addDays(t, event.draft_ttl_days)}, ${t}, ${t})
        returning *`;

      // Recordatorios de borrador abandonado: 1 h y 24 h. Se cancelan con el primer pago.
      const link = `${cfg.siteUrl}/inscripcion.html#t=${token}`;
      const text = templates.draft_reminder({ name: fullName, eventName: event.name, link });
      for (const [key, hours] of [['1h', 1], ['24h', 24]] as const) {
        await enqueue(tx, {
          registrationId: created.id, to: whatsapp, template: 'draft_reminder', body: text,
          scheduledAt: clampToSendWindow(addHours(t, hours)), dedupeKey: `draft:${created.id}:${key}`,
        });
      }
      await tx`insert into audit_log (registration_id, action, detail) values (${created.id}, 'registration_created', ${tx.json({ ip: clientIp(c) })})`;
      return created;
    });

    return c.json({ registration_id: reg.id, resume_token: token, registration: await view(sql, reg) }, 201);
  });

  // ---------- participante (Bearer resume_token) ----------

  app.get('/registrations/me', async (c) => c.json(await view(sql, await authRegistration(c))));

  // Guarda paso y datos parciales. Distancia, categoría y código solo cambian en borrador.
  app.patch('/registrations/me', async (c) => {
    const body = await readJson(c);
    const t = now();
    const updated = await sql.begin(async (tx: any) => {
      const reg = await authRegistration(c, tx, true);
      if (!ACTIVE.includes(reg.status)) throw new ApiError(409, 'REGISTRATION_CLOSED', 'La inscripción ya no está activa');
      const event = await getEvent(tx, reg.event_id);
      const patch: any = {};

      if (body.form_data !== undefined) {
        if (!body.form_data || typeof body.form_data !== 'object' || Array.isArray(body.form_data)) throw bad('form_data inválido');
        const merged = { ...reg.form_data, ...body.form_data };
        if (JSON.stringify(merged).length > 4000) throw bad('form_data demasiado grande');
        patch.form_data = merged;
      }
      if (body.step !== undefined) {
        const step = Number(body.step);
        if (!Number.isInteger(step) || step < 2 || step > 4) throw bad('Paso inválido');
        patch.step = step;
      }

      const touchesOrder = ['distance', 'category', 'promo_code'].some((k) => body[k] !== undefined);
      if (touchesOrder) {
        if (reg.status !== 'draft') throw new ApiError(409, 'REGISTRATION_LOCKED', 'La inscripción ya tiene pagos y no se puede modificar');
        const distance = body.distance !== undefined ? String(body.distance) : reg.distance;
        let category = body.category !== undefined ? String(body.category) : reg.category;
        const entry = distance ? event.catalog[distance] : null;
        if (distance && !entry) throw bad('Distancia inválida');
        if (body.distance !== undefined && body.category === undefined && category && !entry.categories.includes(category)) category = null;
        if (category && (!entry || !entry.categories.includes(category))) throw bad('Categoría inválida');
        patch.distance = distance;
        patch.category = category;

        let promoId = reg.promo_code_id;
        let discount = reg.discount_cents;
        const candidate = { ...reg, distance };
        if (body.promo_code !== undefined) {
          if (body.promo_code === null || body.promo_code === '') {
            promoId = null; discount = 0;
          } else {
            await rateLimit(tx, `promo:${reg.id}`, 10, 600, t);
            const r = await resolvePromo(tx, event, candidate, body.promo_code);
            promoId = r.promo.id; discount = r.discount;
          }
        } else if (promoId) {
          // La distancia cambió: el código vigente debe seguir aplicando.
          const [current] = await tx`select code from promo_codes where id = ${promoId}`;
          const r = await resolvePromo(tx, event, candidate, current.code);
          discount = r.discount;
        }
        patch.promo_code_id = promoId;
        patch.discount_cents = discount;
        patch.total_cents = reg.base_cents - discount;
        if (reg.plan) await rebuildInstallments(tx, reg, event, reg.plan, patch.total_cents);
      }

      if (Object.keys(patch).length === 0) return reg;
      patch.updated_at = t;
      if (patch.form_data) patch.form_data = tx.json(patch.form_data);
      const [row] = await tx`update registrations set ${tx(patch)} where id = ${reg.id} returning *`;
      return row;
    });
    return c.json(await view(sql, updated));
  });

  // Cotiza un código sin guardarlo ni consumirlo.
  app.post('/promo/validate', async (c) => {
    const body = await readJson(c);
    const reg = await authRegistration(c);
    await rateLimit(sql, `promo:${reg.id}`, 10, 600, now());
    const event = await getEvent(sql, reg.event_id);
    const r = await resolvePromo(sql, event, reg, body.code);
    return c.json({
      valid: true, code: r.promo.code, type: r.promo.type, value: r.promo.value,
      discount_cents: r.discount, total_cents: r.total,
    });
  });

  // Fija el plan: pago completo o reserva + saldo.
  app.put('/registrations/me/plan', async (c) => {
    const body = await readJson(c);
    const plan = String(body.plan ?? '');
    if (!['full', 'split'].includes(plan)) throw bad('Plan inválido');
    const t = now();
    const updated = await sql.begin(async (tx: any) => {
      const reg = await authRegistration(c, tx, true);
      if (reg.status !== 'draft') throw new ApiError(409, 'REGISTRATION_LOCKED', 'El plan ya no se puede cambiar');
      if (!reg.distance || !reg.category) throw bad('Elige distancia y categoría primero');
      const event = await getEvent(tx, reg.event_id);
      if (plan === 'split' && t >= event.split_closes_at) {
        throw new ApiError(409, 'PLAN_NOT_AVAILABLE', 'El pago en 2 cuotas ya cerró');
      }
      await rebuildInstallments(tx, reg, event, plan, reg.total_cents);
      const [row] = await tx`update registrations set plan = ${plan}, step = 3, updated_at = ${t} where id = ${reg.id} returning *`;
      return row;
    });
    return c.json(await view(sql, updated));
  });

  // Crea un intento de pago y devuelve la URL firmada del Web Checkout.
  app.post('/registrations/me/checkout', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const t = now();
    if (!gatewayReady()) throw new ApiError(503, 'GATEWAY_NOT_CONFIGURED', 'El pago en línea aún no está habilitado.');
    const out = await sql.begin(async (tx: any) => {
      const reg = await authRegistration(c, tx, true);
      await rateLimit(tx, `checkout:${reg.id}`, 12, 3600, t);
      if (!['draft', 'reserved'].includes(reg.status)) throw new ApiError(409, 'INSTALLMENT_NOT_PAYABLE', 'No hay pagos pendientes');
      if (!reg.plan) throw bad('Elige el plan de pago primero');
      const event = await getEvent(tx, reg.event_id);
      if (!event.registration_open && reg.status === 'draft') throw new ApiError(409, 'REGISTRATION_CLOSED', 'Las inscripciones no están abiertas');

      const [inst] = await tx`
        select * from installments where registration_id = ${reg.id} and status = 'pending' order by seq limit 1 for update`;
      if (!inst) throw new ApiError(409, 'INSTALLMENT_NOT_PAYABLE', 'No hay pagos pendientes');
      if (body?.installment != null && Number(body.installment) !== inst.seq) {
        throw new ApiError(409, 'INSTALLMENT_NOT_PAYABLE', 'Esa cuota no está disponible para pago');
      }
      if (inst.due_at && t > addHours(inst.due_at, event.grace_hours)) {
        throw new ApiError(409, 'INSTALLMENT_NOT_PAYABLE', 'El plazo de esta cuota terminó');
      }

      const [{ n }] = await tx`select count(*)::int as n from payment_attempts where installment_id = ${inst.id}`;
      const reference = `${event.ref_prefix}-${reg.short_id}-C${inst.seq}-${n + 1}`;
      const expiresAt = new Date(t.getTime() + CHECKOUT_TTL_MIN * 60_000);
      const [p] = await tx`select * from participants where id = ${reg.participant_id}`;

      await tx`
        insert into payment_attempts (reference, registration_id, installment_id, amount_cents, currency, expires_at, created_at, updated_at)
        values (${reference}, ${reg.id}, ${inst.id}, ${inst.amount_cents}, ${event.currency}, ${expiresAt}, ${t}, ${t})`;

      const checkoutUrl = await buildCheckoutUrl(cfg.wompi, {
        reference,
        amountInCents: inst.amount_cents,
        currency: event.currency,
        expirationTime: expiresAt.toISOString(),
        redirectUrl: `${cfg.siteUrl}/resultado.html`,
        customer: { email: p.email, fullName: p.full_name, phone: p.whatsapp_e164, legalId: p.doc_number, legalIdType: p.doc_type },
      });
      return {
        reference, installment: inst.seq, amount_in_cents: inst.amount_cents, currency: event.currency,
        expires_at: expiresAt.toISOString(), checkout_url: checkoutUrl,
      };
    });
    return c.json(out, 201);
  });

  // Página de resultado: la API consulta la transacción directamente en Wompi.
  // El id que trae el navegador solo indica qué consultar; nunca se confía en su estado.
  app.post('/registrations/me/sync', async (c) => {
    const body = await readJson(c);
    const reg = await authRegistration(c);
    await rateLimit(sql, `sync:${reg.id}`, 30, 600, now());
    const wtx = !gatewayReady() ? null : await fetchTransaction(cfg.wompi, String(body.transaction_id ?? ''), fetchImpl);
    if (wtx) {
      const [own] = await sql`select 1 from payment_attempts where reference = ${wtx.reference} and registration_id = ${reg.id}`;
      if (own) {
        await sql.begin((tx: any) => applyTransactionUpdate(tx, {
          reference: wtx.reference, txId: wtx.id, status: wtx.status, amountInCents: wtx.amount_in_cents,
          currency: wtx.currency, methodType: wtx.payment_method_type, source: 'reconcile',
        }, { now: now(), siteUrl: cfg.siteUrl }));
        pingN8n();
      }
    }
    const [fresh] = await sql`select * from registrations where id = ${reg.id}`;
    return c.json(await view(sql, fresh));
  });

  // ---------- recuperación por documento + código ----------

  app.post('/recovery/request', async (c) => {
    const body = await readJson(c);
    const t = now();
    await rateLimit(sql, `rec:${clientIp(c)}`, 6, 900, t);
    const docType = String(body.doc_type ?? '').toUpperCase();
    const docNumber = String(body.doc_number ?? '').trim().toUpperCase();
    const [person] = await sql`
      select p.* from participants p
      join registrations r on r.participant_id = p.id and r.event_id = ${cfg.eventId} and r.status = any(${ACTIVE})
      where p.doc_type = ${docType} and p.doc_number = ${docNumber}`;
    if (person) {
      const [{ recent }] = await sql`
        select count(*)::int as recent from recovery_codes
        where participant_id = ${person.id} and created_at > ${addHours(t, -1)}`;
      if (recent < 3) {
        const code = otp6();
        const event = await getEvent(sql, cfg.eventId);
        await sql.begin(async (tx: any) => {
          const [row] = await tx`
            insert into recovery_codes (participant_id, code_hash, expires_at, created_at)
            values (${person.id}, ${await sha256Hex(`${person.id}:${code}`)}, ${new Date(t.getTime() + 600_000)}, ${t})
            returning id`;
          await enqueue(tx, {
            registrationId: null, to: person.whatsapp_e164, template: 'otp',
            body: templates.otp(code, event.name), scheduledAt: t, dedupeKey: `otp:${row.id}`,
          });
        });
        pingN8n();
      }
    }
    // Misma respuesta exista o no el documento.
    return c.json({ ok: true, message: 'Si el documento tiene una inscripción activa, enviamos un código al WhatsApp registrado.' }, 202);
  });

  app.post('/recovery/verify', async (c) => {
    const body = await readJson(c);
    const t = now();
    await rateLimit(sql, `recv:${clientIp(c)}`, 15, 900, t);
    const docType = String(body.doc_type ?? '').toUpperCase();
    const docNumber = String(body.doc_number ?? '').trim().toUpperCase();
    const code = String(body.code ?? '').trim();
    const invalid = new ApiError(401, 'OTP_INVALID', 'Código incorrecto o vencido');
    if (!/^\d{6}$/.test(code)) throw invalid;

    const result = await sql.begin(async (tx: any) => {
      const [person] = await tx`select * from participants where doc_type = ${docType} and doc_number = ${docNumber}`;
      if (!person) return null;
      const [rc] = await tx`
        select * from recovery_codes
        where participant_id = ${person.id} and used_at is null and expires_at > ${t} and attempts < 5
        order by created_at desc limit 1 for update`;
      if (!rc) return null;
      const ok = safeEqual(rc.code_hash, await sha256Hex(`${person.id}:${code}`));
      if (!ok) {
        await tx`update recovery_codes set attempts = attempts + 1 where id = ${rc.id}`;
        return null;
      }
      await tx`update recovery_codes set used_at = ${t} where id = ${rc.id}`;
      const [reg] = await tx`
        select * from registrations
        where participant_id = ${person.id} and event_id = ${cfg.eventId} and status = any(${ACTIVE}) for update`;
      if (!reg) return null;
      const event = await getEvent(tx, reg.event_id);
      const token = randomToken();
      const expiry = reg.status === 'draft'
        ? addDays(t, event.draft_ttl_days)
        : addDays(new Date(`${event.event_date_iso}T23:59:59-05:00`), 2);
      // El token anterior queda revocado al reemplazar su hash.
      const [row] = await tx`
        update registrations set resume_token_hash = ${await sha256Hex(token)}, token_expires_at = ${expiry}, updated_at = ${t}
        where id = ${reg.id} returning *`;
      return { token, row };
    });
    if (!result) throw invalid;
    return c.json({ resume_token: result.token, registration: await view(sql, result.row) });
  });

  // ---------- webhook de Wompi ----------

  app.post('/webhooks/wompi', async (c) => {
    let event: any;
    try { event = await c.req.json(); } catch (_) { return c.json({ error: { code: 'BAD_SIGNATURE', message: 'Firma inválida' } }, 401); }
    // Sin secreto de eventos configurado no se acepta ningún evento: una firma con secreto vacío sería falsificable.
    const valid = !!cfg.wompi.eventsSecret && await verifyEvent(event, c.req.header('x-event-checksum') ?? null, cfg.wompi.eventsSecret);
    if (!valid) return c.json({ error: { code: 'BAD_SIGNATURE', message: 'Firma inválida' } }, 401);
    if (event.event !== 'transaction.updated' || !event.data?.transaction) return c.json({ ok: true, result: 'ignored_event' });

    const wtx = event.data.transaction;
    const result = await sql.begin(async (tx: any) => {
      const inserted = await tx`
        insert into webhook_events (gateway, gateway_tx_id, tx_status, checksum, payload, received_at)
        values ('wompi', ${String(wtx.id)}, ${String(wtx.status)}, ${String(event.signature.checksum)}, ${tx.json(event)}, ${now()})
        on conflict (gateway, gateway_tx_id, tx_status) do nothing
        returning id`;
      if (inserted.length === 0) return 'duplicate';
      const r = await applyTransactionUpdate(tx, {
        reference: String(wtx.reference), txId: String(wtx.id), status: String(wtx.status),
        amountInCents: Number(wtx.amount_in_cents), currency: String(wtx.currency),
        methodType: wtx.payment_method_type ?? null, source: 'webhook',
      }, { now: now(), siteUrl: cfg.siteUrl });
      await tx`update webhook_events set result = ${r} where id = ${inserted[0].id}`;
      return r;
    });
    if (result !== 'duplicate') pingN8n();
    // 200 a todo evento con firma válida (incluidos duplicados) para que Wompi no reintente.
    return c.json({ ok: true, result });
  });

  // ---------- internas (n8n, Bearer INTERNAL_API_KEY) ----------

  // Entrega mensajes vencidos y los marca como tomados para que dos sondeos no los dupliquen.
  app.get('/internal/outbox/due', async (c) => {
    requireKey(c, cfg.internalApiKey);
    const t = now();
    const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') ?? 20)));
    const rows = await sql.begin(async (tx: any) => {
      // Mensajes que perdieron sentido por el estado actual de la inscripción.
      await tx`
        update notifications_outbox o set status = 'cancelled'
        from registrations r
        where o.registration_id = r.id and o.status = 'pending' and o.scheduled_at <= ${t}
          and ((o.template like 'draft_%' and r.status <> 'draft') or (o.template like 'balance_%' and r.status <> 'reserved'))`;
      return await tx`
        update notifications_outbox set attempts = attempts + 1, claimed_at = ${t}
        where id in (
          select id from notifications_outbox
          where status = 'pending' and scheduled_at <= ${t}
            and (claimed_at is null or claimed_at < ${new Date(t.getTime() - 600_000)})
          order by scheduled_at limit ${limit} for update skip locked)
        returning id, to_e164, template, body`;
    });
    return c.json({
      messages: rows.map((r: any) => ({ id: r.id, number: r.to_e164.replace('+', ''), template: r.template, text: r.body })),
    });
  });

  app.post('/internal/outbox/:id/ack', async (c) => {
    requireKey(c, cfg.internalApiKey);
    const body = await c.req.json().catch(() => ({}));
    const id = c.req.param('id');
    if (!/^[0-9a-f-]{36}$/.test(id)) throw bad('id inválido');
    const t = now();
    if (body?.ok === true) {
      await sql`update notifications_outbox set status = 'sent', sent_at = ${t} where id = ${id} and status = 'pending'`;
    } else {
      await sql`
        update notifications_outbox
        set status = case when attempts >= 5 then 'failed' else 'pending' end,
            claimed_at = null, scheduled_at = ${new Date(t.getTime() + 300_000)},
            last_error = ${String(body?.error ?? 'error de entrega').slice(0, 500)}
        where id = ${id} and status = 'pending'`;
    }
    return c.body(null, 204);
  });

  // Mantenimiento periódico: vencimientos y conciliación con Wompi.
  app.post('/internal/cron', async (c) => {
    requireKey(c, cfg.internalApiKey);
    const t = now();
    const event = await getEvent(sql, cfg.eventId);

    const expiredDrafts = await sql.begin(async (tx: any) => {
      const rows = await tx`
        update registrations r set status = 'expired', updated_at = ${t}
        where r.event_id = ${event.id} and r.status = 'draft' and r.created_at < ${addDays(t, -event.draft_ttl_days)}
          and not exists (select 1 from payment_attempts a where a.registration_id = r.id and a.status in ('PENDING','APPROVED'))
        returning r.id`;
      for (const r of rows) await cancelPending(tx, r.id, ['draft_']);
      return rows.length;
    });

    const expiredReservations = await sql.begin(async (tx: any) => {
      const rows = await tx`
        select r.id, r.participant_id from registrations r
        join installments i on i.registration_id = r.id and i.status = 'pending' and i.due_at is not null
        where r.event_id = ${event.id} and r.status = 'reserved' and i.due_at < ${addHours(t, -event.grace_hours)}
          and not exists (select 1 from payment_attempts a where a.registration_id = r.id and a.status = 'PENDING')
        for update of r`;
      for (const r of rows) {
        await tx`update installments set status = 'void' where registration_id = ${r.id} and status = 'pending'`;
        await tx`update registrations set status = 'expired', updated_at = ${t} where id = ${r.id}`;
        await cancelPending(tx, r.id, ['balance_']);
        const [p] = await tx`select * from participants where id = ${r.participant_id}`;
        await enqueue(tx, {
          registrationId: r.id, to: p.whatsapp_e164, template: 'reservation_expired',
          body: templates.reservation_expired({ name: p.full_name, eventName: event.name, link: '' }),
          scheduledAt: clampToSendWindow(t), dedupeKey: `expired:${r.id}`,
        });
        await tx`insert into audit_log (registration_id, action) values (${r.id}, 'reservation_expired')`;
      }
      return rows.length;
    });

    // Conciliación: intentos sin estado final entre 15 minutos y 48 horas de antigüedad.
    let reconciled = 0;
    const open = await sql`
      select reference from payment_attempts
      where status in ('CREATED','PENDING') and created_at < ${new Date(t.getTime() - 900_000)} and created_at > ${addHours(t, -48)}
      order by created_at limit 25`;
    for (const a of open) {
      const list = await fetchByReference(cfg.wompi, a.reference, fetchImpl).catch(() => []);
      const best = list.find((x) => x.status === 'APPROVED') ?? list[0];
      if (!best) continue;
      const r = await sql.begin((tx: any) => applyTransactionUpdate(tx, {
        reference: a.reference, txId: best.id, status: best.status, amountInCents: best.amount_in_cents,
        currency: best.currency, methodType: best.payment_method_type, source: 'reconcile',
      }, { now: t, siteUrl: cfg.siteUrl }));
      if (r !== 'ignored_status') reconciled++;
    }

    await sql`delete from rate_limits where bucket < ${Math.floor(t.getTime() / 1000 / 3600) - 48} and key like '%:3600'`;
    await sql`delete from rate_limits where bucket < ${Math.floor(t.getTime() / 1000 / 600) - 288} and key like '%:600'`;
    await sql`delete from rate_limits where bucket < ${Math.floor(t.getTime() / 1000 / 900) - 192} and key like '%:900'`;
    return c.json({ expired_drafts: expiredDrafts, expired_reservations: expiredReservations, reconciled });
  });

  // ---------- administración (Bearer ADMIN_API_KEY) ----------

  const intOrNull = (v: any) => (v == null || v === '' ? null : Number(v));
  const dateOrNull = (v: any) => (v ? new Date(v) : null);
  const textOrNull = (v: any, max: number) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));

  function promoFields(b: any) {
    const type = String(b.type ?? '');
    const value = Number(b.value);
    if (!['percent', 'fixed'].includes(type)) throw bad('type debe ser percent o fixed');
    if (!Number.isInteger(value) || value <= 0 || (type === 'percent' && value > 100)) throw bad('value inválido');
    const max = intOrNull(b.max_redemptions);
    if (max != null && (!Number.isInteger(max) || max <= 0)) throw bad('max_redemptions inválido');
    const doc = textOrNull(b.allowed_doc_number, 15)?.toUpperCase() ?? null;
    if (doc && !/^[0-9A-Z]{5,15}$/.test(doc)) throw bad('allowed_doc_number inválido');
    const from = dateOrNull(b.valid_from), until = dateOrNull(b.valid_until);
    if ((from && isNaN(from.getTime())) || (until && isNaN(until.getTime()))) throw bad('fecha inválida');
    return {
      type, value, max_redemptions: max, per_document_limit: Number(b.per_document_limit ?? 1),
      valid_from: from, valid_until: until, min_total_cents: Number(b.min_total_cents ?? 0),
      applies_to: Array.isArray(b.applies_to) ? b.applies_to.map(String) : [], active: b.active !== false,
      allowed_doc_number: doc, note: textOrNull(b.note, 120),
    };
  }

  // Crea o actualiza un código (también personal: allowed_doc_number).
  app.post('/admin/promo-codes', async (c) => {
    await requireAdmin(c);
    const b = await readJson(c);
    const code = String(b.code ?? '').trim().toUpperCase();
    if (!/^[\w-]{3,32}$/.test(code)) throw bad('code inválido');
    const f = promoFields(b);
    const [row] = await sql`
      insert into promo_codes
        (event_id, code, type, value, max_redemptions, per_document_limit, valid_from, valid_until, min_total_cents,
         applies_to, active, allowed_doc_number, note, batch)
      values
        (${cfg.eventId}, ${code}, ${f.type}, ${f.value}, ${f.max_redemptions}, ${f.per_document_limit}, ${f.valid_from},
         ${f.valid_until}, ${f.min_total_cents}, ${sql.json(f.applies_to)}, ${f.active}, ${f.allowed_doc_number}, ${f.note},
         ${textOrNull(b.batch, 40)})
      on conflict (event_id, lower(code)) do update set
        type = excluded.type, value = excluded.value, max_redemptions = excluded.max_redemptions,
        per_document_limit = excluded.per_document_limit, valid_from = excluded.valid_from, valid_until = excluded.valid_until,
        min_total_cents = excluded.min_total_cents, applies_to = excluded.applies_to, active = excluded.active,
        allowed_doc_number = excluded.allowed_doc_number, note = excluded.note
      returning *`;
    return c.json(row, 201);
  });

  // Genera un lote de códigos únicos de un solo uso (o del cupo indicado).
  app.post('/admin/promo-codes/batch', async (c) => {
    await requireAdmin(c);
    const b = await readJson(c);
    const count = Number(b.count);
    if (!Number.isInteger(count) || count < 1 || count > 500) throw bad('count debe estar entre 1 y 500');
    const prefix = String(b.prefix ?? 'XR').trim().toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(prefix)) throw bad('prefix inválido (2 a 12 letras o números)');
    const f = promoFields({ ...b, max_redemptions: b.max_redemptions ?? 1, allowed_doc_number: null });
    const batch = textOrNull(b.batch, 40) ?? `${prefix}-${now().toISOString().slice(0, 19).replace(/[-:T]/g, '')}`;
    const rows = await sql.begin(async (tx: any) => {
      const out: any[] = [];
      let guard = 0;
      while (out.length < count && guard++ < count * 5) {
        const code = `${prefix}-${shortId(6)}`;
        const [row] = await tx`
          insert into promo_codes
            (event_id, code, type, value, max_redemptions, per_document_limit, valid_from, valid_until, min_total_cents,
             applies_to, active, note, batch)
          values
            (${cfg.eventId}, ${code}, ${f.type}, ${f.value}, ${f.max_redemptions}, ${f.per_document_limit}, ${f.valid_from},
             ${f.valid_until}, ${f.min_total_cents}, ${tx.json(f.applies_to)}, true, ${f.note}, ${batch})
          on conflict (event_id, lower(code)) do nothing
          returning code`;
        if (row) out.push(row.code);
      }
      return out;
    });
    return c.json({ batch, count: rows.length, codes: rows }, 201);
  });

  // Lista de códigos con su uso.
  app.get('/admin/promo-codes', async (c) => {
    await requireAdmin(c);
    const batch = c.req.query('batch') || null;
    const rows = await sql`
      select pc.code, pc.type, pc.value, pc.max_redemptions, pc.redeemed_count, pc.overage_count, pc.valid_until,
             pc.applies_to, pc.active, pc.allowed_doc_number, pc.note, pc.batch, pc.created_at,
             (select count(*)::int from registrations r where r.promo_code_id = pc.id and r.status = 'draft') as applied_unpaid
      from promo_codes pc
      where pc.event_id = ${cfg.eventId} and (${batch}::text is null or pc.batch = ${batch})
      order by pc.created_at desc, pc.code
      limit 2000`;
    return c.json({ codes: rows });
  });

  // Libro de pagos: una fila por pago aprobado, para cruzar con el reporte de Wompi por referencia.
  app.get('/admin/ledger', async (c) => {
    await requireAdmin(c);
    const rows = await sql`
      select a.reference, a.gateway_tx_id, a.updated_at as paid_at, a.amount_cents, a.method_type, i.seq as installment,
             r.short_id, r.status as registration_status, r.plan, r.distance, r.category,
             r.base_cents, r.discount_cents, r.total_cents,
             p.full_name, p.doc_type, p.doc_number, p.email, p.whatsapp_e164, pc.code as promo_code
      from payment_attempts a
      join installments i on i.id = a.installment_id
      join registrations r on r.id = a.registration_id
      join participants p on p.id = r.participant_id
      left join promo_codes pc on pc.id = r.promo_code_id
      where r.event_id = ${cfg.eventId} and a.status = 'APPROVED'
      order by a.updated_at`;
    return c.json({ payments: rows });
  });

  // Control: inscripciones cuyo estado no cuadra con lo cobrado y casos marcados para revisión.
  app.get('/admin/control', async (c) => {
    await requireAdmin(c);
    const rows = await sql`
      select r.short_id, r.status, r.total_cents, p.full_name, p.doc_number,
        coalesce((select sum(a.amount_cents) from payment_attempts a where a.registration_id = r.id and a.status = 'APPROVED'), 0)::int as collected_cents,
        coalesce((select sum(i.amount_cents) from installments i where i.registration_id = r.id and i.status = 'paid'), 0)::int as paid_installments_cents
      from registrations r join participants p on p.id = r.participant_id
      where r.event_id = ${cfg.eventId}
      order by r.short_id`;
    const problemOf = (r: any): string | null => {
      if (r.collected_cents !== r.paid_installments_cents) return 'Lo cobrado no coincide con las cuotas marcadas como pagadas';
      if (r.status === 'paid' && r.collected_cents !== r.total_cents) return 'Pagada, pero el cobro no coincide con el total';
      if (r.status === 'reserved' && (r.collected_cents <= 0 || r.collected_cents >= r.total_cents)) return 'Reservada con cobro inconsistente';
      if (r.status === 'draft' && r.collected_cents > 0) return 'Borrador con dinero cobrado';
      return null;
    };
    const mismatches = rows.map((r: any) => ({ ...r, problem: problemOf(r) })).filter((r: any) => r.problem);
    // Reservas de inscripciones vencidas o canceladas: no son un error, pero es dinero que hay que tener identificado.
    const retained = rows.filter((r: any) => ['expired', 'cancelled'].includes(r.status) && r.collected_cents > 0 && !problemOf(r));
    const review = await sql`
      select l.at, l.action, r.short_id, l.detail
      from audit_log l left join registrations r on r.id = l.registration_id
      where l.action in ('duplicate_payment','amount_mismatch','voided_after_approved','payment_on_closed_registration','promo_over_limit','unknown_reference')
      order by l.at desc limit 200`;
    return c.json({ ok: mismatches.length === 0 && review.length === 0, mismatches, retained, review });
  });

  app.get('/admin/summary', async (c) => {
    await requireAdmin(c);
    const byStatus = await sql`
      select status, count(*)::int as n from registrations where event_id = ${cfg.eventId} group by status order by status`;
    const [money] = await sql`
      select coalesce(sum(a.amount_cents), 0)::bigint as collected_cents, count(*)::int as approved_payments
      from payment_attempts a join registrations r on r.id = a.registration_id
      where r.event_id = ${cfg.eventId} and a.status = 'APPROVED'`;
    const [pending] = await sql`
      select coalesce(sum(i.amount_cents), 0)::bigint as receivable_cents
      from installments i join registrations r on r.id = i.registration_id
      where r.event_id = ${cfg.eventId} and r.status = 'reserved' and i.status = 'pending'`;
    const byDistance = await sql`
      select coalesce(distance, 'sin elegir') as distance, count(*)::int as n from registrations
      where event_id = ${cfg.eventId} and status in ('reserved','paid') group by 1 order by 1`;
    return c.json({
      registrations: byStatus, by_distance: byDistance,
      collected_cents: Number(money.collected_cents), approved_payments: money.approved_payments,
      receivable_cents: Number(pending.receivable_cents),
    });
  });

  return app;
}
