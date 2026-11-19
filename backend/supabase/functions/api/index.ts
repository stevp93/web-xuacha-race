// Entrada para Supabase Edge Functions (Deno).
// URL pública: https://<proyecto>.supabase.co/functions/v1/api/...

import postgres from 'postgres';
import * as appMod from '../_shared/app.ts';
import * as config from '../_shared/config.ts';
import * as db from '../_shared/db.ts';
import * as messages from '../_shared/messages.ts';
import * as payments from '../_shared/payments.ts';
import * as pricing from '../_shared/pricing.ts';
import * as util from '../_shared/util.ts';
import * as wompi from '../_shared/wompi.ts';

// Huella del código en ejecución: SHA-256 del texto de todas las funciones y constantes
// de los módulos. /api/health la muestra para comprobar que lo desplegado es lo probado.
async function fingerprint(): Promise<string> {
  const parts: string[] = [];
  const walk = (name: string, v: unknown) => {
    if (typeof v === 'function') parts.push(`${name}=${v.toString()}`);
    else if (v instanceof Set) parts.push(`${name}=${JSON.stringify([...v])}`);
    else if (v && typeof v === 'object') for (const k of Object.keys(v).sort()) walk(`${name}.${k}`, (v as any)[k]);
    else parts.push(`${name}=${String(v)}`);
  };
  walk('m', { appMod, config, db, messages, payments, pricing, util, wompi });
  return (await util.sha256Hex(parts.join('\n'))).slice(0, 16);
}

// prepare:false es necesario con el pooler de Supabase en modo transacción.
const sql = postgres(config.databaseUrl(), { prepare: false, max: 3, idle_timeout: 20 });
const app = appMod.createApp({ sql, cfg: config.loadConfig(), build: await fingerprint() });

Deno.serve(app.fetch);
