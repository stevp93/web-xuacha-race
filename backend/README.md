# Xuacha Race · sistema de cobro

API de inscripciones y pagos con Wompi (Web Checkout alojado), cobro en 2 cuotas
(reserva + saldo), recordatorios por WhatsApp vía n8n + Evolution API, reanudación
del proceso y códigos de descuento.

> **Pasarela de pagos: pendiente de definir (noviembre de 2026).** El adaptador implementado y
> probado es el de Wompi (`_shared/wompi.ts`), elegido en el análisis de costos frente a ePayco.
> La decisión final no está tomada: mientras no se configuren las llaves de una pasarela,
> `POST /api/checkout` responde 503 y las inscripciones siguen cerradas (`registration_open = false`).
> Si se elige otra plataforma, basta con escribir un adaptador equivalente (firma de integridad,
> verificación de eventos y consulta de transacciones) y enlazarlo en `_shared/app.ts` (rutas de checkout y webhook) y `_shared/config.ts` (llaves);
> `_shared/payments.ts` ya es independiente de la pasarela;
> el resto del sistema (cuotas, conciliación, panel, recordatorios) no cambia.

El mismo código corre en dos lugares:

| Dónde | Entrada | Uso |
| --- | --- | --- |
| Supabase Edge Functions (Deno) | `supabase/functions/api/index.ts` | Principal |
| Servidor propio (Node 22 / Docker) | `node/server.ts` | Respaldo |

```
backend/
  supabase/migrations/   esquema PostgreSQL
  supabase/seed.sql      configuración del evento (precio, fechas, categorías)
  supabase/functions/    API (Hono) — _shared/ es el código común
  node/                  servidor de respaldo, Docker y script de backup
  n8n/xuacha-cobro.json  flujo de entrega por WhatsApp y mantenimiento
  tests/                 pruebas de integración
../inscripcion.html, ../resultado.html, ../admin.html, ../assets/   formulario web y panel
```

## Estado del despliegue (16 de noviembre de 2026)

Proyecto de Supabase **Pasarela pagos Xuacha Race 2027** (`bxtmachwamcfugodthef`):

- Base de datos: las tres migraciones aplicadas y el evento `xr2027` creado con `registration_open = false`.
- Función `api` desplegada: `https://bxtmachwamcfugodthef.supabase.co/functions/v1/api`
- `GET /api/health` devuelve `build`, la huella del código en ejecución. La versión probada es
  `7fa9370e36885299`; para calcular la huella local: `npm run bundle` y arrancar el resultado con Deno.

Falta, en este orden:

1. **Secretos** (Supabase → Edge Functions → Secrets): `ADMIN_API_KEY` e `INTERNAL_API_KEY`
   (generarlas con `openssl rand -hex 32`), y las cuatro llaves de Wompi cuando exista la cuenta.
   Sin ellas la API arranca, pero el panel, n8n y el pago quedan deshabilitados; `/api/health` indica
   qué falta (`admin_configured`, `internal_configured`, `gateway_configured`).
2. **Evento**: corregir fecha, precio y fechas del plan en cuotas, y abrir inscripciones:
   `update events set registration_open = true where id = 'xr2027';`
3. **Sitio**: publicar `inscripcion.html`, `resultado.html`, `admin.html` y `assets/` (git push).

## 1. Configurar el evento

Editar `supabase/seed.sql`: fecha, `base_cents` (precio en centavos), `reserve_pct`,
`balance_due_at`, `split_closes_at` y el catálogo de distancias y categorías.
Los valores incluidos son provisionales (precio y categorías de 2026).
`registration_open` queda en `false` hasta que se cambie a `true`.

Cambiar el precio más adelante es un `update events set base_cents = ...`;
las inscripciones ya creadas conservan el precio con el que se crearon.

## 2. Desplegar en Supabase

```bash
cd backend
supabase link --project-ref TU-PROYECTO
supabase db push                                   # crea las tablas
psql "$DATABASE_URL" -f supabase/seed.sql          # o pegar seed.sql en el SQL Editor
cp .env.example .env                               # llenar llaves; no subir al repositorio
supabase secrets set --env-file .env
supabase functions deploy api --no-verify-jwt
curl https://TU-PROYECTO.supabase.co/functions/v1/api/health
```

En Supabase no hace falta `DATABASE_URL`: la plataforma entrega `SUPABASE_DB_URL` a la función.

## 3. Configurar Wompi

1. En el panel de comercios, sección de desarrolladores: copiar llave pública, llave privada,
   secreto de integridad y secreto de eventos a `.env` (primero las de sandbox).
2. URL de eventos: `https://TU-PROYECTO.supabase.co/functions/v1/api/webhooks/wompi`
   (una por ambiente).
