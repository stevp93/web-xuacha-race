// Entrada para Node: servidor propio de respaldo. Mismo código que en Supabase.

import { serve } from '@hono/node-server';
import postgres from 'postgres';
import { createApp } from '../supabase/functions/_shared/app.ts';
import { databaseUrl, loadConfig } from '../supabase/functions/_shared/config.ts';

const sql = postgres(databaseUrl(), { prepare: false, max: 5, idle_timeout: 30 });
const app = createApp({ sql, cfg: loadConfig() });
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, () => console.log(`API de cobro en http://0.0.0.0:${port}/api`));
