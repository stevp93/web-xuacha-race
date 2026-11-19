// Adaptador de Wompi: firma de integridad, URL del Web Checkout, verificación de eventos
// y consulta de transacciones. Para cambiar de pasarela se reemplaza este archivo.

import { safeEqual, sha256Hex } from './util.ts';

export type WompiConfig = {
  publicKey: string;
  privateKey: string;
  integritySecret: string;
  eventsSecret: string;
  apiBase: string; // https://sandbox.wompi.co/v1 | https://production.wompi.co/v1
};

export const CHECKOUT_URL = 'https://checkout.wompi.co/p/';

/**
 * SHA-256 de: referencia + monto en centavos + moneda + vencimiento + secreto de integridad.
 * Validar en sandbox: si Wompi rechaza la firma, revisar la posición de expirationTime.
 */
export function integritySignature(
  reference: string,
  amountInCents: number,
  currency: string,
  expirationTime: string,
  integritySecret: string,
): Promise<string> {
  return sha256Hex(`${reference}${amountInCents}${currency}${expirationTime}${integritySecret}`);
}

export type CheckoutInput = {
  reference: string;
  amountInCents: number;
  currency: string;
  expirationTime: string; // ISO 8601 UTC
  redirectUrl: string;
  customer: { email: string; fullName: string; phone: string; legalId: string; legalIdType: string };
};

export async function buildCheckoutUrl(cfg: WompiConfig, input: CheckoutInput): Promise<string> {
  const signature = await integritySignature(
    input.reference, input.amountInCents, input.currency, input.expirationTime, cfg.integritySecret,
  );
  const phone = input.customer.phone.replace(/^\+57/, '').replace(/\D/g, '');
  const params: [string, string][] = [
    ['public-key', cfg.publicKey],
    ['currency', input.currency],
    ['amount-in-cents', String(input.amountInCents)],
    ['reference', input.reference],
    ['signature:integrity', signature],
    ['expiration-time', input.expirationTime],
    ['redirect-url', input.redirectUrl],
    ['customer-data:email', input.customer.email],
    ['customer-data:full-name', input.customer.fullName],
    ['customer-data:phone-number', phone],
    ['customer-data:phone-number-prefix', '+57'],
    ['customer-data:legal-id', input.customer.legalId],
    ['customer-data:legal-id-type', input.customer.legalIdType],
  ];
  return CHECKOUT_URL + '?' + params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

export function pick(obj: any, path: string): unknown {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/**
 * Verifica un evento: SHA-256 de los valores de signature.properties (en su orden)
 * + timestamp + secreto de eventos. Se compara con X-Event-Checksum y con signature.checksum.
 */
export async function verifyEvent(event: any, headerChecksum: string | null, eventsSecret: string): Promise<boolean> {
  const props = event?.signature?.properties;
  if (!Array.isArray(props) || props.length === 0 || event?.timestamp == null) return false;
  const values = props.map((p: string) => {
    const v = pick(event.data, p);
    return v == null ? '' : String(v);
  }).join('');
  const expected = await sha256Hex(`${values}${event.timestamp}${eventsSecret}`);
  const candidates = [headerChecksum, event.signature.checksum].filter((c) => typeof c === 'string') as string[];
  if (candidates.length === 0) return false;
  return candidates.every((c) => safeEqual(expected, c.toLowerCase()));
}

export type WompiTx = {
  id: string;
  reference: string;
  status: string;
  amount_in_cents: number;
  currency: string;
  payment_method_type?: string;
};

type FetchLike = (input: string, init?: any) => Promise<any>;

/** Consulta una transacción por id (servidor a servidor). */
export async function fetchTransaction(cfg: WompiConfig, id: string, fetchImpl: FetchLike): Promise<WompiTx | null> {
  if (!/^[\w-]{6,80}$/.test(id)) return null;
  const res = await fetchImpl(`${cfg.apiBase}/transactions/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${cfg.publicKey}` },
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json?.data ?? null;
}

/** Consulta transacciones por referencia. Requiere la llave privada. */
export async function fetchByReference(cfg: WompiConfig, reference: string, fetchImpl: FetchLike): Promise<WompiTx[]> {
  if (!cfg.privateKey) return [];
  const res = await fetchImpl(`${cfg.apiBase}/transactions?reference=${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${cfg.privateKey}` },
  });
  if (!res.ok) return [];
  const json = await res.json();
  return Array.isArray(json?.data) ? json.data : [];
}