3. Solicitar a soporte de Wompi la activación de 3D Secure, una solicitud para sandbox y
   otra para producción.
4. Al pasar a producción: llaves `pub_prod_`/`prv_prod_`. Si `WOMPI_API_BASE` no se define,
   la API la deduce de la llave pública (producción para `pub_prod_`, sandbox para el resto).
   `GET /api/health` muestra `gateway_env` y marca `gateway_mismatch: true` si la llave y la
   API quedaron de entornos distintos.

## 4. Conectar el formulario

Editar `../assets/js/xr-config.js` con la URL de la API. Para activar el formulario en el
sitio, en `index.html` reemplazar el formulario de Google:

```js
const GOOGLE_FORM_URL = 'inscripcion.html';
```

## 5. n8n y WhatsApp

Importar `n8n/xuacha-cobro.json`. Llenar el nodo **Config** (URL de la API,
`INTERNAL_API_KEY`, URL, instancia y apikey de Evolution API) y el nodo **Mantenimiento**
(misma URL y llave). El flujo:

- cada 2 minutos lee `GET /internal/outbox/due`, envía por Evolution API y confirma con `ack`;
- cada hora llama `POST /internal/cron` (vencimientos y conciliación con Wompi);
- opcional: poner la URL del webhook **Aviso de la API** en `N8N_WEBHOOK_URL` para que las
  confirmaciones salgan al instante.

El cuerpo del nodo **Enviar WhatsApp** usa el formato de Evolution API v2
(`{ number, text }`). En v1 cambiarlo a `{ number, textMessage: { text } }`.

Actualizar también el prompt del agente de WhatsApp: el de 2026 prohíbe mencionar Wompi
y enlaces de pago.

## 6. Servidor de respaldo

```bash
cd backend/node
docker compose up -d --build        # usa ../.env con DATABASE_URL apuntando a Supabase
```

Publicarlo con HTTPS detrás de un proxy y poner esa URL en `fallbackApiBase` de
`xr-config.js`. Definir `TRUSTED_IP_HEADER` con el encabezado que escribe ese proxy
(`x-real-ip`, `x-forwarded-for` o `cf-connecting-ip`): sin él, la API usa la dirección de la
conexión y, detrás de un proxy, todos los visitantes compartirían el mismo límite de intentos.
En Supabase no hace falta: Cloudflare fija la IP y rechaza la que mande el cliente. El formulario pasa al respaldo solo si la API principal no responde
(error de red o 502/503/504). Ambas APIs usan la misma base, así que no hay datos divididos.

- Si caen las Edge Functions, Wompi reintenta el evento (30 min, 3 h, 24 h) y, mientras
  tanto, la página de resultado y el cron concilian consultando a Wompi desde el respaldo.
- Si cae la base de Supabase: restaurar el último respaldo en el Postgres local
  (`docker compose --profile standalone up -d`, `pg_restore`) y apuntar `DATABASE_URL` allí.
  `node/backup.sh` genera los respaldos; programarlo con cron.

## 7. Códigos de descuento

```bash
curl -X POST "$API/admin/promo-codes" -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"code":"PREVENTA15","type":"percent","value":15,"max_redemptions":100,"valid_until":"2027-01-31T23:59:00-05:00"}'

curl -X POST "$API/admin/promo-codes" -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"code":"CLUB10K","type":"fixed","value":1000000,"max_redemptions":12,"applies_to":["40K"]}'

curl "$API/admin/summary" -H "Authorization: Bearer $ADMIN_API_KEY"   # recaudo y casos por revisar
```

`value` es el porcentaje (1–100) o el monto en centavos. Repetir el `POST` con el mismo
código lo actualiza; `"active": false` lo apaga.

## 8. Panel de administración

`admin.html` (pide la `ADMIN_API_KEY`; la guarda solo en la pestaña abierta):

- **Resumen**: recaudado, saldos por cobrar, inscripciones por estado y cupos por distancia.
- **Códigos**: lotes de códigos de un solo uso, códigos atados a un documento, CSV, QR por
  código (PNG) y hoja de QR para imprimir. El QR abre `inscripcion.html?codigo=XXXX` y el
  formulario aplica el código solo.
- **Pagos**: libro de pagos aprobados con CSV, para cruzar por referencia con el reporte de Wompi.
- **Control**: inscripciones cuyo estado no cuadra con lo cobrado, casos para revisión manual
  (pago duplicado, monto distinto, anulaciones) y reservas retenidas de inscripciones vencidas.

Un código de un solo uso se consume cuando se aprueba el primer pago. Mientras está aplicado
en una inscripción sin pagar aparece como "Aplicado sin pagar". Los códigos personales solo
los acepta el documento indicado.

## 9. Pruebas

