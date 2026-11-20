#!/usr/bin/env bash
# Pruebas de extremo a extremo: levanta la base, la API (con y sin pasarela), el simulador de
# Wompi y el sitio; corre e2e.py y apaga todo al terminar.
#   E2E_PG=postgres://usuario@host:puerto tests/e2e/run.sh [prueba ...]
# Requiere: Node 22, Python 3 con Playwright (pip install playwright && playwright install chromium) y psql.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$(cd "$HERE/../.." && pwd)"
SITE_ROOT="$(cd "$BACKEND/.." && pwd)"
source "$HERE/env.sh"
for port in 8766 8787 8788 8799; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then echo "El puerto $port está ocupado: detén ese proceso primero." >&2; exit 1; fi
done
"$HERE/reset-db.sh"
# Cada servicio en su propio grupo de procesos, para apagarlo completo (npx y tsx crean hijos).
pgids=()
start() { local dir="$1" log="$2"; shift 2; (cd "$dir" && exec setsid "$@" > "$log" 2>&1) & pgids+=($!); }
cleanup() { for g in "${pgids[@]}"; do kill -- "-$g" 2>/dev/null || true; done; }
trap cleanup EXIT
start "$HERE" "$HERE/mock.log" node mock-wompi.mjs
start "$BACKEND" "$HERE/api.log" npx tsx node/server.ts
start "$BACKEND" "$HERE/api-nogw.log" env -u WOMPI_PUBLIC_KEY -u WOMPI_PRIVATE_KEY -u WOMPI_INTEGRITY_SECRET -u WOMPI_EVENTS_SECRET PORT=8788 npx tsx node/server.ts
start "$SITE_ROOT" "$HERE/static.log" python3 -m http.server 8766 --bind 127.0.0.1
for i in $(seq 1 30); do curl -sf localhost:8787/api/health >/dev/null && curl -sf localhost:8788/api/health >/dev/null && break; sleep 1; done
python3 "$HERE/e2e.py" "$@"
