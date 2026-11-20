// Plantillas de WhatsApp y cola de salida (outbox).
// La API escribe el texto final; n8n solo entrega.

import { addDays, addHours, atBogotaHour, clampToSendWindow, formatCop, formatDateBogota } from './util.ts';

type Ctx = { name: string; eventName: string; link: string };

// Solo el primer nombre, y corto: el texto lo escribe quien se inscribe.
export const first = (fullName: string) => fullName.trim().split(/\s+/)[0].slice(0, 20);

export const templates = {
  draft_reminder: (c: Ctx) =>
    `Hola ${first(c.name)}, tu inscripción a *${c.eventName}* quedó a medias.\n\nRetómala donde la dejaste:\n${c.link}`,
  reserved: (c: Ctx, paid: number, balance: number, due: Date) =>
    `¡Listo, ${first(c.name)}! Recibimos tu reserva de *${formatCop(paid)}* para *${c.eventName}*.\n\nSaldo: *${formatCop(balance)}*\nFecha límite: *${formatDateBogota(due)}*\n\nPuedes pagarlo cuando quieras aquí:\n${c.link}`,
  balance_reminder: (c: Ctx, balance: number, due: Date, daysLeft: number) =>
    `Hola ${first(c.name)}, ${daysLeft === 0 ? '*hoy vence*' : daysLeft === 1 ? '*mañana vence*' : `faltan *${daysLeft} días* para`} el saldo de tu inscripción a *${c.eventName}*.\n\nSaldo: *${formatCop(balance)}*\nFecha límite: *${formatDateBogota(due)}*\n\nPágalo aquí:\n${c.link}`,
  balance_overdue: (c: Ctx, balance: number, graceEnd: Date) =>
    `Hola ${first(c.name)}, el saldo de *${formatCop(balance)}* de tu inscripción a *${c.eventName}* está vencido.\n\nTu cupo se libera el *${formatDateBogota(graceEnd)}* si no registramos el pago:\n${c.link}`,
  paid_full: (c: Ctx, total: number) =>
    `¡Inscripción confirmada, ${first(c.name)}! Recibimos el pago completo de *${formatCop(total)}* para *${c.eventName}*.\n\nTu comprobante y tus datos están aquí:\n${c.link}`,
  payment_failed: (c: Ctx) =>
    `Hola ${first(c.name)}, tu pago para *${c.eventName}* no fue aprobado. No se hizo ningún cobro.\n\nPuedes intentarlo de nuevo aquí:\n${c.link}`,
  reservation_expired: (c: Ctx) =>
    `Hola ${first(c.name)}, el plazo para pagar el saldo de tu inscripción a *${c.eventName}* terminó y el cupo fue liberado. Si necesitas ayuda, responde este mensaje.`,
  otp: (code: string, eventName: string) =>
    `Tu código para retomar la inscripción a *${eventName}* es *${code}*. Vence en 10 minutos. Si no lo pediste, ignora este mensaje.`,
};

export type OutboxRow = {
  registrationId: string | null;
  to: string;
  template: string;
  body: string;
  scheduledAt: Date;
  dedupeKey: string;
};

export async function enqueue(tx: any, row: OutboxRow): Promise<void> {
  await tx`
    insert into notifications_outbox (registration_id, to_e164, template, body, scheduled_at, dedupe_key)
    values (${row.registrationId}, ${row.to}, ${row.template}, ${row.body}, ${row.scheduledAt}, ${row.dedupeKey})
    on conflict (dedupe_key) do nothing`;
}

/** Cancela mensajes pendientes de una inscripción cuya plantilla empieza por alguno de los prefijos. */
export async function cancelPending(tx: any, registrationId: string, prefixes: string[]): Promise<void> {
  for (const p of prefixes) {
    await tx`
      update notifications_outbox set status = 'cancelled'
      where registration_id = ${registrationId} and status = 'pending' and template like ${p + '%'}`;
  }
}

/** Recordatorios del saldo: 7, 3 y 1 día antes, el día del vencimiento y 24 h después. */
export function balanceSchedule(now: Date, due: Date): { key: string; at: Date; daysLeft: number }[] {
  const nine = (d: Date) => atBogotaHour(d, 9);
  const plan = [
    { key: 'd7', at: nine(addDays(due, -7)), daysLeft: 7 },
    { key: 'd3', at: nine(addDays(due, -3)), daysLeft: 3 },
    { key: 'd1', at: nine(addDays(due, -1)), daysLeft: 1 },
    { key: 'd0', at: nine(due), daysLeft: 0 },
    { key: 'overdue', at: clampToSendWindow(addHours(due, 24)), daysLeft: -1 },
  ];
  return plan.filter((p) => p.at.getTime() > now.getTime());
}