```bash
cd backend && npm install
TEST_DATABASE_URL=postgres://usuario@localhost:5432/postgres npm test
```

Crean una base temporal y la eliminan. Cubren firma alterada, idempotencia, monto
distinto, cuotas, recordatorios, códigos, recuperación, conciliación y vencimientos, y las
regresiones de la auditoría de seguridad (37 pruebas).

### De extremo a extremo (navegador)

```bash
pip install playwright && playwright install chromium
E2E_PG=postgres://usuario@localhost:5432 tests/e2e/run.sh
```

Levanta una base limpia, la API con y sin pasarela, un simulador de Wompi
(`tests/e2e/mock-wompi.mjs`: checkout que valida la firma de integridad y webhooks firmados) y
el sitio; recorre con Chromium el sitio público, la inscripción completa (pago total, reserva y
saldo, rechazo, pago pendiente, retomar por enlace y por código, empezar de nuevo, otra persona
en el mismo dispositivo), el panel (códigos, QR, CSV, libro, control) y casos de ataque (HTML y
fórmulas en el nombre, webhooks alterados, códigos agotados o apagados). 21 pruebas; las
capturas quedan en `tests/e2e/shots/`.

## Rutas

| Método y ruta (`/api`) | Autenticación |
| --- | --- |
| `GET /event`, `GET /health` | pública |
| `POST /registrations` | pública; 30 por hora por IP y 5 por día por número de WhatsApp |
| `GET`/`PATCH /registrations/me`, `PUT /registrations/me/plan` | token de inscripción |
| `POST /registrations/me/checkout`, `POST /registrations/me/sync`, `POST /promo/validate` | token de inscripción |
| `POST /recovery/request`, `POST /recovery/verify` | pública, con límite por IP |
| `POST /webhooks/wompi` | firma SHA-256 del evento |
| `GET /internal/outbox/due`, `POST /internal/outbox/:id/ack`, `POST /internal/cron` | `INTERNAL_API_KEY` |
| `POST /admin/promo-codes`, `POST /admin/promo-codes/batch`, `GET /admin/promo-codes` | `ADMIN_API_KEY` |
| `GET /admin/summary`, `GET /admin/ledger`, `GET /admin/control` | `ADMIN_API_KEY` |

## Seguridad

Auditoría y pruebas de extremo a extremo del 20 de noviembre de 2026 (detalle en `CHANGELOG.md`):

- **Montos y estados**: el navegador nunca envía montos; los pagos solo cambian por un evento
  con firma válida o por consulta servidor a servidor. Al abrir el pago se revalida el código
  de descuento (agotado, vencido, apagado o con otro valor → `409 PROMO_*`), el plan en cuotas
  (`409 PLAN_NOT_AVAILABLE` después del cierre) y que no haya otro pago en proceso para la
  misma cuota (`409 PAYMENT_IN_PROGRESS`, evita cobros dobles con PSE o Nequi).
- **Vencimientos**: el cron no vence borradores ni reservas con un checkout abierto, para no
  cobrar sobre una inscripción ya liberada.
- **Entradas**: nombre solo con letras (sin HTML, números, enlaces ni fórmulas; viaja a
  WhatsApp y a los CSV), distancia solo del catálogo, cuerpos de hasta 32 KB (`413`; el exceso
  se lee y se descarta antes de responder, porque en Supabase una respuesta temprana a un cuerpo
  grande deja la conexión colgada).
- **Empezar de nuevo**: `POST /registrations` con `replace_draft: true` reemplaza un borrador
  sin pagos del mismo documento (WhatsApp mal escrito); nunca uno reservado, pagado o con un
  pago en curso (`409 REGISTRATION_NOT_REPLACEABLE`).
- **Base de datos**: RLS activo y, desde la migración `20261120000000`, sin permisos para los
  roles públicos `anon` y `authenticated` (antes tenían todos, incluido `TRUNCATE`).
- **Dependencias**: Hono 4.13.19 (la 4.6.14 tenía avisos de seguridad publicados, entre ellos
  denegación de servicio en CORS), postgres 3.4.9 y `@hono/node-server` 2.1.11. `npm audit`: 0.
- **Navegador**: inscripción, resultado y panel con política de seguridad de contenido (CSP)
  sin scripts en línea; el CSV del panel neutraliza fórmulas (`=`, `+`, `-`, `@`).

## Pendiente de validar con cuentas reales

- Orden de `expiration-time` dentro de la firma de integridad (`_shared/wompi.ts`): si el
  checkout de sandbox responde "firma inválida", mover `expirationTime` al final de la cadena.
- Consulta por referencia `GET /transactions?reference=` con llave privada (conciliación).
- Importación del flujo en la versión instalada de n8n y formato de Evolution API.
- Activación de 3D Secure por parte de Wompi.
