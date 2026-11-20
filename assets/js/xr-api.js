// Cliente de la API de cobro: token de reanudación y conmutación a la API de respaldo.
(function () {
  'use strict';
  var cfg = window.XR_CONFIG || {};
  var KEY = 'xr_token';

  function store() {
    try { return window.localStorage; } catch (e) { return null; }
  }
  var memory = null;

  var Token = {
    get: function () {
      var s = store();
      try { return (s && s.getItem(KEY)) || memory; } catch (e) { return memory; }
    },
    set: function (t) {
      memory = t;
      var s = store();
      try { if (s) s.setItem(KEY, t); } catch (e) { /* modo privado: queda en memoria */ }
    },
    clear: function () {
      memory = null;
      var s = store();
      try { if (s) s.removeItem(KEY); } catch (e) { /* nada */ }
    },
    // El enlace de WhatsApp trae el token en el fragmento (#t=...), que no viaja a ningún servidor.
    takeFromUrl: function () {
      var m = /[#&]t=(rt_[\w-]+)/.exec(window.location.hash || '');
      if (!m) return false;
      Token.set(m[1]);
      try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) { window.location.hash = ''; }
      return true;
    }
  };

  function ApiError(status, code, message) {
    this.status = status; this.code = code; this.message = message;
  }

  var bearerOverride = null; // el panel de administración usa su propia llave
  function once(base, method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    var t = bearerOverride || Token.get();
    if (t) headers.Authorization = 'Bearer ' + t;
    return fetch(base + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (res) {
        return res.text().then(function (text) {
          var json = null;
          try { json = text ? JSON.parse(text) : null; } catch (e) { /* respuesta no JSON */ }
          // 502/503/504 sin un error de la API significa que la plataforma no respondió: se trata
          // como falla de red y pasa al respaldo. Un 503 con código propio (p. ej. pasarela sin
          // configurar) es una respuesta de negocio y se muestra tal cual.
          var fromApi = !!(json && json.error && json.error.code);
          if ((res.status === 502 || res.status === 503 || res.status === 504) && !fromApi) throw new TypeError('gateway ' + res.status);
          if (!res.ok) {
            var err = (json && json.error) || {};
            throw new ApiError(res.status, err.code || 'HTTP_' + res.status, err.message || 'No pudimos completar la operación.');
          }
          return json;
        });
      });
  }

  function api(method, path, body) {
    return once(cfg.apiBase, method, path, body).catch(function (e) {
      // Solo fallas de red o de plataforma pasan al respaldo; los errores de negocio no.
      if (e instanceof ApiError || !cfg.fallbackApiBase) {
        if (e instanceof ApiError) throw e;
        throw new ApiError(0, 'NETWORK', 'Sin conexión con el servidor. Revisa tu internet e intenta de nuevo.');
      }
      return once(cfg.fallbackApiBase, method, path, body).catch(function (e2) {
        if (e2 instanceof ApiError) throw e2;
        throw new ApiError(0, 'NETWORK', 'Sin conexión con el servidor. Revisa tu internet e intenta de nuevo.');
      });
    });
  }

  function cop(cents) {
    return '$' + String(Math.round(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function dateBogota(iso) {
    var d = new Date(new Date(iso).getTime() - 5 * 3600000);
    return d.getUTCDate() + ' de ' + MONTHS[d.getUTCMonth()];
  }

  window.XR = { setBearer: function (k) { bearerOverride = k; }, api: api, Token: Token, ApiError: ApiError, cop: cop, dateBogota: dateBogota, cfg: cfg };
})();
