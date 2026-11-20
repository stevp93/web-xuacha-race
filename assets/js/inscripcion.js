// Flujo de inscripción por pasos. El servidor es la fuente de verdad:
// cada paso se guarda en la API y la página solo pinta el estado que recibe.
(function () {
  'use strict';
  var XR = window.XR;
  var $ = function (id) { return document.getElementById(id); };
  var VIEWS = ['loading', 'cerrado', 'datos', 'recovery', 'carrera', 'pago', 'estado'];
  var DRAFT_KEY = 'xr_paso1';
  var NAME_RE = /^[\p{L}\p{M}' ’-]+$/u; // misma regla del servidor

  var state = { event: null, reg: null, plan: null };

  // ---------- utilidades de interfaz ----------

  function show(view) {
    VIEWS.forEach(function (v) { $('view-' + v).hidden = v !== view; });
    hideAlert();
    var step = { datos: 1, recovery: 1, carrera: 2, pago: 3, estado: 4 }[view] || 0;
    Array.prototype.forEach.call($('steps').children, function (li) {
      var n = Number(li.getAttribute('data-step'));
      li.className = n < step ? 'done' : n === step ? 'current' : '';
      if (n === step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    $('steps').hidden = view === 'cerrado' || view === 'loading';
    $('another-wrap').hidden = !(state.reg && (view === 'carrera' || view === 'pago' || view === 'estado'));
    $('another-box').hidden = true;
    window.scrollTo(0, 0);
    var h = $('view-' + view).querySelector('h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  function showAlert(msg) { var a = $('alert'); a.textContent = msg; a.hidden = false; a.scrollIntoView({ block: 'nearest' }); }
  function hideAlert() { $('alert').hidden = true; }

  function busy(btn, on, label) {
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Un momento…'; btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
  }

  function fail(err) {
    if (err && err.code === 'TOKEN_INVALID') { XR.Token.clear(); state.reg = null; renderPlate(); show('datos'); showAlert('Tu sesión venció. Retoma tu inscripción con tu documento.'); return; }
    showAlert((err && err.message) || 'Ocurrió un error. Intenta de nuevo.');
  }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k]; else if (k === 'class') n.className = attrs[k]; else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  function waLink(text) {
    return 'https://wa.me/' + (XR.cfg.supportWhatsapp || '') + '?text=' + encodeURIComponent(text);
  }

  // ---------- dorsal y tiquete ----------

  function renderPlate() {
    var ev = state.event, r = state.reg;
    $('p-event').textContent = ev ? ev.name : 'XUACHA RACE';
    var name = r ? r.participant.full_name : ($('full_name').value || '').trim();
    $('p-name').textContent = name || 'TU NOMBRE';
    $('p-distance').textContent = r && r.distance ? r.distance : '—';
    $('p-category').textContent = r && r.category ? r.category : 'Categoría por elegir';

    var base = r ? r.base_cents : ev ? ev.base_cents : null;
    $('t-base').textContent = base == null ? '—' : XR.cop(base);
    var disc = r ? r.discount_cents : 0;
    $('t-discount-row').hidden = !disc;
    if (disc) {
      $('t-discount-label').textContent = 'Descuento' + (r.promo ? ' ' + r.promo.code.toUpperCase() : '');
      $('t-discount').textContent = '−' + XR.cop(disc);
    }
    var total = r ? r.total_cents : base;
    $('t-total').textContent = total == null ? '—' : XR.cop(total);

    var paid = r ? r.paid_cents : 0;
    $('t-paid-row').hidden = !paid;
    $('t-paid').textContent = XR.cop(paid);

    var now = null, label = 'Hoy pagas';
    if (r && r.status === 'draft' && !$('view-pago').hidden && state.plan && ev) {
      now = state.plan === 'split' ? splitOf(r.total_cents).reserve : r.total_cents;
    } else if (r && r.status === 'reserved') {
      var next = r.installments.filter(function (i) { return i.status === 'pending'; })[0];
      if (next) { now = next.amount_cents; label = 'Saldo pendiente'; }
    }
    $('t-now-row').hidden = now == null;
    if (now != null) { $('t-now-label').textContent = label; $('t-now').textContent = XR.cop(now); }
  }

  // Misma regla del servidor (solo para mostrar; el monto real lo calcula la API).
  function splitOf(total) {
    var reserve = Math.round(total * state.event.reserve_pct / 100 / 100) * 100;
    return { reserve: reserve, balance: total - reserve };
  }

  // ---------- enrutamiento por estado ----------

  function route(reg) {
    state.reg = reg;
    state.event = reg.event;
    if (reg.status === 'draft') {
      if (reg.step >= 3 && reg.distance && reg.category) openPago(); else openCarrera();
    } else {
      openEstado();
    }
  }

  // ---------- paso 1 ----------

  function restoreDraft() {
    try {
      var d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}');
      ['full_name', 'doc_type', 'doc_number', 'email', 'whatsapp'].forEach(function (k) { if (d[k]) $(k).value = d[k]; });
    } catch (e) { /* sin borrador local */ }
  }
  function saveDraft() {
    try {
      var d = {};
      ['full_name', 'doc_type', 'doc_number', 'email', 'whatsapp'].forEach(function (k) { d[k] = $(k).value; });
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    } catch (e) { /* almacenamiento no disponible */ }
  }

  function validateDatos() {
    var ok = true;
    function check(id, valid) { $(id).setAttribute('aria-invalid', valid ? 'false' : 'true'); if (!valid && ok) { $(id).focus(); ok = false; } }
    var name = $('full_name').value.trim();
    var nameOk = /\S+\s+\S+/.test(name) && NAME_RE.test(name.replace(/\s+/g, ' '));
    check('full_name', nameOk);
    if (!nameOk && /\S+\s+\S+/.test(name)) { showAlert('Escribe tu nombre solo con letras, sin números ni símbolos.'); return false; }
    check('doc_number', /^[0-9A-Za-z]{5,15}$/.test($('doc_number').value.trim()));
    check('email', /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test($('email').value.trim()));
    check('whatsapp', /^3\d{9}$/.test($('whatsapp').value.replace(/\D/g, '')));
    if (ok && !$('consent').checked) { $('consent').focus(); showAlert('Debes autorizar el tratamiento de datos para continuar.'); return false; }
    if (!ok) showAlert('Revisa los campos marcados.');
    return ok;
  }

  $('view-datos').addEventListener('input', function () { saveDraft(); renderPlate(); });

  function datosBody() {
    var body = {
      full_name: $('full_name').value.trim(), doc_type: $('doc_type').value, doc_number: $('doc_number').value.trim(),
      email: $('email').value.trim(), whatsapp: $('whatsapp').value.replace(/\D/g, ''), consent: true,
    };
    var ts = document.querySelector('[name="cf-turnstile-response"]');
    if (ts) body.turnstile_token = ts.value;
    return body;
  }

  function created(res) {
    XR.Token.set(res.resume_token);
    try { sessionStorage.removeItem(DRAFT_KEY); } catch (err) { /* nada */ }
    route(res.registration);
  }

  $('view-datos').addEventListener('submit', function (e) {
    e.preventDefault();
    hideAlert();
    if (!validateDatos()) return;
    var btn = e.target.querySelector('button[type=submit]');
    busy(btn, true);
    XR.api('POST', '/registrations', datosBody()).then(created).catch(function (err) {
      if (err.code === 'REGISTRATION_EXISTS') {
        openRecovery($('doc_type').value, $('doc_number').value.trim(), 'Ya hay una inscripción con este documento. Te enviamos un código al WhatsApp registrado para retomarla.', true);
      } else if (err.code === 'REGISTRATION_CLOSED') { show('cerrado'); } else { fail(err); }
    }).then(function () { busy(btn, false); });
  });

  // Empezar de nuevo sobre un borrador sin pagos (por ejemplo, si el WhatsApp quedó mal escrito).
  $('restart-open').addEventListener('click', function () { $('restart-box').hidden = !$('restart-box').hidden; });
  $('restart-go').addEventListener('click', function () {
    hideAlert();
    var btn = $('restart-go'), body = datosBody();
    body.replace_draft = true;
    busy(btn, true);
    XR.api('POST', '/registrations', body).then(created).catch(fail).then(function () { busy(btn, false); });
  });

  // ---------- recuperación ----------

  function openRecovery(docType, docNumber, lead, fromDatos) {
    show('recovery');
    $('recovery-request').hidden = false;
    $('recovery-verify').hidden = true;
    $('restart').hidden = !fromDatos;
    $('restart-box').hidden = true;
    $('recovery-lead').textContent = lead || 'Escribe tu documento y te enviamos un código al WhatsApp que registraste.';
    if (docType) $('rec_doc_type').value = docType;
    if (docNumber) { $('rec_doc_number').value = docNumber; requestCode(); }
  }

  function requestCode() {
    var btn = $('recovery-request').querySelector('button');
    busy(btn, true);
    return XR.api('POST', '/recovery/request', { doc_type: $('rec_doc_type').value, doc_number: $('rec_doc_number').value.trim() })
      .then(function () { $('recovery-verify').hidden = false; $('rec_code').focus(); })
      .catch(fail).then(function () { busy(btn, false, null); btn.textContent = 'Reenviar código'; });
  }

  $('go-recovery').addEventListener('click', function () { openRecovery(); });
  $('back-datos').addEventListener('click', function () { show('datos'); });
  $('recovery-request').addEventListener('submit', function (e) {
    e.preventDefault(); hideAlert();
    if (!/^[0-9A-Za-z]{5,15}$/.test($('rec_doc_number').value.trim())) { showAlert('Escribe tu número de documento.'); return; }
    requestCode();
  });
  $('recovery-verify').addEventListener('submit', function (e) {
    e.preventDefault(); hideAlert();
    var btn = e.target.querySelector('button');
    busy(btn, true);
    XR.api('POST', '/recovery/verify', { doc_type: $('rec_doc_type').value, doc_number: $('rec_doc_number').value.trim(), code: $('rec_code').value.trim() })
      .then(function (res) { XR.Token.set(res.resume_token); $('rec_code').value = ''; route(res.registration); })
      .catch(fail).then(function () { busy(btn, false); });
  });

  // ---------- paso 2 ----------

  function distanceKeys() {
    return Object.keys(state.event.catalog).sort(function (a, b) { return parseInt(b, 10) - parseInt(a, 10); });
  }

  function fillCategories() {
    var sel = $('category'), r = state.reg;
    sel.textContent = '';
    if (!r.distance) { sel.appendChild(el('option', { value: '', text: 'Elige primero la distancia' })); sel.disabled = true; return; }
    sel.disabled = false;
    sel.appendChild(el('option', { value: '', text: 'Elige tu categoría' }));
    state.event.catalog[r.distance].categories.forEach(function (c) {
      var o = el('option', { value: c, text: c });
      if (c === r.category) o.selected = true;
      sel.appendChild(o);
    });
  }

  function openCarrera() {
    var r = state.reg, box = $('distances');
    box.textContent = '';
    distanceKeys().forEach(function (k) {
      var input = el('input', { type: 'radio', name: 'distance', value: k });
      if (r.distance === k) input.checked = true;
      box.appendChild(el('label', { class: 'option' }, [input, el('span', { class: 'option-body' }, [
        el('span', { class: 'option-title' }, [el('strong', { text: k })]),
        el('span', { class: 'option-sub', text: state.event.catalog[k].label }),
      ])]));
    });
    fillCategories();
    // Código recibido por enlace o QR (?codigo=...): se aplica una vez, si aún no hay otro.
    var pending = takePendingCode();
    if (pending && !r.promo) {
      patch({ promo_code: pending }).then(openCarrera).catch(function (err) {
        openCarrera(); $('promo').value = pending; setPromoMsg(err.message, 'err');
      });
      return;
    }
    $('promo').value = r.promo ? r.promo.code.toUpperCase() : '';
    setPromoMsg(r.promo ? 'Código aplicado: −' + XR.cop(r.discount_cents) : '', r.promo ? 'ok' : '');
    $('promo-apply').textContent = r.promo ? 'Quitar' : 'Aplicar';
    show('carrera');
    renderPlate();
  }

  var CODE_KEY = 'xr_codigo';
  function captureCodeFromUrl() {
    var m = /[?&]codigo=([\w-]{3,32})/.exec(window.location.search);
    if (!m) return;
    try { sessionStorage.setItem(CODE_KEY, m[1].toUpperCase()); } catch (e) { /* nada */ }
  }
  function takePendingCode() {
    try { var c = sessionStorage.getItem(CODE_KEY); sessionStorage.removeItem(CODE_KEY); return c; } catch (e) { return null; }
  }

  function patch(body) {
    return XR.api('PATCH', '/registrations/me', body).then(function (reg) { state.reg = reg; state.event = reg.event; renderPlate(); return reg; });
  }

  function setPromoMsg(text, cls) { var m = $('promo-msg'); m.textContent = text; m.className = 'hint' + (cls ? ' ' + cls : ''); }

  $('distances').addEventListener('change', function (e) {
    hideAlert();
    patch({ distance: e.target.value }).then(fillCategories).catch(function (err) {
      // El código vigente no aplica a la nueva distancia: se informa y se conserva la anterior.
      fail(err); openCarrera(); showAlert(err.message);
    });
  });
  $('category').addEventListener('change', function (e) {
    if (e.target.value) patch({ category: e.target.value }).catch(fail);
  });
  $('promo-apply').addEventListener('click', function () {
    var btn = $('promo-apply'), removing = !!state.reg.promo;
    var code = $('promo').value.trim();
    if (!removing && !code) { setPromoMsg('Escribe el código.', 'err'); return; }
    busy(btn, true, '…');
    patch({ promo_code: removing ? null : code }).then(function (reg) {
      busy(btn, false);
      btn.textContent = reg.promo ? 'Quitar' : 'Aplicar';
      if (!reg.promo) $('promo').value = '';
      setPromoMsg(reg.promo ? 'Código aplicado: −' + XR.cop(reg.discount_cents) : 'Código retirado.', reg.promo ? 'ok' : '');
    }).catch(function (err) {
      busy(btn, false);
      if (/^PROMO_/.test(err.code) || err.code === 'RATE_LIMITED') setPromoMsg(err.message, 'err'); else fail(err);
    });
  });

  $('view-carrera').addEventListener('submit', function (e) {
    e.preventDefault(); hideAlert();
    var r = state.reg;
    if (!r.distance) { showAlert('Elige la distancia.'); return; }
    if (!r.category) { $('category').setAttribute('aria-invalid', 'true'); $('category').focus(); showAlert('Elige tu categoría.'); return; }
    var btn = e.target.querySelector('button[type=submit]');
    busy(btn, true);
    patch({ step: 3 }).then(openPago).catch(fail).then(function () { busy(btn, false); });
  });

  // ---------- paso 3 ----------

  function openPago() {
    var r = state.reg, ev = state.event, box = $('plans');
    var s = splitOf(r.total_cents);
    state.plan = r.plan && (r.plan !== 'split' || ev.split_available) ? r.plan : 'full';
    box.textContent = '';
    [
      { id: 'full', title: 'Pago completo', amount: XR.cop(r.total_cents), sub: 'Un solo pago y tu inscripción queda confirmada.' },
      { id: 'split', title: 'Reserva + saldo', amount: XR.cop(s.reserve) + ' hoy',
        sub: ev.split_available ? 'Aseguras tu cupo hoy y pagas ' + XR.cop(s.balance) + ' hasta el ' + XR.dateBogota(ev.balance_due_at) + '.' : 'Ya no está disponible para esta fecha.',
        disabled: !ev.split_available },
    ].forEach(function (p) {
      var input = el('input', { type: 'radio', name: 'plan', value: p.id });
      if (p.disabled) input.disabled = true;
      if (state.plan === p.id) input.checked = true;
      box.appendChild(el('label', { class: 'option' }, [input, el('span', { class: 'option-body' }, [
        el('span', { class: 'option-title' }, [el('span', { text: p.title }), el('strong', { text: p.amount })]),
        el('span', { class: 'option-sub', text: p.sub }),
      ])]));
    });
    show('pago');
    paintPay();
  }

  function paintPay() {
    var r = state.reg;
    var amount = state.plan === 'split' ? splitOf(r.total_cents).reserve : r.total_cents;
    $('pay-btn').textContent = 'Pagar ' + XR.cop(amount);
    renderPlate();
  }

  $('plans').addEventListener('change', function (e) { state.plan = e.target.value; paintPay(); });
  $('back-carrera').addEventListener('click', function () { patch({ step: 2 }).then(openCarrera).catch(fail); });

  function goCheckout(btn) {
    busy(btn, true, 'Abriendo la pasarela de pagos…');
    return XR.api('POST', '/registrations/me/checkout', {})
      .then(function (c) { window.location.href = c.checkout_url; })
      .catch(function (err) { busy(btn, false); checkoutFailed(err); });
  }

  function checkoutFailed(err) {
    // El código pudo agotarse, vencer o cambiar después de aplicarlo: se vuelve al paso 2.
    if (/^PROMO_/.test(err.code)) {
      return XR.api('GET', '/registrations/me').then(function (reg) {
        state.reg = reg; state.event = reg.event; openCarrera(); showAlert(err.message); setPromoMsg(err.message, 'err');
      }).catch(fail);
    }
    // El plan en cuotas cerró: se recarga el evento para que la opción aparezca deshabilitada.
    if (err.code === 'PLAN_NOT_AVAILABLE') {
      return XR.api('GET', '/registrations/me').then(function (reg) {
        state.reg = reg; state.event = reg.event; openPago(); showAlert(err.message);
      }).catch(fail);
    }
    fail(err);
  }

  $('view-pago').addEventListener('submit', function (e) {
    e.preventDefault(); hideAlert();
    var btn = $('pay-btn');
    busy(btn, true, 'Abriendo la pasarela de pagos…');
    XR.api('PUT', '/registrations/me/plan', { plan: state.plan })
      .then(function (reg) { state.reg = reg; busy(btn, false); return goCheckout(btn); })
      .catch(function (err) { busy(btn, false); checkoutFailed(err); });
  });

  // ---------- estado: reservada, pagada, vencida ----------

  function openEstado() {
    var r = state.reg, ev = state.event;
    var tag = $('estado-tag'), next = r.installments.filter(function (i) { return i.status === 'pending'; })[0];
    $('estado-due').hidden = true; $('pay-balance').hidden = true; $('extra').hidden = true;
    if (r.status === 'paid') {
      tag.textContent = 'Inscripción confirmada'; tag.className = 'tag';
      $('estado-title').textContent = 'Nos vemos en la salida';
      $('estado-lead').textContent = 'Recibimos el pago completo de ' + XR.cop(r.total_cents) + '. La confirmación llegó a tu WhatsApp. Referencia: ' + r.short_id + '.';
      $('extra').hidden = false;
    } else if (r.status === 'reserved') {
      tag.textContent = 'Cupo reservado'; tag.className = 'tag warn';
      $('estado-title').textContent = 'Te falta el saldo';
      $('estado-lead').textContent = 'Recibimos tu reserva de ' + XR.cop(r.paid_cents) + '. Paga el saldo antes de la fecha límite para confirmar tu inscripción.';
      if (next) {
        $('due-amount').textContent = XR.cop(next.amount_cents);
        $('due-date').textContent = next.due_at ? XR.dateBogota(next.due_at) : '—';
        $('estado-due').hidden = false; $('pay-balance').hidden = false;
        $('pay-balance').textContent = 'Pagar el saldo de ' + XR.cop(next.amount_cents);
      }
      $('extra').hidden = false;
    } else {
      tag.textContent = r.status === 'expired' ? 'Inscripción vencida' : 'Inscripción cerrada'; tag.className = 'tag off';
      $('estado-title').textContent = 'Esta inscripción ya no está activa';
      $('estado-lead').textContent = r.status === 'cancelled'
        ? 'Se empezó una inscripción nueva con este documento. Retómala con tu documento o con el último enlace que llegó a tu WhatsApp. Referencia: ' + r.short_id + '.'
        : 'El plazo terminó y el cupo fue liberado. Si crees que es un error, escríbenos por WhatsApp con la referencia ' + r.short_id + '.';
    }
    var fd = r.form_data || {};
    $('emergency_name').value = fd.emergency_name || '';
    $('emergency_phone').value = fd.emergency_phone || '';
    $('eps').value = fd.eps || '';
    $('extra-msg').textContent = '';
    show('estado');
    renderPlate();
  }

  $('pay-balance').addEventListener('click', function () { hideAlert(); goCheckout($('pay-balance')); });

  // Otra persona en el mismo dispositivo: la sesión actual se cierra aquí y queda guardada en el servidor.
  $('another').addEventListener('click', function () { $('another-box').hidden = !$('another-box').hidden; });
  $('another-go').addEventListener('click', function () {
    XR.Token.clear();
    state.reg = null; state.plan = null;
    ['full_name', 'doc_number', 'email', 'whatsapp'].forEach(function (k) { $(k).value = ''; });
    $('consent').checked = false;
    try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) { /* nada */ }
    renderPlate();
    if (state.event && !state.event.registration_open) { show('cerrado'); return; }
    loadTurnstile();
    show('datos');
  });

  $('extra').addEventListener('submit', function (e) {
    e.preventDefault(); hideAlert();
    var btn = e.target.querySelector('button');
    busy(btn, true);
    patch({ form_data: { emergency_name: $('emergency_name').value.trim(), emergency_phone: $('emergency_phone').value.trim(), eps: $('eps').value.trim() } })
      .then(function () { $('extra-msg').textContent = 'Datos guardados.'; $('extra-msg').className = 'hint ok'; })
      .catch(fail).then(function () { busy(btn, false); });
  });

  // ---------- inicio ----------

  function loadTurnstile() {
    if (!XR.cfg.turnstileSiteKey || $('turnstile-slot').firstChild) return;
    $('turnstile-slot').appendChild(el('div', { class: 'cf-turnstile', 'data-sitekey': XR.cfg.turnstileSiteKey, 'data-theme': 'dark' }));
    document.head.appendChild(el('script', { src: 'https://challenges.cloudflare.com/turnstile/v0/api.js', async: '', defer: '' }));
  }

  function start() {
    var help = waLink('Hola, necesito ayuda con mi inscripción a XUACHA RACE');
    $('foot-wa').href = help; $('closed-wa').href = help;
    captureCodeFromUrl();
    XR.Token.takeFromUrl();
    restoreDraft();

    var withToken = XR.Token.get()
      ? XR.api('GET', '/registrations/me').catch(function (err) { if (err.code === 'TOKEN_INVALID') { XR.Token.clear(); return null; } throw err; })
      : Promise.resolve(null);

    withToken.then(function (reg) {
      if (reg) { route(reg); return; }
      return XR.api('GET', '/event').then(function (ev) {
        state.event = ev;
        renderPlate();
        if (!ev.registration_open) { show('cerrado'); return; }
        loadTurnstile();
        show('datos');
      });
    }).catch(function (err) {
      show('datos');
      $('view-datos').hidden = true;
      showAlert(err.message || 'No pudimos cargar la inscripción. Recarga la página.');
    });
  }

  start();
})();
