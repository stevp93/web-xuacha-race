// Página de regreso del pago. El estado se lee de la API, que lo confirma con la pasarela de
// servidor a servidor. El parámetro "id" de la URL solo indica qué transacción consultar.
(function () {
  'use strict';
  var XR = window.XR, $ = function (id) { return document.getElementById(id); };
  var txId = new URLSearchParams(window.location.search).get('id') || '';
  var tries = 0, MAX = 10;

  function paint(tag, cls, title, lead, cta) {
    $('spinner').hidden = true;
    $('tag').hidden = !tag; $('tag').textContent = tag || ''; $('tag').className = 'tag' + (cls ? ' ' + cls : '');
    $('title').textContent = title; $('lead').textContent = lead;
    $('cta').hidden = false; $('cta').textContent = cta;
  }

  function decide(reg) {
    var last = reg.last_attempt ? reg.last_attempt.status : null;
    if (reg.status === 'paid') {
      paint('Inscripción confirmada', '', 'Pago recibido', 'Tu inscripción a ' + reg.event.name + ' está completa. Te enviamos la confirmación por WhatsApp.', 'Ver mi inscripción');
      return true;
    }
    if (reg.status === 'reserved' && last === 'APPROVED') {
      paint('Cupo reservado', 'warn', 'Reserva recibida', 'Aseguraste tu cupo con ' + XR.cop(reg.paid_cents) + '. Te recordaremos el saldo por WhatsApp antes de la fecha límite.', 'Ver mi inscripción');
      return true;
    }
    // El pago se aprobó cuando la inscripción ya había vencido: el dinero queda identificado para revisión.
    if ((reg.status === 'expired' || reg.status === 'cancelled') && last === 'APPROVED') {
      paint('En revisión', 'warn', 'Recibimos tu pago', 'La inscripción ya no estaba activa cuando se aprobó el pago. Escríbenos por WhatsApp con la referencia ' + reg.short_id + ' y lo resolvemos.', 'Ver mi inscripción');
      return true;
    }
    if (last === 'DECLINED' || last === 'ERROR' || last === 'VOIDED') {
      paint('Pago no aprobado', 'off', 'El pago no se completó', 'No se hizo ningún cobro. Puedes intentarlo de nuevo con el mismo medio de pago o con otro.', 'Intentar de nuevo');
      return true;
    }
    return false;
  }

  function pending() {
    paint('En proceso', 'warn', 'Tu pago sigue en proceso', 'Algunos medios tardan unos minutos. Apenas se confirme te avisamos por WhatsApp; no necesitas pagar de nuevo.', 'Ver mi inscripción');
  }

  function poll() {
    tries++;
    var req = txId ? XR.api('POST', '/registrations/me/sync', { transaction_id: txId }) : XR.api('GET', '/registrations/me');
    req.then(function (reg) {
      if (decide(reg)) return;
      if (tries >= MAX) { pending(); return; }
      setTimeout(poll, 3000);
    }).catch(function (err) {
      if (err.code === 'TOKEN_INVALID') { XR.Token.clear(); noSession(); return; }
      if (tries >= MAX) { pending(); return; }
      setTimeout(poll, 3000);
    });
  }

  function noSession() {
    paint('', '', 'Abre tu inscripción para ver el resultado', 'No encontramos tu sesión en este navegador. Entra con tu documento o usa el enlace que te enviamos por WhatsApp.', 'Entrar a mi inscripción');
  }

  XR.Token.takeFromUrl();
  if (!XR.Token.get()) noSession(); else poll();
})();
