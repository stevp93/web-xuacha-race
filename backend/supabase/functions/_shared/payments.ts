// Única vía por la que cambia el estado de un pago. La usan el webhook de Wompi
// (evento con firma válida) y la conciliación (consulta servidor a servidor a Wompi).
// Debe ejecutarse dentro de una transacción de base de datos.

import { balanceSchedule, cancelPending, enqueue, templates } from './messages.ts';
import { getEvent, mintLinkToken } from './db.ts';
import { addDays, addHours } from './util.ts';

export type TxUpdate = {
  reference: string;
  txId: string;
  status: string;
  amountInCents: number;
  currency: string;
  methodType?: string | null;
  source: 'webhook' | 'reconcile';
};

export const FINAL = new Set(['APPROVED', 'DECLINED', 'VOIDED', 'ERROR']);

export async function audit(tx: any, registrationId: string | null, action: string, detail: unknown) {
  await tx`insert into audit_log (registration_id, action, detail) values (${registrationId}, ${action}, ${tx.json(detail as any)})`;
}

export async function applyTransactionUpdate(
  tx: any,
  u: TxUpdate,
  ctx: { now: Date; siteUrl: string },
): Promise<string> {
  const status = String(u.status).toUpperCase();
  if (!FINAL.has(status) && status !== 'PENDING') return 'ignored_status';

  const [attempt] = await tx`select * from payment_attempts where reference = ${u.reference} for update`;
  if (!attempt) {
    await audit(tx, null, 'unknown_reference', u);
    return 'unknown_reference';
  }
  if (Number(u.amountInCents) !== attempt.amount_cents || u.currency !== attempt.currency) {
    await audit(tx, attempt.registration_id, 'amount_mismatch', { ...u, expected: attempt.amount_cents });
    return 'amount_mismatch';
  }
  if (attempt.status === 'APPROVED') {
    if (status === 'VOIDED') {
      await audit(tx, attempt.registration_id, 'voided_after_approved', u);
      return 'voided_after_approved_review';
    }
    return 'already_approved';
  }
  if (FINAL.has(attempt.status) && status === 'PENDING') return 'stale_pending';

  await tx`
    update payment_attempts
    set status = ${status}, gateway_tx_id = ${u.txId}, method_type = ${u.methodType ?? null}, updated_at = ${ctx.now}
    where id = ${attempt.id}`;

  const [reg] = await tx`select * from registrations where id = ${attempt.registration_id} for update`;
  const [person] = await tx`select * from participants where id = ${reg.participant_id}`;
  const event = await getEvent(tx, reg.event_id);

  if (status === 'PENDING' || status === 'VOIDED') return status.toLowerCase();

  // Enlace con token propio (en el fragmento #, que no viaja a servidores ni a analítica).
  const tokenExpiry = addDays(new Date(`${event.event_date_iso}T23:59:59-05:00`), 2);
  const linkToken = await mintLinkToken(tx, reg.id, tokenExpiry, ctx.now);
  const link = `${ctx.siteUrl}/inscripcion.html#t=${linkToken}`;
  const mctx = { name: person.full_name, eventName: event.name, link };

  if (status === 'DECLINED' || status === 'ERROR') {
    const hour = Math.floor(ctx.now.getTime() / 3600_000);
    await enqueue(tx, {
      registrationId: reg.id, to: person.whatsapp_e164, template: 'payment_failed',
      body: templates.payment_failed(mctx), scheduledAt: ctx.now, dedupeKey: `fail:${reg.id}:${hour}`,
    });
    return status.toLowerCase();
  }

  // --- APPROVED ---
  const [inst] = await tx`select * from installments where id = ${attempt.installment_id} for update`;
  if (inst.status === 'paid') {
    await audit(tx, reg.id, 'duplicate_payment', u);
    return 'duplicate_payment_review';
  }
  if (inst.status === 'void' || !['draft', 'reserved'].includes(reg.status)) {
    await audit(tx, reg.id, 'payment_on_closed_registration', { ...u, registration_status: reg.status });
    return 'late_payment_review';
  }

  await tx`update installments set status = 'paid', paid_attempt_id = ${attempt.id}, paid_at = ${ctx.now} where id = ${inst.id}`;

  // El código de descuento se consume con el primer pago aprobado.
  if (reg.status === 'draft' && reg.promo_code_id) {
    const consumed = await tx`
      update promo_codes set redeemed_count = redeemed_count + 1
      where id = ${reg.promo_code_id} and (max_redemptions is null or redeemed_count < max_redemptions)
      returning id`;
    const over = consumed.length === 0;
    if (over) {
      // Cupo agotado entre la validación y el pago: se respeta el precio cobrado y queda registrado.
      await tx`update promo_codes set overage_count = overage_count + 1 where id = ${reg.promo_code_id}`;
      await audit(tx, reg.id, 'promo_over_limit', { promo_code_id: reg.promo_code_id });
    }
    await tx`
      insert into promo_redemptions (promo_code_id, registration_id, participant_id, over_limit)
      values (${reg.promo_code_id}, ${reg.id}, ${reg.participant_id}, ${over})
      on conflict (registration_id) do nothing`;
  }

  const [{ pending }] = await tx`
    select count(*)::int as pending from installments where registration_id = ${reg.id} and status = 'pending'`;

  await cancelPending(tx, reg.id, ['draft_']);

  if (pending === 0) {
    await tx`
      update registrations
      set status = 'paid', paid_at = ${ctx.now}, reserved_at = coalesce(reserved_at, ${ctx.now}),
          token_expires_at = ${tokenExpiry}, updated_at = ${ctx.now}
      where id = ${reg.id}`;
    await cancelPending(tx, reg.id, ['balance_']);
    await enqueue(tx, {
      registrationId: reg.id, to: person.whatsapp_e164, template: 'paid_full',
      body: templates.paid_full(mctx, reg.total_cents), scheduledAt: ctx.now, dedupeKey: `paid:${reg.id}`,
    });
    await audit(tx, reg.id, 'registration_paid', { source: u.source, reference: u.reference });
    return 'paid';
  }

  await tx`
    update registrations
    set status = 'reserved', reserved_at = ${ctx.now}, token_expires_at = ${tokenExpiry}, updated_at = ${ctx.now}
    where id = ${reg.id}`;
  const [next] = await tx`
    select * from installments where registration_id = ${reg.id} and status = 'pending' order by seq limit 1`;
  const due: Date = next.due_at ?? addDays(ctx.now, 7);
  await enqueue(tx, {
    registrationId: reg.id, to: person.whatsapp_e164, template: 'reserved',
    body: templates.reserved(mctx, inst.amount_cents, next.amount_cents, due),
    scheduledAt: ctx.now, dedupeKey: `reserved:${reg.id}`,
  });
  for (const r of balanceSchedule(ctx.now, due)) {
    const body = r.daysLeft < 0
      ? templates.balance_overdue(mctx, next.amount_cents, addHours(due, event.grace_hours))
      : templates.balance_reminder(mctx, next.amount_cents, due, r.daysLeft);
    await enqueue(tx, {
      registrationId: reg.id, to: person.whatsapp_e164,
      template: r.daysLeft < 0 ? 'balance_overdue' : 'balance_reminder',
      body, scheduledAt: r.at, dedupeKey: `balance:${reg.id}:${r.key}`,
    });
  }
  await audit(tx, reg.id, 'registration_reserved', { source: u.source, reference: u.reference });
  return 'reserved';
}
