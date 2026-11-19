// XUACHA RACE · motor de movimiento del sitio.
// Película por scroll (canvas + secuencia de fotogramas), pines con desplazamiento
// horizontal, texto que se ilumina, cintas, parallax, cursor y analítica diferida.
(function () {
  'use strict';
  var d = document, root = d.documentElement, W = window;
  var reduce = W.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = W.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var $ = function (s, c) { return (c || d).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || d).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var smooth = function (a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  var vh = function () { return W.innerHeight; };

  // ---------- menú móvil ----------
  var btn = $('#menu-btn'), menu = $('#menu');
  if (btn && menu) {
    var setOpen = function (open) {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
      menu.classList.toggle('open', open); menu.inert = !open;
      d.body.classList.toggle('menu-open', open); d.body.style.overflow = open ? 'hidden' : '';
    };
    setOpen(false);
    btn.addEventListener('click', function () { setOpen(btn.getAttribute('aria-expanded') !== 'true'); });
    d.addEventListener('keydown', function (e) { if (e.key === 'Escape' && menu.classList.contains('open')) { setOpen(false); btn.focus(); } });
    W.matchMedia('(min-width: 960px)').addEventListener('change', function (e) { if (e.matches) setOpen(false); });
  }

  // ---------- manifiesto: una envoltura por palabra ----------
  $$('.manifesto').forEach(function (m) {
    var walk = function (node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var frag = d.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(d.createTextNode(part)); return; }
            var s = d.createElement('span'); s.className = 'w'; s.textContent = part; frag.appendChild(s);
          });
          n.parentNode.replaceChild(frag, n);
        } else if (n.nodeType === 1) walk(n);
      });
    };
    walk(m);
  });

  // ---------- película ----------
  var film = $('#film'), canvas = film && $('canvas', film), ctx = canvas && canvas.getContext('2d');
  var frames = [], frameCount = 0, current = -1, loaded = 0;
  var beats = film ? $$('.beat', film) : [];
  var km = film && $('#km');

  function drawFrame(i) {
    if (!ctx) return;
    // usa el fotograma cargado más cercano
    var img = frames[i];
    if (!img || !img.complete || !img.naturalWidth) {
      for (var k = 1; k < frameCount; k++) {
        var a = frames[i - k], b = frames[i + k];
        if (a && a.complete && a.naturalWidth) { img = a; break; }
        if (b && b.complete && b.naturalWidth) { img = b; break; }
      }
    }
    if (!img || !img.naturalWidth) return;
    var cw = canvas.width, ch = canvas.height, iw = img.naturalWidth, ih = img.naturalHeight;
    var s = Math.max(cw / iw, ch / ih), w = iw * s, h = ih * s;
    var fx = cw < ch ? 0.38 : 0.5; // en vertical se centra en el ciclista
    ctx.drawImage(img, (cw - w) * fx, (ch - h) / 2, w, h);
  }
  function sizeCanvas() {
    if (!canvas) return;
    var dpr = Math.min(W.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr); canvas.height = Math.round(canvas.clientHeight * dpr);
    current = -1;
  }

  if (film) {
    frameCount = Number(film.getAttribute('data-frames'));
    var set = W.innerWidth < 760 ? film.getAttribute('data-m') : film.getAttribute('data-d');
    var loader = $('#loader'), loaderNum = loader && $('b', loader), loaderDone = false;
    var finishLoader = function () { if (loaderDone || !loader) return; loaderDone = true; loader.classList.add('done'); d.body.classList.add('ready'); };
    var src = function (i) { return set + String(i + 1).padStart(3, '0') + '.webp'; };
    if (reduce) {
      finishLoader();
    } else {
      sizeCanvas();
      // orden de carga: primero uno de cada 8 (scrub usable pronto), luego el resto
      var order = [];
      for (var i = 0; i < frameCount; i += 8) order.push(i);
      for (i = 0; i < frameCount; i++) if (order.indexOf(i) < 0) order.push(i);
      var onOne = function () {
        loaded++;
        var p = Math.round(loaded / frameCount * 100);
        if (loader) { loaderNum.textContent = String(p).padStart(2, '0'); loader.style.setProperty('--p', p); }
        if (current < 0 || loaded < 20) { current = -1; tick(); }
        if (loaded >= frameCount * 0.35) finishLoader();
      };
      order.forEach(function (idx, n) {
        var img = new Image(); img.decoding = 'async';
        if (n < 16) img.fetchPriority = 'high';
        img.onload = onOne; img.onerror = onOne; img.src = src(idx); frames[idx] = img;
      });
      setTimeout(finishLoader, 4500); // nunca bloquea más de 4,5 s
      W.addEventListener('resize', function () { sizeCanvas(); tick(); });
    }
  } else {
    var ld = $('#loader'); if (ld) ld.remove();
  }

  function updateFilm() {
    if (!film || reduce) return;
    var r = film.getBoundingClientRect(), total = film.offsetHeight - vh();
    var p = clamp(-r.top / total, 0, 1);
    var idx = Math.round(p * (frameCount - 1));
    if (idx !== current) { current = idx; drawFrame(idx); }
    film.style.setProperty('--p', p.toFixed(4));
    film.style.setProperty('--end', smooth(0.75, 1, p).toFixed(3));
    if (km) km.firstChild.nodeValue = (p * 40).toFixed(1).padStart(4, '0');
    beats.forEach(function (b) {
      var a = Number(b.getAttribute('data-a')), z = Number(b.getAttribute('data-b')), keep = b.hasAttribute('data-keep');
      var fin = smooth(a, a + 0.07, p), fout = keep ? 0 : smooth(z - 0.07, z, p);
      var o = a === 0 ? 1 - smooth(z - 0.1, z, p) : fin * (1 - fout);
      var y = a === 0 ? -p * 600 : (1 - fin) * 60 - fout * 60;
      var sc = a === 0 ? 1 + p * 0.6 : 0.96 + fin * 0.04;
      b.style.setProperty('--o', o.toFixed(3)); b.style.setProperty('--y', y.toFixed(1)); b.style.setProperty('--s', sc.toFixed(3));
      b.style.visibility = o < 0.01 ? 'hidden' : 'visible';
    });
  }

  // ---------- desplazamiento horizontal ----------
  var hs = $$('.hscroll');
  function updateH() {
    hs.forEach(function (sec) {
      if (reduce) return;
      var row = $('.row', sec), counter = $('[data-hcount]', sec);
      var r = sec.getBoundingClientRect(), total = sec.offsetHeight - vh();
      var p = clamp(-r.top / total, 0, 1), dist = row.scrollWidth - W.innerWidth;
      var x = -p * Math.max(0, dist);
      row.style.setProperty('--x', x.toFixed(1));
      $$('.panel img', row).forEach(function (img) {
        var pr = img.parentNode.getBoundingClientRect();
        img.style.setProperty('--px', (((pr.left + pr.width / 2) - W.innerWidth / 2) * -0.12).toFixed(1));
      });
      if (counter) {
        var n = $$('.panel', row).length, k = Math.min(n, Math.floor(p * n) + 1);
        counter.textContent = String(k).padStart(2, '0') + ' / ' + String(n).padStart(2, '0');
      }
    });
  }

  // ---------- cintas, manifiesto, parallax, barras ----------
  var tapes = $$('.tape'), manis = $$('.manifesto'), pars = $$('[data-par]'), bars = $$('.bars'), bands = $$('.maker .band');
  function updateMisc() {
    var y = W.scrollY;
    tapes.forEach(function (t) {
      var r = t.parentNode.getBoundingClientRect(); if (r.bottom < 0 || r.top > vh()) return;
      var dir = t.classList.contains('b') ? 1 : -1;
      $('div', t).style.setProperty('--x', (dir * (r.top - vh()) * 0.6 - 200).toFixed(1));
    });
    manis.forEach(function (m) {
      var r = m.getBoundingClientRect(), ws = $$('.w', m);
      var p = clamp((vh() * 0.85 - r.top) / (r.height + vh() * 0.35), 0, 1) * ws.length;
      ws.forEach(function (w, i) { w.style.setProperty('--lit', clamp(p - i, 0, 1).toFixed(2)); });
    });
    pars.forEach(function (el) {
      var r = el.parentNode.getBoundingClientRect(); if (r.bottom < -200 || r.top > vh() + 200) return;
      var k = Number(el.getAttribute('data-par'));
      el.style.setProperty('--py', ((r.top) * k).toFixed(1));
      if (el.hasAttribute('data-zoom')) el.style.setProperty('--zs', (1.05 + clamp(-r.top / vh(), 0, 1) * 0.15).toFixed(3));
    });
    bars.forEach(function (b) {
      var r = b.getBoundingClientRect(), f = smooth(vh(), vh() * 0.45, r.top);
      $$('i b', b).forEach(function (x) { x.style.setProperty('--f', f.toFixed(3)); });
    });
    bands.forEach(function (b) { b.style.setProperty('--x', ((b.parentNode.getBoundingClientRect().top) * 0.3).toFixed(1)); });
  }

  // ---------- navegación: sólida al bajar, se oculta al bajar rápido ----------
  var nav = $('.nav'), lastY = W.scrollY;
  function updateNav() {
    var y = W.scrollY, overFilm = film && y < film.offsetHeight - vh() * 1.1;
    nav.classList.toggle('solid', y > 40 && !overFilm);
    nav.classList.toggle('hide', y > lastY + 4 && y > 300 && !d.body.classList.contains('menu-open'));
    if (y < lastY - 4) nav.classList.remove('hide');
    lastY = y;
  }

  // ---------- bucle ----------
  var queued = false;
  function tick() {
    if (queued) return; queued = true;
    requestAnimationFrame(function () { queued = false; updateFilm(); updateH(); updateMisc(); updateNav(); });
  }
  W.addEventListener('scroll', tick, { passive: true });
  W.addEventListener('resize', tick);
  tick();

  // ---------- aparición y contadores ----------
  var countUp = function (el) {
    var end = Number(el.getAttribute('data-count')), start = performance.now(), dur = 1600, node = el.firstChild;
    if (reduce) return;
    (function step(now) {
      var k = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - k, 4);
      node.nodeValue = String(Math.round(end * e));
      if (k < 1) requestAnimationFrame(step);
    })(start);
  };
  if ('IntersectionObserver' in W) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add('in');
        if (en.target.hasAttribute('data-count')) countUp(en.target);
        io.unobserve(en.target);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.15 });
    $$('.rv, .split, [data-count]').forEach(function (el) { io.observe(el); });
  } else {
    $$('.rv, .split').forEach(function (el) { el.classList.add('in'); });
  }
  // títulos de páginas internas: entran al cargar
  $$('.page-hero .split').forEach(function (el) { requestAnimationFrame(function () { el.classList.add('in'); }); });

  // ---------- cursor, imán y vista previa ----------
  if (finePointer && !reduce) {
    var cur = d.createElement('div'); cur.className = 'cursor'; d.body.appendChild(cur);
    var mx = 0, my = 0, cx = 0, cy = 0;
    d.addEventListener('pointermove', function (e) { mx = e.clientX; my = e.clientY; cur.classList.add('on'); });
    d.addEventListener('pointerleave', function () { cur.classList.remove('on'); });
    (function loop() { cx += (mx - cx) * 0.2; cy += (my - cy) * 0.2; cur.style.transform = 'translate(' + cx + 'px,' + cy + 'px)'; requestAnimationFrame(loop); })();
    d.addEventListener('pointerover', function (e) { cur.classList.toggle('big', !!(e.target.closest && e.target.closest('a, button, summary'))); });

    $$('.btn').forEach(function (b) {
      b.addEventListener('pointermove', function (e) {
        var r = b.getBoundingClientRect();
        b.style.transform = 'translate(' + ((e.clientX - r.left - r.width / 2) * 0.18) + 'px,' + ((e.clientY - r.top - r.height / 2) * 0.3) + 'px)';
      });
      b.addEventListener('pointerleave', function () { b.style.transform = ''; });
    });

    var peek = $('.peek');
    if (peek) {
      var pimg = $('img', peek), px = 0, py = 0, tx = 0, ty = 0;
      $$('.inc li').forEach(function (li) {
        li.addEventListener('pointerenter', function () { pimg.src = li.getAttribute('data-img'); peek.classList.add('on'); });
        li.addEventListener('pointerleave', function () { peek.classList.remove('on'); });
      });
      d.addEventListener('pointermove', function (e) { tx = e.clientX + 170; ty = e.clientY; });
      (function ploop() { px += (tx - px) * 0.12; py += (ty - py) * 0.12; peek.style.left = px + 'px'; peek.style.top = py + 'px'; requestAnimationFrame(ploop); })();
    }
  }

  // ---------- analítica: cuando la página ya es interactiva ----------
  var loadAnalytics = function () {
    W.dataLayer = W.dataLayer || [];
    W.gtag = function () { W.dataLayer.push(arguments); };
    W.gtag('js', new Date()); W.gtag('config', 'G-KH5PJ7J02K');
    var s = d.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=G-KH5PJ7J02K'; d.head.appendChild(s);
    W.clarity = W.clarity || function () { (W.clarity.q = W.clarity.q || []).push(arguments); };
    var c = d.createElement('script'); c.async = true; c.src = 'https://www.clarity.ms/tag/vds0d9yltz'; d.head.appendChild(c);
    d.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('[data-track]');
      if (a) W.gtag('event', a.getAttribute('data-track'), { event_category: 'engagement', page: location.pathname });
    });
  };
  if ('requestIdleCallback' in W) requestIdleCallback(loadAnalytics, { timeout: 4000 }); else setTimeout(loadAnalytics, 3000);
})();
