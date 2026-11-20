// Entrada para Node: servidor propio de respaldo. Mismo código que en Supabase.

import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import postgres from 'postgres';
import { createApp } from '../supabase/functions/_shared/app.ts';
import { databaseUrl, env, loadConfig } from '../supabase/functions/_shared/config.ts';

const sql = postgres(databaseUrl(), { prepare: false, max: 5, idle_timeout: 30 });
const port = Number(process.env.PORT ?? 8787);

// IP del cliente para los límites de intentos. Aquí no hay una plataforma que fije el encabezado:
// sin TRUSTED_IP_HEADER se usa la dirección de la conexión, y los encabezados que mande el
// cliente se ignoran. Detrás de un proxy propio (Caddy, Nginx, Cloudflare Tunnel) se indica el
// encabezado que ese proxy escribe: x-real-ip, cf-connecting-ip o x-forwarded-for (se toma el
// último valor, que es el que agregó el proxy).
const trusted = (env('TRUSTED_IP_HEADER') ?? '').trim().toLowerCase();
const clientIp = (c: any): string | undefined => {
  if (trusted) {
    const v = c.req.header(trusted);
    if (v) return trusted === 'x-forwarded-for' ? v.split(',').pop()!.trim() : v.trim();
  }
  return getConnInfo(c).remote.address;
};

const app = createApp({ sql, cfg: loadConfig(), clientIp });

serve({ fetch: app.fetch, port }, () => console.log(`API de cobro en http://0.0.0.0:${port}/api`));
