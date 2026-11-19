-- Configuración del evento. EDITAR antes de abrir inscripciones:
-- fecha, precio, fechas del plan en cuotas y catálogo son provisionales
-- (precio y categorías copiados de la edición 2026).
-- registration_open queda en false hasta que estos valores sean los definitivos.

insert into events (
  id, name, event_date, base_cents, reserve_pct,
  balance_due_at, split_closes_at, grace_hours, min_total_cents,
  draft_ttl_days, ref_prefix, catalog, registration_open
) values (
  'xr2027',
  'XUACHA RACE 2027',
  '2027-04-18',                       -- PROVISIONAL
  11000000,                           -- $110.000 en centavos (precio 2026)
  50,                                 -- % de la reserva
  '2027-04-03 23:59:00-05',           -- PROVISIONAL: fecha límite del saldo
  '2027-03-27 23:59:00-05',           -- PROVISIONAL: cierre del plan en 2 cuotas
  48,
  1000000,                            -- total mínimo tras descuentos: $10.000
  7,
  'XR27',
  '{
    "40K": {
      "label": "Competencia 40 km",
      "categories": [
        "Open Femenino (18-29)",
        "Master A Femenino (30+)",
        "Open Masculino (18-29)",
        "Master A Masculino (30-39)",
        "Master B Masculino (40-49)",
        "Master C Masculino (50+)"
      ]
    },
    "25K": {
      "label": "Travesía 25 km",
      "categories": ["Femenino", "Masculino"]
    }
  }'::jsonb,
  false
)
on conflict (id) do nothing;

-- Ejemplos de códigos de descuento (también se crean por POST /api/admin/promo-codes):
-- insert into promo_codes (event_id, code, type, value, max_redemptions, valid_until)
-- values ('xr2027', 'PREVENTA15', 'percent', 15, 100, '2027-01-31 23:59:00-05');
-- insert into promo_codes (event_id, code, type, value, max_redemptions)
-- values ('xr2027', 'CLUB10K', 'fixed', 1000000, 12);
