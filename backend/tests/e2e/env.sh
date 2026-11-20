# Variables de las pruebas de extremo a extremo. Llaves de prueba inventadas: no son de ningún servicio.
export E2E_PG=${E2E_PG:-postgres://postgres@localhost:5432}
export DATABASE_URL=$E2E_PG/xr_e2e
export SITE_URL=http://localhost:8766
export ALLOWED_ORIGINS=http://localhost:8766
export EVENT_ID=xr2027
export WOMPI_PUBLIC_KEY=pub_test_e2e
export WOMPI_PRIVATE_KEY=prv_test_e2e
export WOMPI_INTEGRITY_SECRET=test_integrity_e2e
export WOMPI_EVENTS_SECRET=test_events_e2e
export WOMPI_API_BASE=http://localhost:8799/v1
export INTERNAL_API_KEY=internal-e2e-key-0123456789
export ADMIN_API_KEY=admin-e2e-key-0123456789abcdef
export API_URL=http://localhost:8787/api
export PORT=8787
