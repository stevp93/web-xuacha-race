// Pruebas de integración contra PostgreSQL real.
//   TEST_DATABASE_URL=postgres://usuario@host:puerto/postgres npm test
// Crea y destruye una base temporal; no toca datos existentes.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import postgres from 'postgres';
import { createApp, type AppConfig } from '../supabase/functions/_shared/app.ts';
import { sha256Hex } from '../supabase/functions/_shared/util.ts';

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/postgres';
const DB = 'xr_test_' + Date.now();
const root = new URL('..', import.meta.url).pathname;

const cfg: AppConfig = {
  eventId: 'xr2027',
  siteUrl: 'https://www.xuacharace.com',
  allowedOrigins: ['https://www.xuacharace.com'],
  basePath: '/api',
  wompi: {
    publicKey: 'pub_test_abc', privateKey: 'prv_test_abc',
    integritySecret: 'test_integrity_SECRET', eventsSecret: 'test_events_SECRET',
    apiBase: 'https://sandbox.wompi.co/v1',
  },
  internalApiKey: 'internal-key', adminApiKey: 'admin-key',
};

let admin: any, sql: any, app: any;
let clock = new Date('2027-01-10T15:00:00Z'); // 10:00 en Bogotá
const wompiTx = new Map<string, any>();       // transacciones que "existen" en Wompi
const fetchImpl = async (url: string) => {
  const byId = url.match(/\/transactions\/([^/?]+)$/);
  if (byId) {
    const tx = wompiTx.get(decodeURIComponent(byId[1]));
    return { ok: !!tx, json: async () => ({ data: tx }) };
  }
  const byRef = url.match(/\/transactions\?reference=(.+)$/);
  if (byRef) {
    const ref = decodeURIComponent(byRef[1]);
    return { ok: true, json: async () => ({ data: [...wompiTx.values()].filter((t) => t.reference === ref) }) };
  }
  return { ok: false, json: async () => ({}) };
};

