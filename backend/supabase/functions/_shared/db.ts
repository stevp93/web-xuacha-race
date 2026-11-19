// Acceso a datos compartido.

import { ApiError, randomToken, sha256Hex } from './util.ts';

export async function getEvent(tx: any, id: string): Promise<any> {
  const [event] = await tx`
    select *, to_char(event_date, 'YYYY-MM-DD') as event_date_iso from events where id = ${id}`;
  if (!event) throw new ApiError(500, 'CONFIG_ERROR', `Evento ${id} no configurado`);
  return event;
}

/** Crea un token de enlace para mensajes; solo se guarda su hash. */
export async function mintLinkToken(tx: any, registrationId: string, expiresAt: Date, now: Date): Promise<string> {
  const token = randomToken();
  await tx`
    insert into link_tokens (token_hash, registration_id, expires_at, created_at)
    values (${await sha256Hex(token)}, ${registrationId}, ${expiresAt}, ${now})`;
  return token;
}

/** Límite de peticiones por ventana fija. Lanza 429 al superarlo. */
export async function rateLimit(sql: any, key: string, limit: number, windowSec: number, now: Date): Promise<void> {
  const bucket = Math.floor(now.getTime() / 1000 / windowSec);
  const [row] = await sql`
    insert into rate_limits (key, bucket, count) values (${key + ':' + windowSec}, ${bucket}, 1)
    on conflict (key, bucket) do update set count = rate_limits.count + 1
    returning count`;
  if (row.count > limit) throw new ApiError(429, 'RATE_LIMITED', 'Demasiados intentos. Intenta de nuevo en unos minutos.');
}
