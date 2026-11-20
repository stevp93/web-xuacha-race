// Simulador de Wompi para pruebas de extremo a extremo.
//  GET  /p/?...            Web Checkout: valida la firma de integridad y muestra Aprobar / Rechazar / Pendiente
//  POST /p/pay             crea la transacción, envía el webhook firmado y responde la URL de regreso
//  GET  /v1/transactions/:id, GET /v1/transactions?reference=   consultas servidor a servidor
//  POST /control/webhook   reenvía un evento (para pruebas de idempotencia y de firma)
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.MOCK_PORT ?? 8799);
const API = process.env.API_URL ?? 'http://localhost:8787/api';
const INTEGRITY = process.env.WOMPI_INTEGRITY_SECRET;
const EVENTS = process.env.WOMPI_EVENTS_SECRET;
const txs = new Map();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
let seq = 1000;

function event(tx) {
  const props = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'];
  const ts = Math.floor(Date.now() / 1000);
  const checksum = sha(`${tx.id}${tx.status}${tx.amount_in_cents}${ts}${EVENTS}`);
  return { body: { event: 'transaction.updated', data: { transaction: tx }, environment: 'test', signature: { properties: props, checksum }, timestamp: ts, sent_at: new Date().toISOString() }, checksum };
}
async function sendWebhook(tx) {
  const { body, checksum } = event(tx);
  const r = await fetch(`${API}/webhooks/wompi`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Event-Checksum': checksum }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
const readBody = (req) => new Promise((ok) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => ok(d ? JSON.parse(d) : {})); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (req.method === 'GET' && url.pathname === '/p/') {
      const q = Object.fromEntries(url.searchParams);
      const expected = sha(`${q.reference}${q['amount-in-cents']}${q.currency}${q['expiration-time']}${INTEGRITY}`);
      const okSig = expected === q['signature:integrity'];
      const expired = q['expiration-time'] && new Date(q['expiration-time']) < new Date();
      const html = `<!doctype html><meta charset="utf-8"><title>Wompi simulado</title>
<h1 id="h">Checkout simulado</h1>
<p id="sig">${okSig ? 'FIRMA_OK' : 'FIRMA_INVALIDA'}</p><p id="exp">${expired ? 'VENCIDO' : 'VIGENTE'}</p>
<p id="ref">${q.reference}</p><p id="amount">${q['amount-in-cents']}</p><p id="email">${(q['customer-data:email'] || '').replace(/[<>&]/g, '')}</p>
<button id="approve">Aprobar</button><button id="decline">Rechazar</button><button id="pending">Pendiente</button>
<script>
const q = ${JSON.stringify(q)};
for (const s of ['approve','decline','pending']) document.getElementById(s).onclick = async () => {
  const r = await fetch('/p/pay', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ q, outcome: s }) });
  const j = await r.json(); location.href = j.redirect;
};
</script>`;
      return send(res, okSig ? 200 : 400, html, 'text/html; charset=utf-8');
    }
    if (req.method === 'POST' && url.pathname === '/p/pay') {
      const { q, outcome } = await readBody(req);
      const status = outcome === 'approve' ? 'APPROVED' : outcome === 'decline' ? 'DECLINED' : 'PENDING';
      const tx = { id: `${++seq}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, reference: q.reference, amount_in_cents: Number(q['amount-in-cents']), currency: q.currency, status, payment_method_type: 'CARD', customer_email: q['customer-data:email'], redirect_url: q['redirect-url'] };
      txs.set(tx.id, tx);
      const hook = status === 'PENDING' ? null : await sendWebhook(tx);
      return send(res, 200, { redirect: `${q['redirect-url']}?id=${encodeURIComponent(tx.id)}&env=test`, tx, hook });
    }
    if (req.method === 'POST' && url.pathname === '/control/settle') {     // pasa una transacción pendiente a final y avisa
      const { id, status } = await readBody(req);
      const tx = txs.get(id); tx.status = status;
      return send(res, 200, { tx, hook: await sendWebhook(tx) });
    }
    if (req.method === 'POST' && url.pathname === '/control/webhook') {    // reenvío o evento arbitrario
      const { tx, tamper } = await readBody(req);
      const { body, checksum } = event(tx);
      if (tamper) body.data.transaction.amount_in_cents += 1;
      const r = await fetch(`${API}/webhooks/wompi`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Event-Checksum': checksum }, body: JSON.stringify(body) });
      return send(res, 200, { status: r.status, json: await r.json().catch(() => null) });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/v1/transactions/')) {
      const tx = txs.get(decodeURIComponent(url.pathname.split('/').pop()));
      return tx ? send(res, 200, { data: tx }) : send(res, 404, { error: { type: 'NOT_FOUND_ERROR' } });
    }
    if (req.method === 'GET' && url.pathname === '/v1/transactions') {
      const ref = url.searchParams.get('reference');
      return send(res, 200, { data: [...txs.values()].filter((t) => t.reference === ref) });
    }
    if (req.method === 'GET' && url.pathname === '/control/txs') return send(res, 200, [...txs.values()]);
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, 500, { error: String(e) }); }
}).listen(PORT, () => console.log('wompi simulado en', PORT));
