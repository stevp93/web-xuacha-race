// Utilidades sin dependencias: corren igual en Deno (Supabase Edge) y en Node 20+.

const encoder = new TextEncoder();

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Comparación en tiempo constante. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return 'rt_' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const SHORT_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // sin 0/O, 1/I/L, U
export function shortId(len = 8): string {
  const buf = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (const b of buf) out += SHORT_ALPHABET[b % SHORT_ALPHABET.length];
  return out;
}

export function otp6(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, '0');
}

/** Normaliza a E.164. Un número de 10 dígitos que empieza por 3 se asume celular colombiano. */
export function normalizePhone(raw: unknown): string {
  const s = String(raw ?? '').trim();
  const digits = s.replace(/\D/g, '');
  if (/^3\d{9}$/.test(digits)) return '+57' + digits;
  if (/^573\d{9}$/.test(digits)) return '+' + digits;
  if (s.startsWith('+') && /^\d{8,15}$/.test(digits)) return '+' + digits;
  throw new ApiError(422, 'VALIDATION_ERROR', 'Número de WhatsApp inválido');
}

export function formatCop(cents: number): string {
  const pesos = Math.round(cents / 100);
  return '$' + String(pesos).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export const BOGOTA_OFFSET_H = -5; // Colombia no tiene horario de verano
export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function toBogota(d: Date): Date {
  return new Date(d.getTime() + BOGOTA_OFFSET_H * 3600_000);
}

/** "3 de abril" en hora de Bogotá. */
export function formatDateBogota(d: Date): string {
  const b = toBogota(d);
  return `${b.getUTCDate()} de ${MONTHS[b.getUTCMonth()]}`;
}

/** Fecha dada, a una hora local de Bogotá. */
export function atBogotaHour(d: Date, hour: number): Date {
  const b = toBogota(d);
  return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate(), hour - BOGOTA_OFFSET_H, 0, 0));
}

/** Mueve un envío a la ventana 8:00–20:00 de Bogotá. */
export function clampToSendWindow(d: Date): Date {
  const h = toBogota(d).getUTCHours();
  if (h < 8) return atBogotaHour(d, 8);
  if (h >= 20) return atBogotaHour(new Date(d.getTime() + 24 * 3600_000), 8);
  return d;
}

export function addHours(d: Date, h: number): Date {
  return new Date(d.getTime() + h * 3600_000);
}
export function addDays(d: Date, n: number): Date {
  return addHours(d, n * 24);
}
