// Panel de administración: resumen, códigos (lotes, personales, QR), libro de pagos y control.
// Todo se lee de la API con la llave de administración; la página no guarda datos.
(function () {
  'use strict';
  var XR = window.XR;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'xr_admin_key';
  var data = { codes: [], payments: [], control: null, event: null };

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k]; else if (k === 'class') n.className = attrs[k]; else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  function showAlert(msg) { var a = $('alert'); a.textContent = msg; a.hidden = false; }
  function hideAlert() { $('alert').hidden = true; }
  function busy(btn, on) { if (on) { btn.dataset.label = btn.textContent; btn.textContent = 'Un momento…'; btn.disabled = true; } else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; } }

  function fail(err) {
    if (err && err.status === 401) { logout(); $('login-alert').textContent = 'Llave incorrecta.'; $('login-alert').hidden = false; return; }
    showAlert((err && err.message) || 'Ocurrió un error.');
  }

  function dateTime(iso) {
    if (!iso) return '';
    var d = new Date(new Date(iso).getTime() - 5 * 3600000);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
  }

  var STATUS = { draft: 'Borrador', reserved: 'Reservada', paid: 'Pagada', expired: 'Vencida', cancelled: 'Cancelada', transferred: 'Cedida' };

  function discountText(c) { return c.type === 'percent' ? c.value + ' %' : XR.cop(c.value); }

  // ---------- tablas ----------

  function table(id, columns, rows, emptyText) {
    var t = $(id);
    t.textContent = '';
    if (!rows.length) { t.appendChild(el('tbody', {}, [el('tr', {}, [el('td', { class: 'empty', text: emptyText })])])); return; }
    t.appendChild(el('thead', {}, [el('tr', {}, columns.map(function (c) { return el('th', { class: c.cls || '', text: c.label }); }))]));
    var body = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr', r._off ? { class: 'off' } : {});
      columns.forEach(function (c) {
        var v = c.get(r);
        var td = el('td', { class: c.cls || '' });
        if (v instanceof Node) td.appendChild(v); else td.textContent = v == null ? '' : String(v);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    t.appendChild(body);
  }

  function csv(filename, header, rows) {
    var esc = function (v) { v = v == null ? '' : String(v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var text = '﻿' + [header].concat(rows).map(function (r) { return r.map(esc).join(';'); }).join('\r\n');
    var a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })), download: filename });
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------- QR ----------

  function codeUrl(code) {
    var site = (XR.cfg.siteUrl || window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '')).replace(/\/+$/, '');
    return site + '/inscripcion.html?codigo=' + encodeURIComponent(code);
  }
  function qrSvg(text) {
    var q = window.qrcode(0, 'M'); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }
  function qrPng(text, name) {
    var q = window.qrcode(0, 'M'); q.addData(text); q.make();
    var n = q.getModuleCount(), cell = 12, m = 4 * cell, size = n * cell + 2 * m;
    var cv = el('canvas', { width: size, height: size }), ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size); ctx.fillStyle = '#000';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) ctx.fillRect(m + c * cell, m + r * cell, cell, cell);
    var a = el('a', { href: cv.toDataURL('image/png'), download: name + '.png' });
    document.body.appendChild(a); a.click(); a.remove();
  }

  var current = null;
  function openQr(c) {
    current = c;
    var url = codeUrl(c.code);
    $('qr-svg').innerHTML = qrSvg(url);
    $('qr-code').textContent = c.code;
    $('qr-desc').textContent = 'Descuento ' + discountText(c) + (c.allowed_doc_number ? ' · solo documento ' + c.allowed_doc_number : '') + (c.note ? ' · ' + c.note : '');
    $('qr-url').textContent = url;
    $('qr-dialog').showModal();
  }
  $('qr-close').addEventListener('click', function () { $('qr-dialog').close(); });
  $('qr-png').addEventListener('click', function () { qrPng(codeUrl(current.code), 'QR-' + current.code); });
  $('qr-copy').addEventListener('click', function () {
    var b = $('qr-copy'), url = codeUrl(current.code);
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { b.textContent = 'Copiado'; }, function () { window.prompt('Copia el enlace:', url); });
    setTimeout(function () { b.textContent = 'Copiar enlace'; }, 1500);
  });

  // ---------- resumen ----------

  function loadSummary() {
    return XR.api('GET', '/admin/summary').then(function (s) {
      var count = function (st) { var r = s.registrations.filter(function (x) { return x.status === st; })[0]; return r ? r.n : 0; };
      var tiles = [
        ['Recaudado', XR.cop(s.collected_cents), 'accent'],
        ['Saldos por cobrar', XR.cop(s.receivable_cents), ''],
        ['Pagos aprobados', String(s.approved_payments), ''],
        ['Inscripciones pagadas', String(count('paid')), ''],
        ['Cupos reservados', String(count('reserved')), ''],
      ];
      $('tiles').textContent = '';
      tiles.forEach(function (t) { $('tiles').appendChild(el('div', { class: 'tile ' + t[2] }, [el('span', { text: t[0] }), el('strong', { text: t[1] })])); });
      table('by-status', [{ label: 'Estado', get: function (r) { return STATUS[r.status] || r.status; } }, { label: 'Cantidad', cls: 'num', get: function (r) { return r.n; } }], s.registrations, 'Aún no hay inscripciones.');
      table('by-distance', [{ label: 'Distancia', get: function (r) { return r.distance; } }, { label: 'Cupos', cls: 'num', get: function (r) { return r.n; } }], s.by_distance, 'Aún no hay cupos tomados.');
    });
  }

  // ---------- códigos ----------

  function codeState(c) {
    if (!c.active) return ['Apagado', ''];
    if (c.valid_until && new Date(c.valid_until) < new Date()) return ['Vencido', ''];
    if (c.max_redemptions != null && c.redeemed_count >= c.max_redemptions) return ['Usado', 'ok'];
    if (c.applied_unpaid > 0) return ['Aplicado sin pagar', 'warn'];
    return ['Disponible', ''];
  }

  function paintCodes() {
    var f = $('batch-filter').value;
    var rows = data.codes.filter(function (c) { return !f || c.batch === f; });
    rows.forEach(function (c) { var s = codeState(c)[0]; c._off = s === 'Usado' || s === 'Vencido' || s === 'Apagado'; });
    $('codes-count').textContent = rows.length + ' códigos · ' + rows.filter(function (c) { return codeState(c)[0] === 'Disponible'; }).length + ' disponibles';
    table('codes', [
      { label: 'Código', cls: 'mono', get: function (c) { return c.code; } },
      { label: 'Descuento', cls: 'num', get: discountText },
      { label: 'Usos', cls: 'num', get: function (c) { return c.redeemed_count + ' / ' + (c.max_redemptions == null ? '∞' : c.max_redemptions) + (c.overage_count ? ' (+' + c.overage_count + ')' : ''); } },
      { label: 'Estado', get: function (c) { var s = codeState(c); return el('span', { class: 'pill ' + s[1], text: s[0] }); } },
      { label: 'Documento', get: function (c) { return c.allowed_doc_number || ''; } },
      { label: 'Vence', get: function (c) { return c.valid_until ? dateTime(c.valid_until).slice(0, 10) : ''; } },
      { label: 'Nota', get: function (c) { return c.note || ''; } },
      { label: 'Lote', get: function (c) { return c.batch || ''; } },
      { label: 'QR', get: function (c) { var b = el('button', { class: 'link', type: 'button', text: 'Ver QR' }); b.addEventListener('click', function () { openQr(c); }); return b; } },
    ], rows, 'Aún no hay códigos.');
    return rows;
  }

  function loadCodes(selectBatch) {
    return XR.api('GET', '/admin/promo-codes').then(function (res) {
      data.codes = res.codes;
      var sel = $('batch-filter'), keep = selectBatch || sel.value, seen = {};
      sel.textContent = '';
      sel.appendChild(el('option', { value: '', text: 'Todos los lotes' }));
      res.codes.forEach(function (c) { if (c.batch && !seen[c.batch]) { seen[c.batch] = 1; sel.appendChild(el('option', { value: c.batch, text: c.batch })); } });
      sel.value = seen[keep] ? keep : '';
      paintCodes();
    });
  }

  function readDiscount(prefix) {
    var type = $(prefix + '-type').value, raw = Number($(prefix + '-value').value.replace(/[^\d]/g, ''));
    if (!raw) throw new Error('Escribe el valor del descuento.');
    if (type === 'percent' && raw > 100) throw new Error('El porcentaje no puede pasar de 100.');
    var until = $(prefix + '-until').value;
    return { type: type, value: type === 'percent' ? raw : raw * 100, valid_until: until ? until + 'T23:59:59-05:00' : null, note: $(prefix + '-note').value.trim() || null };
  }
  ['b', 'p'].forEach(function (p) {
    $(p + '-type').addEventListener('change', function (e) { $(p + '-value-label').textContent = e.target.value === 'percent' ? 'Descuento (%)' : 'Descuento (pesos)'; $(p + '-value').value = ''; });
  });

  $('batch-form').addEventListener('submit', function (e) {
    e.preventDefault(); hideAlert();
    var btn = e.target.querySelector('button'), body;
    try { body = readDiscount('b'); } catch (err) { showAlert(err.message); return; }
    body.count = Number($('b-count').value); body.prefix = $('b-prefix').value.trim();
    busy(btn, true);
    XR.api('POST', '/admin/promo-codes/batch', body).then(function (res) { return loadCodes(res.batch); }).catch(fail).then(function () { busy(btn, false); });
  });

  $('personal-form').addEventListener('submit', function (e) {
    e.preventDefault(); hideAlert();
    var btn = e.target.querySelector('button'), body, doc = $('p-doc').value.trim().toUpperCase();
    if (!/^[0-9A-Z]{5,15}$/.test(doc)) { showAlert('Escribe el documento de la persona.'); return; }
    try { body = readDiscount('p'); } catch (err) { showAlert(err.message); return; }
    var rnd = ''; var buf = crypto.getRandomValues(new Uint8Array(6)), abc = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
    for (var i = 0; i < 6; i++) rnd += abc[buf[i] % abc.length];
    body.code = $('p-code').value.trim() || 'P-' + rnd;
    body.allowed_doc_number = doc; body.max_redemptions = 1; body.batch = 'PERSONALES';
    busy(btn, true);
    XR.api('POST', '/admin/promo-codes', body).then(function (row) {
      $('p-doc').value = ''; $('p-code').value = '';
      return loadCodes('PERSONALES').then(function () { var c = data.codes.filter(function (x) { return x.code === row.code; })[0]; if (c) openQr(c); });
    }).catch(fail).then(function () { busy(btn, false); });
  });

  $('batch-filter').addEventListener('change', paintCodes);
  $('codes-csv').addEventListener('click', function () {
    var rows = paintCodes();
    csv('codigos-xuacha.csv', ['Codigo', 'Tipo', 'Valor', 'Usos', 'Cupo', 'Estado', 'Documento', 'Vence', 'Nota', 'Lote', 'Enlace'],
      rows.map(function (c) { return [c.code, c.type === 'percent' ? 'porcentaje' : 'fijo', c.type === 'percent' ? c.value : c.value / 100, c.redeemed_count, c.max_redemptions, codeState(c)[0], c.allowed_doc_number, c.valid_until ? dateTime(c.valid_until).slice(0, 10) : '', c.note, c.batch, codeUrl(c.code)]; }));
  });
  $('codes-print').addEventListener('click', function () {
    var rows = paintCodes().filter(function (c) { return codeState(c)[0] === 'Disponible' || codeState(c)[0] === 'Aplicado sin pagar'; });
    if (!rows.length) { showAlert('No hay códigos disponibles para imprimir en este filtro.'); return; }
    if (rows.length > 150 && !window.confirm('Se imprimirán ' + rows.length + ' códigos. ¿Continuar?')) return;
    var sheet = $('print-sheet'); sheet.textContent = '';
    rows.forEach(function (c) {
      var card = el('div', { class: 'ps-card' }, [el('div', { class: 'ps-event', text: data.event ? data.event.name : 'XUACHA RACE' })]);
      var q = el('div'); q.innerHTML = qrSvg(codeUrl(c.code)); card.appendChild(q);
      card.appendChild(el('div', { class: 'ps-code', text: c.code }));
      card.appendChild(el('div', { class: 'ps-desc', text: 'Descuento ' + discountText(c) + (c.valid_until ? ' · hasta ' + dateTime(c.valid_until).slice(0, 10) : '') }));
      sheet.appendChild(card);
    });
    window.print();
  });

  // ---------- pagos ----------

  function loadLedger() {
    return XR.api('GET', '/admin/ledger').then(function (res) {
      data.payments = res.payments;
      var total = res.payments.reduce(function (s, p) { return s + p.amount_cents; }, 0);
      $('ledger-total').textContent = res.payments.length + ' pagos aprobados · ' + XR.cop(total) + ' recaudados';
      table('ledger', [
        { label: 'Fecha', get: function (p) { return dateTime(p.paid_at); } },
        { label: 'Referencia', cls: 'mono', get: function (p) { return p.reference; } },
        { label: 'Valor', cls: 'num', get: function (p) { return XR.cop(p.amount_cents); } },
        { label: 'Cuota', cls: 'num', get: function (p) { return p.plan === 'split' ? p.installment + ' de 2' : 'Única'; } },
        { label: 'Medio', get: function (p) { return p.method_type || ''; } },
        { label: 'Participante', get: function (p) { return p.full_name; } },
        { label: 'Documento', get: function (p) { return p.doc_type + ' ' + p.doc_number; } },
        { label: 'Distancia', get: function (p) { return p.distance || ''; } },
        { label: 'Código', cls: 'mono', get: function (p) { return p.promo_code || ''; } },
        { label: 'Estado', get: function (p) { return STATUS[p.registration_status] || p.registration_status; } },
      ], res.payments.slice().reverse(), 'Aún no hay pagos aprobados.');
    });
  }
  $('ledger-csv').addEventListener('click', function () {
    csv('pagos-xuacha.csv', ['Fecha', 'Referencia', 'ID Wompi', 'Valor', 'Cuota', 'Plan', 'Medio', 'Inscripcion', 'Estado', 'Nombre', 'Tipo doc', 'Documento', 'Correo', 'WhatsApp', 'Distancia', 'Categoria', 'Precio base', 'Descuento', 'Total inscripcion', 'Codigo'],
      data.payments.map(function (p) { return [dateTime(p.paid_at), p.reference, p.gateway_tx_id, p.amount_cents / 100, p.installment, p.plan, p.method_type, p.short_id, STATUS[p.registration_status] || p.registration_status, p.full_name, p.doc_type, p.doc_number, p.email, p.whatsapp_e164, p.distance, p.category, p.base_cents / 100, p.discount_cents / 100, p.total_cents / 100, p.promo_code]; }));
  });

  // ---------- control ----------

  var ACTIONS = { duplicate_payment: 'Pago duplicado de una cuota', amount_mismatch: 'Monto distinto al esperado', voided_after_approved: 'Pago anulado después de aprobado', payment_on_closed_registration: 'Pago sobre inscripción cerrada', promo_over_limit: 'Código usado por encima de su cupo', unknown_reference: 'Evento con referencia desconocida' };

  function loadControl() {
    return XR.api('GET', '/admin/control').then(function (res) {
      data.control = res;
      var n = res.mismatches.length + res.review.length, v = $('verdict'), badge = $('control-badge');
      v.className = 'verdict ' + (n ? 'bad' : 'ok');
      v.textContent = n ? n + (n === 1 ? ' caso requiere' : ' casos requieren') + ' revisión.' : 'Todo cuadra: cada inscripción corresponde con lo cobrado.';
      badge.hidden = !n; badge.textContent = String(n);
      var regCols = [
        { label: 'Inscripción', cls: 'mono', get: function (r) { return r.short_id; } },
        { label: 'Participante', get: function (r) { return r.full_name; } },
        { label: 'Documento', get: function (r) { return r.doc_number; } },
        { label: 'Estado', get: function (r) { return STATUS[r.status] || r.status; } },
        { label: 'Total', cls: 'num', get: function (r) { return XR.cop(r.total_cents); } },
        { label: 'Cobrado', cls: 'num', get: function (r) { return XR.cop(r.collected_cents); } },
      ];
      table('mismatches', regCols.concat([{ label: 'Problema', cls: 'wrap', get: function (r) { return r.problem; } }]), res.mismatches, 'Sin diferencias.');
      table('retained', regCols, res.retained, 'No hay reservas retenidas.');
      table('review', [
        { label: 'Fecha', get: function (r) { return dateTime(r.at); } },
        { label: 'Caso', get: function (r) { return ACTIONS[r.action] || r.action; } },
        { label: 'Inscripción', cls: 'mono', get: function (r) { return r.short_id || ''; } },
        { label: 'Referencia', cls: 'mono', get: function (r) { return (r.detail && r.detail.reference) || ''; } },
        { label: 'Valor recibido', cls: 'num', get: function (r) { return r.detail && r.detail.amountInCents != null ? XR.cop(r.detail.amountInCents) : ''; } },
      ], res.review, 'Sin casos por revisar.');
    });
  }

  // ---------- pestañas y sesión ----------

  var LOADERS = { resumen: loadSummary, codigos: loadCodes, pagos: loadLedger, control: loadControl };
  function openTab(name) {
    hideAlert();
    Array.prototype.forEach.call(document.querySelectorAll('.tabs [role=tab]'), function (b) { b.setAttribute('aria-selected', b.getAttribute('data-tab') === name ? 'true' : 'false'); });
    Object.keys(LOADERS).forEach(function (t) { $('tab-' + t).hidden = t !== name; });
    return LOADERS[name]().catch(fail);
  }
  document.querySelector('.tabs').addEventListener('click', function (e) { var t = e.target.closest('[data-tab]'); if (t) openTab(t.getAttribute('data-tab')); });

  function logout() {
    try { sessionStorage.removeItem(KEY); } catch (e) { /* nada */ }
    XR.setBearer(null); $('panel').hidden = true; $('login').hidden = false; $('key').value = '';
  }
  $('logout').addEventListener('click', logout);

  function enter(key) {
    XR.setBearer(key);
    return XR.api('GET', '/admin/summary').then(function () {
      try { sessionStorage.setItem(KEY, key); } catch (e) { /* nada */ }
      $('login').hidden = true; $('panel').hidden = false; $('login-alert').hidden = true;
      XR.api('GET', '/event').then(function (ev) { data.event = ev; }).catch(function () { });
      loadControl().catch(function () { });
      return openTab('resumen');
    });
  }

  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = e.target.querySelector('button'), a = $('login-alert');
    a.hidden = true; busy(btn, true);
    enter($('key').value.trim()).catch(function (err) {
      XR.setBearer(null);
      a.textContent = err.status === 401 ? 'Llave incorrecta.' : err.status === 429 ? 'Demasiados intentos. Espera unos minutos.' : err.message;
      a.hidden = false;
    }).then(function () { busy(btn, false); });
  });

  var saved = null;
  try { saved = sessionStorage.getItem(KEY); } catch (e) { /* nada */ }
  if (saved) enter(saved).catch(logout);
})();
