// Lee la configuración del entorno. Funciona en Deno (Supabase) y en Node.

import type { AppConfig } from './app.ts';

export const env = (name: string): string | undefined =>
  (globalThis as any).Deno?.env?.get(name) ?? (globalThis as any).process?.env?.[name];

export function databaseUrl(): string {
  // Supabase define SUPABASE_DB_URL dentro de las Edge Functions.
  const url = env('DATABASE_URL') ?? env('SUPABASE_DB_URL');
  if (!url) throw new Error('Falta DATABASE_URL (o SUPABASE_DB_URL en Supabase)');
  return url;
}

// Ninguna variable es obligatoria para arrancar: lo que falte queda deshabilitado de forma segura
// (sin llaves de Wompi no hay checkout ni se aceptan eventos; sin llaves propias, las rutas
// internas y de administración responden 401).
export function loadConfig(): AppConfig {
  const siteUrl = (env('SITE_URL') ?? 'https://www.xuacharace.com').replace(/\/+$/, '');
  return {
    eventId: env('EVENT_ID') ?? 'xr2027',
    siteUrl,
    allowedOrigins: (env('ALLOWED_ORIGINS') ?? `${siteUrl},${siteUrl.replace('://www.', '://')}`).split(',').map((s) => s.trim()).filter(Boolean),
    basePath: env('API_BASE_PATH') ?? '/api',
    wompi: {
      publicKey: env('WOMPI_PUBLIC_KEY') ?? '',
      privateKey: env('WOMPI_PRIVATE_KEY') ?? '',
      integritySecret: env('WOMPI_INTEGRITY_SECRET') ?? '',
      eventsSecret: env('WOMPI_EVENTS_SECRET') ?? '',
      apiBase: (env('WOMPI_API_BASE') ?? 'https://sandbox.wompi.co/v1').replace(/\/+$/, ''),
    },
    internalApiKey: env('INTERNAL_API_KEY') ?? '',
    adminApiKey: env('ADMIN_API_KEY') ?? '',
    turnstileSecret: env('TURNSTILE_SECRET') || undefined,
    n8nWebhookUrl: env('N8N_WEBHOOK_URL') || undefined,
  };
}