before(async () => {
  admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${DB}`);
  const u = new URL(ADMIN_URL);
  u.pathname = '/' + DB;
  sql = postgres(u.toString(), { max: 5, onnotice: () => {} });
  await sql.unsafe(readFileSync(root + 'supabase/migrations/20261116000000_init.sql', 'utf8'));
  await sql.unsafe(readFileSync(root + 'supabase/migrations/20261116000100_promo_personal.sql', 'utf8'));
  await sql.unsafe(readFileSync(root + 'supabase/migrations/20261116000200_indexes.sql', 'utf8'));
  await sql.unsafe(readFileSync(root + 'supabase/seed.sql', 'utf8'));
  await sql`update events set registration_open = true`;
  app = createApp({ sql, cfg, now: () => clock, fetchImpl });
});

after(async () => {
  await sql.end();
  await admin.unsafe(`drop database ${DB}`);
  await admin.end();
});

// ---------- ayudas ----------

let ipSeq = 0;
async function call(method: string, path: string, opts: { body?: any; token?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${++ipSeq % 250}`, ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await app.request('/api' + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

let docSeq = 1000000;
async function newRegistration(overrides: any = {}) {
  const doc = String(++docSeq);
  const r = await call('POST', '/registrations', {
    body: { full_name: 'Ana Prueba', doc_type: 'CC', doc_number: doc, email: `ana${doc}@ejemplo.com`, whatsapp: '3001234567', consent: true, ...overrides },
  });
  return { ...r, doc, token: r.json?.resume_token as string };
}

async function readyToPay(plan: 'full' | 'split', promo?: string) {
  const reg = await newRegistration();
  const patch: any = { distance: '40K', category: 'Open Masculino (18-29)' };
  if (promo) patch.promo_code = promo;
  const p = await call('PATCH', '/registrations/me', { token: reg.token, body: patch });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  const pl = await call('PUT', '/registrations/me/plan', { token: reg.token, body: { plan } });
  assert.equal(pl.status, 200, JSON.stringify(pl.json));
  return reg;
}

let txSeq = 0;
async function wompiEvent(reference: string, amount: number, status = 'APPROVED', opts: { tamper?: boolean; txId?: string } = {}) {
  const id = opts.txId ?? `tx-${++txSeq}`;
  const timestamp = 1700000000 + txSeq;
  const transaction = { id, reference, status, amount_in_cents: amount, currency: 'COP', payment_method_type: 'NEQUI' };
  wompiTx.set(id, transaction);
  const checksum = await sha256Hex(`${id}${status}${amount}${timestamp}${cfg.wompi.eventsSecret}`);
  const event = {
    event: 'transaction.updated',
    data: { transaction: opts.tamper ? { ...transaction, amount_in_cents: amount - 100 } : transaction },
    signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'], checksum },
    timestamp,
  };
  const res = await call('POST', '/webhooks/wompi', { body: event, headers: { 'x-event-checksum': checksum } });
  return { ...res, id };
}

const checkout = (token: string) => call('POST', '/registrations/me/checkout', { token, body: {} });
const me = (token: string) => call('GET', '/registrations/me', { token });
const outbox = (regId: string) => sql`select template, status, scheduled_at from notifications_outbox where registration_id = ${regId} order by scheduled_at, template`;

// ---------- pruebas ----------

test('crea borrador con datos mínimos y valida entradas', async () => {
  const r = await newRegistration();
  assert.equal(r.status, 201);
  assert.match(r.token, /^rt_/);
  assert.equal(r.json.registration.status, 'draft');
  assert.equal(r.json.registration.total_cents, 11000000);
  assert.equal(r.json.registration.participant.whatsapp, '+573001234567');

  for (const bad of [{ consent: false }, { email: 'no-es-correo' }, { whatsapp: '123' }, { full_name: 'Ana' }, { doc_type: 'XX' }]) {
    const e = await newRegistration(bad);
    assert.equal(e.status, 422, JSON.stringify(bad));
    assert.equal(e.json.error.code, 'VALIDATION_ERROR');
  }
});

test('una cédula no puede tener dos inscripciones activas', async () => {
  const a = await newRegistration();
  const again = await call('POST', '/registrations', {
    body: { full_name: 'Otro Nombre', doc_type: 'CC', doc_number: a.doc, email: 'otro@ejemplo.com', whatsapp: '3009999999', consent: true },
  });
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, 'REGISTRATION_EXISTS');
  // Los datos del titular original no cambian.
  assert.equal((await me(a.token)).json.participant.full_name, 'Ana Prueba');
});

test('un token inválido o ajeno no da acceso', async () => {
  assert.equal((await me('rt_' + 'x'.repeat(43))).status, 401);
  assert.equal((await call('GET', '/registrations/me')).status, 401);
});

test('plan en 2 cuotas: reserva + saldo suman el total y el checkout va firmado', async () => {
  const reg = await readyToPay('split');
  const v = (await me(reg.token)).json;
  assert.deepEqual(v.installments.map((i: any) => i.amount_cents), [5500000, 5500000]);
  assert.equal(v.next_installment, 1);

  const c = await checkout(reg.token);
  assert.equal(c.status, 201);
  assert.match(c.json.reference, /^XR27-[A-Z0-9]{8}-C1-1$/);
  const url = new URL(c.json.checkout_url);
  assert.equal(url.origin + url.pathname, 'https://checkout.wompi.co/p/');
  assert.equal(url.searchParams.get('amount-in-cents'), '5500000');
  assert.equal(url.searchParams.get('redirect-url'), 'https://www.xuacharace.com/resultado.html');
  const expected = await sha256Hex(`${c.json.reference}5500000COP${c.json.expires_at}${cfg.wompi.integritySecret}`);
  assert.equal(url.searchParams.get('signature:integrity'), expected);
  assert.ok(!c.json.checkout_url.includes(cfg.wompi.integritySecret));

  // Cada intento genera una referencia nueva.
  assert.match((await checkout(reg.token)).json.reference, /-C1-2$/);
});

test('webhook con firma alterada: 401 y ningún cambio de estado', async () => {
  const reg = await readyToPay('split');
  const c = await checkout(reg.token);
  const bad = await wompiEvent(c.json.reference, 5500000, 'APPROVED', { tamper: true });
  assert.equal(bad.status, 401);
  assert.equal((await me(reg.token)).json.status, 'draft');
  const [{ n }] = await sql`select count(*)::int as n from webhook_events where gateway_tx_id = ${bad.id}`;
  assert.equal(n, 0);
});

test('webhook con monto distinto al guardado no aprueba la cuota', async () => {
  const reg = await readyToPay('split');
  const c = await checkout(reg.token);
  const r = await wompiEvent(c.json.reference, 100, 'APPROVED');
  assert.equal(r.status, 200);
  assert.equal(r.json.result, 'amount_mismatch');
  assert.equal((await me(reg.token)).json.status, 'draft');
});

test('reserva aprobada: estado, recordatorios programados e idempotencia', async () => {
  const reg = await readyToPay('split');
  const c = await checkout(reg.token);
  const first = await wompiEvent(c.json.reference, 5500000, 'APPROVED', { txId: 'tx-idem' });
  assert.equal(first.json.result, 'reserved');
  const dup = await wompiEvent(c.json.reference, 5500000, 'APPROVED', { txId: 'tx-idem' });
  assert.equal(dup.status, 200);
  assert.equal(dup.json.result, 'duplicate');

  const v = (await me(reg.token)).json;
  assert.equal(v.status, 'reserved');
  assert.equal(v.paid_cents, 5500000);
  assert.equal(v.next_installment, 2);

  const rows = await outbox(v.id);
  const count = (t: string, s: string) => rows.filter((r: any) => r.template === t && r.status === s).length;
  assert.equal(count('reserved', 'pending'), 1, 'una sola confirmación pese al evento duplicado');
  assert.equal(count('balance_reminder', 'pending'), 4, '7, 3, 1 y 0 días');
  assert.equal(count('balance_overdue', 'pending'), 1);
  assert.equal(count('draft_reminder', 'cancelled'), 2, 'recordatorios de borrador cancelados');
  // Todos los recordatorios caen entre 8:00 y 20:00 de Bogotá.
  for (const r of rows.filter((x: any) => x.template.startsWith('balance_'))) {
    const h = (new Date(r.scheduled_at).getUTCHours() + 19) % 24;
    assert.ok(h >= 8 && h < 20, `hora ${h}`);
  }
  // Con pagos registrados ya no se puede cambiar la distancia ni el plan.
  assert.equal((await call('PATCH', '/registrations/me', { token: reg.token, body: { distance: '25K' } })).status, 409);
  assert.equal((await call('PUT', '/registrations/me/plan', { token: reg.token, body: { plan: 'full' } })).status, 409);
});

test('pagar el saldo completa la inscripción y cancela los recordatorios', async () => {
  const reg = await readyToPay('split');
  const c1 = await checkout(reg.token);
  await wompiEvent(c1.json.reference, 5500000);
  const c2 = await checkout(reg.token);
  assert.match(c2.json.reference, /-C2-1$/);
  const r = await wompiEvent(c2.json.reference, 5500000);
  assert.equal(r.json.result, 'paid');

  const v = (await me(reg.token)).json;
  assert.equal(v.status, 'paid');
  assert.equal(v.paid_cents, 11000000);
  assert.equal(v.next_installment, null);
  const rows = await outbox(v.id);
  assert.equal(rows.filter((x: any) => x.template.startsWith('balance_') && x.status === 'pending').length, 0);
  assert.equal(rows.filter((x: any) => x.template === 'paid_full').length, 1);
  assert.equal((await checkout(reg.token)).status, 409);
});

test('pago completo en una sola transacción', async () => {
  const reg = await readyToPay('full');
  const c = await checkout(reg.token);
  assert.equal(c.json.amount_in_cents, 11000000);
  assert.equal((await wompiEvent(c.json.reference, 11000000)).json.result, 'paid');
  assert.equal((await me(reg.token)).json.status, 'paid');
});

test('pago rechazado: sigue en borrador y avisa una sola vez por hora', async () => {
  const reg = await readyToPay('full');
  const a = await checkout(reg.token);
  await wompiEvent(a.json.reference, 11000000, 'DECLINED');
  const b = await checkout(reg.token);
  await wompiEvent(b.json.reference, 11000000, 'ERROR');
  const v = (await me(reg.token)).json;
  assert.equal(v.status, 'draft');
  assert.equal((await outbox(v.id)).filter((x: any) => x.template === 'payment_failed').length, 1);
});

test('códigos de descuento: porcentaje, monto fijo, piso y errores', async () => {
  const admin = { headers: { authorization: 'Bearer admin-key' } };
  assert.equal((await call('POST', '/admin/promo-codes', { body: { code: 'X', type: 'percent', value: 10 } })).status, 401);
  for (const body of [
    { code: 'PREVENTA15', type: 'percent', value: 15 },
    { code: 'CLUB10K', type: 'fixed', value: 1000000 },
    { code: 'GRATIS', type: 'percent', value: 100 },
    { code: 'VENCIDO', type: 'percent', value: 10, valid_until: '2026-12-31T00:00:00Z' },
    { code: 'SOLO25', type: 'percent', value: 10, applies_to: ['25K'] },
  ]) assert.equal((await call('POST', '/admin/promo-codes', { body, ...admin })).status, 201);

  const reg = await newRegistration();
  const set = (body: any) => call('PATCH', '/registrations/me', { token: reg.token, body });
  await set({ distance: '40K', category: 'Open Femenino (18-29)' });

  const quote = await call('POST', '/promo/validate', { token: reg.token, body: { code: 'preventa15' } });
  assert.deepEqual([quote.json.discount_cents, quote.json.total_cents], [1650000, 9350000]);
  assert.equal((await me(reg.token)).json.discount_cents, 0, 'validar no guarda ni consume');

  assert.equal((await set({ promo_code: 'CLUB10K' })).json.total_cents, 10000000);
  assert.equal((await set({ promo_code: 'GRATIS' })).json.total_cents, 1000000, 'respeta el piso del evento');
  assert.equal((await set({ promo_code: 'VENCIDO' })).json.error.code, 'PROMO_EXPIRED');
  assert.equal((await set({ promo_code: 'SOLO25' })).json.error.code, 'PROMO_INVALID');
  assert.equal((await set({ promo_code: 'NOEXISTE' })).json.error.code, 'PROMO_INVALID');

  // El descuento se aplica al total y luego se divide; el redondeo queda en el saldo.
  await set({ promo_code: 'PREVENTA15' });
  const v = (await call('PUT', '/registrations/me/plan', { token: reg.token, body: { plan: 'split' } })).json;
  assert.deepEqual(v.installments.map((i: any) => i.amount_cents), [4675000, 4675000]);
  assert.equal((await set({ promo_code: null })).json.installments.map((i: any) => i.amount_cents).join(), '5500000,5500000');
});

test('un código con cupo 1 pagado por dos personas se consume una sola vez', async () => {
  await call('POST', '/admin/promo-codes', { body: { code: 'UNICO', type: 'fixed', value: 500000, max_redemptions: 1 }, headers: { authorization: 'Bearer admin-key' } });
  const a = await readyToPay('full', 'UNICO');
  const b = await readyToPay('full', 'UNICO');
  const [ca, cb] = [await checkout(a.token), await checkout(b.token)];
  const results = await Promise.all([wompiEvent(ca.json.reference, 10500000), wompiEvent(cb.json.reference, 10500000)]);
  assert.deepEqual(results.map((r) => r.json.result), ['paid', 'paid'], 'se respeta el precio ya cobrado');
  const [p] = await sql`select redeemed_count, overage_count from promo_codes where code = 'UNICO'`;
  assert.deepEqual([p.redeemed_count, p.overage_count], [1, 1]);
  // Un tercero ya no puede aplicarlo.
  const c = await newRegistration();
  const r = await call('PATCH', '/registrations/me', { token: c.token, body: { distance: '25K', category: 'Femenino', promo_code: 'UNICO' } });
  assert.equal(r.json.error.code, 'PROMO_EXHAUSTED');
});

test('recuperación por cédula y código: emite token nuevo y revoca el anterior', async () => {
  const reg = await newRegistration();
  const unknown = await call('POST', '/recovery/request', { body: { doc_type: 'CC', doc_number: '99999999' } });
  const known = await call('POST', '/recovery/request', { body: { doc_type: 'CC', doc_number: reg.doc } });
  assert.equal(unknown.status, 202);
  assert.deepEqual(known.json, unknown.json, 'misma respuesta exista o no el documento');

  const [msg] = await sql`select body from notifications_outbox where template = 'otp' order by created_at desc limit 1`;
  const code = msg.body.match(/\*(\d{6})\*/)[1];
  const wrong = await call('POST', '/recovery/verify', { body: { doc_type: 'CC', doc_number: reg.doc, code: code === '000000' ? '000001' : '000000' } });
  assert.equal(wrong.status, 401);
  const ok = await call('POST', '/recovery/verify', { body: { doc_type: 'CC', doc_number: reg.doc, code } });
  assert.equal(ok.status, 200);
  assert.equal((await me(ok.json.resume_token)).status, 200);
  assert.equal((await me(reg.token)).status, 401, 'token anterior revocado');
  // El código no se puede reutilizar.
  assert.equal((await call('POST', '/recovery/verify', { body: { doc_type: 'CC', doc_number: reg.doc, code } })).status, 401);
});

test('el enlace enviado por WhatsApp permite retomar en el paso guardado', async () => {
  const reg = await readyToPay('split');
  await call('PATCH', '/registrations/me', { token: reg.token, body: { step: 3, form_data: { emergencia: 'Luis 3000000000' } } });
  await wompiEvent((await checkout(reg.token)).json.reference, 5500000);
  const v0 = (await me(reg.token)).json;
  const [msg] = await sql`select body from notifications_outbox where registration_id = ${v0.id} and template = 'reserved'`;
  const linkToken = msg.body.match(/#t=(rt_[\w-]+)/)[1];
  assert.notEqual(linkToken, reg.token);
  const v = (await me(linkToken)).json;
  assert.equal(v.step, 3);
  assert.equal(v.form_data.emergencia, 'Luis 3000000000');
  assert.equal(v.status, 'reserved');
});

test('cola de mensajes: exige llave, entrega una vez y confirma', async () => {
  assert.equal((await call('GET', '/internal/outbox/due')).status, 401);
  const key = { headers: { authorization: 'Bearer internal-key' } };
  const first = await call('GET', '/internal/outbox/due?limit=50', key);
  assert.ok(first.json.messages.length > 0);
  assert.ok(first.json.messages.every((m: any) => /^57\d{10}$/.test(m.number) && m.text.length > 10));
  const second = await call('GET', '/internal/outbox/due?limit=50', key);
  const firstIds = new Set(first.json.messages.map((m: any) => m.id));
  assert.ok(second.json.messages.every((m: any) => !firstIds.has(m.id)), 'un mensaje tomado no se entrega dos veces');

  const [m1, m2] = first.json.messages;
  assert.equal((await call('POST', `/internal/outbox/${m1.id}/ack`, { body: { ok: true }, ...key })).status, 204);
  await call('POST', `/internal/outbox/${m2.id}/ack`, { body: { ok: false, error: 'timeout' }, ...key });
  const rows = await sql`select id, status, last_error from notifications_outbox where id in ${sql([m1.id, m2.id])}`;
  assert.equal(rows.find((r: any) => r.id === m1.id).status, 'sent');
  assert.deepEqual([rows.find((r: any) => r.id === m2.id).status, rows.find((r: any) => r.id === m2.id).last_error], ['pending', 'timeout']);
});

test('página de resultado: un id ajeno o inventado no marca nada como pagado', async () => {
  const victim = await readyToPay('full');
  const vc = await checkout(victim.token);
  const paidTx = await wompiEvent(vc.json.reference, 11000000);
  const attacker = await readyToPay('full');
  await checkout(attacker.token);
  for (const id of [paidTx.id, 'inventado-123456']) {
    const r = await call('POST', '/registrations/me/sync', { token: attacker.token, body: { transaction_id: id } });
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'draft');
  }
});

test('conciliación: si el webhook no llega, el estado se recupera consultando a Wompi', async () => {
  const reg = await readyToPay('full');
  const c = await checkout(reg.token);
  wompiTx.set('tx-perdido', { id: 'tx-perdido', reference: c.json.reference, status: 'APPROVED', amount_in_cents: 11000000, currency: 'COP' });
  const r = await call('POST', '/registrations/me/sync', { token: reg.token, body: { transaction_id: 'tx-perdido' } });
  assert.equal(r.json.status, 'paid');

  const reg2 = await readyToPay('full');
  const c2 = await checkout(reg2.token);
  wompiTx.set('tx-perdido-2', { id: 'tx-perdido-2', reference: c2.json.reference, status: 'APPROVED', amount_in_cents: 11000000, currency: 'COP' });
  const saved = clock;
  clock = new Date(clock.getTime() + 20 * 60_000);
  const cron = await call('POST', '/internal/cron', { headers: { authorization: 'Bearer internal-key' } });
  clock = saved;
  assert.ok(cron.json.reconciled >= 1);
  assert.equal((await me(reg2.token)).json.status, 'paid');
});

test('vencimientos: checkout del saldo bloqueado tras la gracia y cupo liberado por el cron', async () => {
  const reg = await readyToPay('split');
  await wompiEvent((await checkout(reg.token)).json.reference, 5500000);
  const saved = clock;
  const [ev] = await sql`select balance_due_at from events`;

  clock = new Date(ev.balance_due_at.getTime() + 24 * 3600_000); // dentro de las 48 h de gracia
  assert.equal((await checkout(reg.token)).status, 201);
  clock = new Date(ev.balance_due_at.getTime() + 49 * 3600_000);
  assert.equal((await checkout(reg.token)).json.error.code, 'INSTALLMENT_NOT_PAYABLE');

  clock = new Date(ev.balance_due_at.getTime() + 100 * 3600_000); // sin intentos PENDING recientes
  const cron = await call('POST', '/internal/cron', { headers: { authorization: 'Bearer internal-key' } });
  assert.ok(cron.json.expired_reservations >= 1);
  const [row] = await sql`select r.status from registrations r join participants p on p.id = r.participant_id where p.doc_number = ${reg.doc}`;
  assert.equal(row.status, 'expired');

  // El plan en cuotas deja de ofrecerse después del cierre.
  clock = new Date('2027-03-28T15:00:00Z');
  const late = await newRegistration();
  await call('PATCH', '/registrations/me', { token: late.token, body: { distance: '25K', category: 'Masculino' } });
  assert.equal((await call('PUT', '/registrations/me/plan', { token: late.token, body: { plan: 'split' } })).json.error.code, 'PLAN_NOT_AVAILABLE');
  assert.equal((await call('PUT', '/registrations/me/plan', { token: late.token, body: { plan: 'full' } })).status, 200);
  clock = saved;
});

test('límite de peticiones y CORS', async () => {
  let last = 0;
  for (let i = 0; i < 12; i++) {
    const r = await call('POST', '/registrations', { body: {}, headers: { 'x-forwarded-for': '203.0.113.9' } });
    last = r.status;
  }
  assert.equal(last, 429);
  const ok = await app.request('/api/event', { headers: { origin: 'https://www.xuacharace.com' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://www.xuacharace.com');
  const evil = await app.request('/api/event', { headers: { origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
});

const adminH = { headers: { authorization: 'Bearer admin-key' } };

test('código personal: solo lo usa el documento autorizado', async () => {
  const owner = await newRegistration();
  const other = await newRegistration();
  const made = await call('POST', '/admin/promo-codes', { body: { code: 'PARA-ANA', type: 'percent', value: 50, max_redemptions: 1, allowed_doc_number: owner.doc, note: 'Cortesía' }, ...adminH });
  assert.equal(made.status, 201);
  const body = { distance: '25K', category: 'Femenino', promo_code: 'para-ana' };
  const denied = await call('PATCH', '/registrations/me', { token: other.token, body });
  assert.equal(denied.json.error.code, 'PROMO_INVALID');
  const ok = await call('PATCH', '/registrations/me', { token: owner.token, body });
  assert.equal(ok.json.total_cents, 5500000);
});

test('lote de códigos de un solo uso: únicos, listados y con su uso', async () => {
  assert.equal((await call('POST', '/admin/promo-codes/batch', { body: { count: 5, prefix: 'CLUB', type: 'fixed', value: 2000000 } })).status, 401);
  const b = await call('POST', '/admin/promo-codes/batch', { body: { count: 25, prefix: 'club', type: 'fixed', value: 2000000, note: 'Club Soacha' }, ...adminH });
  assert.equal(b.status, 201);
  assert.equal(new Set(b.json.codes).size, 25);
  assert.ok(b.json.codes.every((c: string) => /^CLUB-[A-Z0-9]{6}$/.test(c)));
  assert.equal((await call('POST', '/admin/promo-codes/batch', { body: { count: 501, prefix: 'X1', type: 'fixed', value: 1 }, ...adminH })).status, 422);

  // Se usa uno: pagado por una persona, rechazado para la siguiente.
  const code = b.json.codes[0];
  const a = await readyToPay('full', code);
  await wompiEvent((await checkout(a.token)).json.reference, 9000000);
  const second = await newRegistration();
  const r = await call('PATCH', '/registrations/me', { token: second.token, body: { distance: '25K', category: 'Masculino', promo_code: code } });
  assert.equal(r.json.error.code, 'PROMO_EXHAUSTED');

  const list = await call('GET', `/admin/promo-codes?batch=${encodeURIComponent(b.json.batch)}`, adminH);
  assert.equal(list.json.codes.length, 25);
  assert.equal(list.json.codes.filter((x: any) => x.redeemed_count === 1).length, 1);
  assert.ok(list.json.codes.every((x: any) => x.max_redemptions === 1 && x.note === 'Club Soacha'));
});

test('libro de pagos y control: cuadran, y el control detecta lo que no cuadra', async () => {
  const reg = await readyToPay('split');
  const c1 = await checkout(reg.token);
  await wompiEvent(c1.json.reference, 5500000);

  const ledger = await call('GET', '/admin/ledger', adminH);
  const row = ledger.json.payments.find((p: any) => p.reference === c1.json.reference);
  assert.ok(row, 'el pago aparece en el libro');
  assert.deepEqual([row.amount_cents, row.installment, row.registration_status, row.doc_number], [5500000, 1, 'reserved', reg.doc]);
  const [{ total }] = await sql`select coalesce(sum(amount_cents),0)::int as total from payment_attempts where status = 'APPROVED'`;
  assert.equal(ledger.json.payments.reduce((s: number, p: any) => s + p.amount_cents, 0), total);
  const summary = await call('GET', '/admin/summary', adminH);
  assert.equal(summary.json.collected_cents, total);
  assert.ok(summary.json.receivable_cents >= 5500000);

  const before = await call('GET', '/admin/control', adminH);
  assert.equal(before.json.mismatches.length, 0, JSON.stringify(before.json.mismatches.map((m: any) => [m.status, m.total_cents, m.collected_cents])));

  assert.ok(before.json.retained.every((r: any) => r.status === 'expired' && r.collected_cents === 5500000), 'reservas retenidas aparte');

  // Se fuerza una inconsistencia directamente en la base: pagada sin haber cobrado el saldo.
  const v = (await me(reg.token)).json;
  await sql`update registrations set status = 'paid' where id = ${v.id}`;
  const after = await call('GET', '/admin/control', adminH);
  assert.equal(after.json.ok, false);
  assert.deepEqual(after.json.mismatches.map((m: any) => m.short_id), [v.short_id]);
  assert.deepEqual([after.json.mismatches[0].total_cents, after.json.mismatches[0].collected_cents], [11000000, 5500000]);
  await sql`update registrations set status = 'reserved' where id = ${v.id}`;
});

test('administración: la llave errada se bloquea tras varios intentos', async () => {
  let last = 0;
  for (let i = 0; i < 12; i++) {
    last = (await call('GET', '/admin/summary', { headers: { authorization: 'Bearer mala', 'x-forwarded-for': '198.51.100.7' } })).status;
  }
  assert.equal(last, 429);
  assert.equal((await call('GET', '/admin/summary', adminH)).status, 200);
});

test('pasarela sin configurar: no hay checkout y ningún evento es aceptado', async () => {
  const bare = createApp({ sql, cfg: { ...cfg, wompi: { ...cfg.wompi, publicKey: '', integritySecret: '', eventsSecret: '' }, adminApiKey: '', internalApiKey: '' }, now: () => clock, fetchImpl });
  const reg = await readyToPay('full');
  const h = { 'content-type': 'application/json', authorization: `Bearer ${reg.token}` };
  const co = await bare.request('/api/registrations/me/checkout', { method: 'POST', headers: h, body: '{}' });
  assert.equal(co.status, 503);
  // Evento "firmado" con secreto vacío: debe rechazarse.
  const ts = 1800000000, id = 'tx-forjado';
  const checksum = await sha256Hex(`${id}APPROVED11000000${ts}`);
  const ev = { event: 'transaction.updated', data: { transaction: { id, reference: 'XR27-X-C1-1', status: 'APPROVED', amount_in_cents: 11000000, currency: 'COP' } },
    signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'], checksum }, timestamp: ts };
  const wh = await bare.request('/api/webhooks/wompi', { method: 'POST', headers: { 'content-type': 'application/json', 'x-event-checksum': checksum }, body: JSON.stringify(ev) });
  assert.equal(wh.status, 401);
  // Sin llaves propias, administración e internas quedan cerradas incluso con Bearer vacío.
  for (const path of ['/api/admin/summary', '/api/internal/outbox/due']) {
    assert.equal((await bare.request(path, { headers: { authorization: 'Bearer ' } })).status, 401, path);
  }
  const health = await (await bare.request('/api/health')).json();
  assert.deepEqual([health.gateway_configured, health.admin_configured, health.internal_configured], [false, false, false]);
});
