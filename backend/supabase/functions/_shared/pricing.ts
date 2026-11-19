// Reglas de precio. El cliente nunca envía montos: todo se calcula aquí.

export type Promo = { type: 'percent' | 'fixed'; value: number };

/** Descuento en centavos, redondeado a pesos enteros y limitado por el piso del evento. */
export function computeDiscount(promo: Promo | null, baseCents: number, minTotalCents: number): number {
  if (!promo) return 0;
  const raw = promo.type === 'percent'
    ? Math.round((baseCents * promo.value) / 100 / 100) * 100
    : promo.value;
  const maxDiscount = Math.max(0, baseCents - minTotalCents);
  return Math.max(0, Math.min(raw, maxDiscount));
}

/** Divide el total en reserva y saldo. El redondeo queda siempre en el saldo. */
export function splitAmounts(totalCents: number, reservePct: number): { reserve: number; balance: number } {
  const reserve = Math.round((totalCents * reservePct) / 100 / 100) * 100;
  return { reserve, balance: totalCents - reserve };
}
