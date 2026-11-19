# Genera index.html, recorrido.html, experiencia.html e info.html con una sola cabecera y un solo pie.
# Uso:  python tools/generar_paginas.py   (Python 3.12+, sin dependencias)
# Sobrescribe esas cuatro páginas: los cambios de contenido se hacen aquí, no en el HTML generado.
import pathlib
OUT = pathlib.Path(__file__).resolve().parent.parent  # raíz del repositorio
WA = '573239335820'
WA_TXT = 'Hola,%20quiero%20informaci%C3%B3n%20sobre%20XUACHA%20RACE%202027'
ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
OUTL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>'

NAV = [('index.html', 'Inicio', '01'), ('recorrido.html', 'Recorrido', '02'), ('experiencia.html', 'Experiencia', '03'), ('info.html', 'Información', '04')]

def page(file, title, desc, body, track):
    links = ''.join(f'<a href="{h}"{" aria-current=\"page\"" if h == file else ""}>{t}</a>' for h, t, _ in NAV)
    mlinks = ''.join(f'<a href="{h}"{" aria-current=\"page\"" if h == file else ""}><small>{n}</small>{t}</a>' for h, t, n in NAV)
    return f'''<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:type" content="website">
<meta name="theme-color" content="#050505">
<meta property="og:image" content="https://www.xuacharace.com/assets/img/scene-1.webp">
<link rel="icon" href="assets/img/favicon.svg" type="image/svg+xml">
<link rel="preload" href="assets/fonts/oswald-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/css/fonts.css">
<link rel="stylesheet" href="assets/css/site.css">{'<link rel="preload" href="assets/img/scene-1.webp" as="image" fetchpriority="high">' if file == 'index.html' else ''}
<script>document.documentElement.classList.add('js')</script>
<script src="assets/js/site.js" defer></script>
</head>
<body>
<a class="skip" href="#main">Saltar al contenido</a>
{'<div class="loader" id="loader" aria-hidden="true"><div><b>00</b><span>Cargando la montaña</span><i></i></div></div>' if file == 'index.html' else ''}
<header class="nav">
  <div class="wrap">
    <a class="brand" href="index.html" aria-label="XUACHA RACE, inicio">XUACHA <span>RACE</span></a>
    <nav class="nav-links" aria-label="Principal">{links}</nav>
    <a class="btn btn-primary btn-sm nav-cta" href="inscripcion.html" data-track="inscripcion_nav">Inscripción</a>
    <button class="menu-btn" id="menu-btn" type="button" aria-expanded="false" aria-controls="menu" aria-label="Abrir menú"><span></span></button>
  </div>
</header>
<nav class="menu" id="menu" aria-label="Menú">{mlinks}<a class="btn btn-primary" href="inscripcion.html" data-track="inscripcion_menu">Inscripción {ARROW}</a></nav>
<main id="main" tabindex="-1">
{body}
</main>
<footer class="footer">
  <div class="wrap">
    <p class="giant" aria-hidden="true">Xuacha <span>Race</span></p>
    <div class="top">
      <div>
        <p class="tagline">Xuacha no se pedalea, se conquista. Carrera de MTB en Soacha, Cundinamarca.</p>
      </div>
      <nav aria-label="Pie de página">
        <a href="recorrido.html">Recorrido</a><a href="experiencia.html">Experiencia</a><a href="info.html">Información</a><a href="inscripcion.html">Inscripción</a>
        <a href="https://wa.me/{WA}?text={WA_TXT}" rel="noopener">WhatsApp</a><a href="https://www.instagram.com/xuacharace" rel="noopener">Instagram</a>
      </nav>
    </div>
    <div class="base">
      <span>© 2027 XUACHA RACE</span>
      <a class="made" href="https://stevp93.github.io/SP-AUTOMATIZACIONES-WEB" rel="noopener" aria-label="Desarrollado por SP Automatizaciones">
        <span>Desarrollado por</span><img src="assets/img/spa/spa-logo-negativo-web.svg" alt="SP Automatizaciones" width="147" height="32" loading="lazy">
      </a>
    </div>
  </div>
</footer>
</body>
</html>
'''

BEATS = [
    (0.24, 0.42, '<p class="say"><small>Xuacha</small>No se<br><span class="o">pedalea</span></p>', ''),
    (0.46, 0.64, '<p class="say"><small>Xuacha</small>Se<br><span class="outline">conquista</span></p>', ''),
    (0.68, 0.80, '<p class="say"><small>Dos distancias · una montaña</small>40 <span class="o">·</span> 25<br><span class="l">KM</span></p>', ''),
]
HOME = f'''<section class="film" id="film" data-frames="121" data-d="assets/film/d/" data-m="assets/film/m/" aria-label="Presentación">
  <div class="film-stage">
    <img class="poster" src="assets/img/scene-1.webp" alt="" width="1920" height="1074" fetchpriority="high">
    <canvas aria-hidden="true"></canvas>
    <div class="shade"></div>
    <div class="copy">
      <div class="beat" data-a="0" data-b="0.2" style="--o:1">
        <h1 class="title"><span>Xuacha</span><span class="outline">Race</span></h1>
      </div>
      {"".join(f'<div class="beat" data-a="{a}" data-b="{b}" aria-hidden="true">{h}</div>' for a, b, h, _ in BEATS)}
      <div class="beat final" data-a="0.84" data-b="1" data-keep>
        <h2>La montaña<br><span class="o">te espera</span></h2>
        <p>Carrera de MTB en Soacha, Cundinamarca. Single track, ascensos largos y el sur de la sabana en una sola jornada.</p>
        <div class="actions">
          <a class="btn btn-primary" href="inscripcion.html" data-track="inscripcion_hero">Quiero correr {ARROW}</a>
          <a class="btn btn-ghost" href="recorrido.html">Ver el recorrido</a>
        </div>
      </div>
    </div>
    <div class="hud" aria-hidden="true">
      <div class="km">Distancia<b><span id="km">00.0</span><i>KM</i></b></div>
      <div class="track"></div>
      <div class="hint">Desliza</div>
    </div>
  </div>
</section>

<div class="tapes" aria-hidden="true">
  <div class="tape a"><div>{"".join(f"<span>{w}</span>" for w in ["Xuacha no se pedalea", "Se conquista", "Edición 2027", "Soacha"] * 4)}</div></div>
  <div class="tape b"><div>{"".join(f"<span>{w}</span>" for w in ["Single track", "40 km", "Montaña", "25 km", "Comunidad MTB"] * 4)}</div></div>
</div>

<section class="section">
  <div class="wrap">
    <span class="eyebrow rv">Manifiesto</span>
    <p class="manifesto">Aquí no hay atajos. Hay <em>ascensos largos</em>, sendero angosto, polvo en la cara y una cima que se gana a pulso. Al final no importa el tiempo: importa que <strong>llegaste</strong>.</p>
  </div>
</section>

<section class="hscroll" aria-label="Las rutas">
  <div class="pin">
    <div class="lbl"><span class="eyebrow" style="margin:0">Las rutas</span><b data-hcount>01 / 05</b></div>
    <div class="row">
      <article class="panel">
        <img src="assets/img/scene-1.webp" alt="Ciclista en un sendero de cresta al atardecer" width="1920" height="1074" loading="lazy">
        <span class="big o" aria-hidden="true">40</span>
        <h3>Competencia 40 km</h3>
        <p>Alta exigencia. Ascensos largos, bajadas técnicas y seis categorías por edad.</p>
        <a class="btn btn-ghost btn-sm more" href="recorrido.html#40k">Ver la ruta {ARROW}</a>
      </article>
      <article class="panel">
        <img src="assets/img/scene-2.webp" alt="Sendero de montaña entre crestas y polvo dorado" width="1920" height="1074" loading="lazy">
        <span class="big l" aria-hidden="true">25</span>
        <h3>Travesía 25 km</h3>
        <p>La misma montaña con menos kilómetros. Categorías femenina y masculina.</p>
        <a class="btn btn-ghost btn-sm more" href="recorrido.html#25k">Ver la ruta {ARROW}</a>
      </article>
      <article class="panel text">
        <span class="num">60<small style="color:#120400">%</small></span>
        <div><h3>Single track</h3><p>Del recorrido de 40 km en la edición 2026. Sendero de verdad, no carretera.</p></div>
      </article>
      <article class="panel">
        <img src="assets/img/scene-3.webp" alt="Panorama de cordillera con nevados al fondo" width="1920" height="1074" loading="lazy">
        <h3>Parque Cagua</h3>
        <p>Salida y meta en Soacha. Al sur de la sabana, donde empieza la montaña.</p>
        <a class="btn btn-ghost btn-sm more" href="https://maps.app.goo.gl/X3mqiQ79FsT1rPMZA" rel="noopener">Abrir mapa {OUTL}</a>
      </article>
      <article class="panel text lime">
        <span class="num">8</span>
        <div><h3>Categorías</h3><p>Entre las dos distancias, para mujeres y hombres.</p></div>
      </article>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="head"><span class="eyebrow rv">Edición 2026 en cifras</span><h2 class="h2 split"><span class="line"><span>Lo que se</span></span><span class="line"><span class="o">vivió</span></span></h2></div>
    <div class="figures">
      <div class="fig rv"><span class="num" data-count="40">40<small>KM</small></span><p>De competencia, de principio a fin en montaña.</p></div>
      <div class="fig rv" style="--d:1"><span class="num" data-count="1500">1500<small>M+</small></span><p>De desnivel positivo en la ruta larga.</p></div>
      <div class="fig rv" style="--d:2"><span class="num" data-count="60">60<small>%</small></span><p>Del recorrido largo por single track.</p></div>
      <div class="fig rv" style="--d:3"><span class="num" data-count="8">8</span><p>Categorías entre las dos distancias.</p></div>
    </div>
  </div>
</section>

<section class="section tight">
  <div class="wrap">
    <div class="head"><span class="eyebrow rv">Inscripción</span><h2 class="h2 split"><span class="line"><span>Tres pasos</span></span><span class="line"><span>y <span class="l">a rodar</span></span></span></h2>
    <p class="lead rv">Sin crear cuenta ni contraseña. Tu avance queda guardado y lo retomas desde el enlace que llega a tu WhatsApp.</p></div>
    <div class="steps">
      <article class="step rv"><b>01</b><h3>Tus datos</h3><p>Nombre, documento, correo y WhatsApp. Nada más para empezar.</p></article>
      <article class="step rv"><b>02</b><h3>Tu carrera</h3><p>Eliges distancia y categoría. Si tienes un código de descuento, se aplica aquí.</p></article>
      <article class="step rv"><b>03</b><h3>Tu pago</h3><p>Pago completo o reserva más saldo, sin intereses. Tarjeta, PSE o Nequi en la página segura de Wompi.</p></article>
    </div>
  </div>
</section>

<section class="maker">
  <div class="band" aria-hidden="true"></div>
  <div class="wrap">
    <img class="logo rv" src="assets/img/spa/spa-logo-horizontal.svg" alt="SP Automatizaciones" width="293" height="64" loading="lazy">
    <div class="rv" style="--d:1">
      <span class="eyebrow">Tecnología del evento</span>
      <h2>Inscripciones, pagos y avisos, automatizados</h2>
      <p>La web, el sistema de cobro en cuotas y los recordatorios por WhatsApp de XUACHA RACE son desarrollo de SP Automatizaciones, agencia de automatización e inteligencia artificial de Soacha.</p>
      <a class="btn btn-dark" href="https://stevp93.github.io/SP-AUTOMATIZACIONES-WEB" rel="noopener">Conocer SP Automatizaciones {OUTL}</a>
    </div>
  </div>
</section>

<section class="cta" style="isolation:isolate">
  <img class="bgimg" data-par="-0.12" src="assets/img/scene-3.webp" alt="" width="1920" height="1074" loading="lazy">
  <div class="wrap">
    <span class="eyebrow rv">Edición 2027</span>
    <h2 class="h2 split"><span class="line"><span>¿Subes</span></span><span class="line"><span class="outline">o miras?</span></span></h2>
    <p class="lead rv">Fecha y valores por anunciar. Escríbenos y te avisamos primero.</p>
    <div class="actions rv">
      <a class="btn btn-primary" href="inscripcion.html" data-track="inscripcion_cta">Inscripción {ARROW}</a>
      <a class="btn btn-ghost" href="https://wa.me/{WA}?text={WA_TXT}" rel="noopener" data-track="whatsapp_cta">Avísame por WhatsApp</a>
    </div>
  </div>
</section>'''

def phero(eyebrow, lines, lead, img):
    h = ''.join(f'<span class="line"><span>{l}</span></span>' for l in lines)
    return f"""<section class="page-hero">
  <img class="bgimg" data-par="-0.18" data-zoom src="assets/img/{img}" alt="" width="1920" height="1074" fetchpriority="high">
  <div class="wrap">
    <span class="eyebrow">{eyebrow}</span>
    <h1 class="split">{h}</h1>
    <p class="lead rv" style="--d:3">{lead}</p>
  </div>
</section>"""

RUTA = phero('Recorrido', ['Elige tu', '<span class="o">distancia</span>'], 'Las dos rutas salen del Parque Cagua de Soacha. Los datos de terreno y desnivel son los de la edición 2026; el recorrido 2027 se confirma en el libro de ruta.', 'scene-2.webp') + f"""
<div class="tapes" aria-hidden="true" style="height:clamp(160px,20vw,260px)">
  <div class="tape a"><div>{"".join(f"<span>{w}</span>" for w in ["Competencia 40 km", "Travesía 25 km", "Parque Cagua"] * 5)}</div></div>
</div>
<div class="wrap">
  <article class="route" id="40k">
    <div class="big rv">40<small>Competencia</small></div>
    <div class="rv" style="--d:1">
      <h2>Competencia 40 km</h2>
      <p>Para quien viene a pelear la categoría. Mucho sendero, ascensos largos y bajadas técnicas.</p>
      <div class="stats">
        <div class="stat"><span>Desnivel positivo</span><strong>1.500+ m</strong></div>
        <div class="stat"><span>Nivel</span><strong>Alta exigencia</strong></div>
      </div>
      <div class="bars" aria-label="Composición del terreno">
        <div class="bar"><span>Single track</span><span>60 %</span><i><b style="--v:60%"></b></i></div>
        <div class="bar"><span>Camino rural</span><span>30 %</span><i><b style="--v:30%"></b></i></div>
        <div class="bar"><span>Asfalto</span><span>10 %</span><i><b style="--v:10%"></b></i></div>
      </div>
      <h3 class="sub">Categorías</h3>
      <ul class="chips"><li>Open Femenino · 18–29</li><li>Master A Femenino · 30+</li><li>Open Masculino · 18–29</li><li>Master A Masculino · 30–39</li><li>Master B Masculino · 40–49</li><li>Master C Masculino · 50+</li></ul>
    </div>
  </article>
  <article class="route" id="25k">
    <div class="big rv"><span class="l">25</span><small>Travesía</small></div>
    <div class="rv" style="--d:1">
      <h2>Travesía 25 km</h2>
      <p>La misma montaña con menos kilómetros. Ideal para un primer reto de montaña o para rodar en grupo.</p>
      <div class="stats">
        <div class="stat"><span>Desnivel positivo</span><strong>900+ m</strong></div>
        <div class="stat"><span>Nivel</span><strong>Exigencia media</strong></div>
      </div>
      <h3 class="sub">Categorías</h3>
      <ul class="chips"><li>Femenino</li><li>Masculino</li></ul>
    </div>
  </article>
</div>
<section class="section tight">
  <div class="wrap">
    <div class="links two">
      <a class="linkrow rv" href="https://maps.app.goo.gl/X3mqiQ79FsT1rPMZA" rel="noopener"><div><span>Punto de partida</span><strong>Parque Cagua, Soacha</strong></div>{OUTL}</a>
      <a class="linkrow rv" href="Documentos/LIBRO%20DE%20RUTA%20XR%20.pdf" rel="noopener" style="--d:1"><div><span>Referencia</span><strong>Libro de ruta 2026 (PDF)</strong></div>{OUTL}</a>
    </div>
  </div>
</section>"""

INC = [('Número de corredor', 'Tu dorsal para la ruta y la clasificación.'), ('Medalla finisher', 'Para todos los que cruzan la meta.'),
       ('Ruta marcada', 'Señalización completa en todo el recorrido.'), ('Hidratación', 'Puntos de abastecimiento en ruta.'),
       ('Almuerzo', 'Al terminar, en la zona de meta.'), ('Asistencia mecánica', 'Apoyo para resolver fallas en ruta.'),
       ('Seguro de accidentes', 'Cobertura durante la carrera.'), ('Fotografía profesional', 'Fotos de la jornada para cada corredor.')]
SC = ['scene-1.webp', 'scene-2.webp', 'scene-3.webp']
EXP = phero('Experiencia', ['Más que una', '<span class="outline">carrera</span>'], 'Lo que viviste en 2026 y lo que vuelve en 2027. La lista definitiva se confirma al abrir inscripciones.', 'scene-3.webp') + f"""
<section class="section">
  <div class="wrap">
    <span class="eyebrow rv">Actitud</span>
    <p class="manifesto">Llegas con nervios, sales con <em>barro hasta las rodillas</em> y una medalla que nadie te regaló. Eso es <strong>Xuacha</strong>.</p>
  </div>
</section>
<section class="section tight">
  <div class="wrap">
    <div class="head"><span class="eyebrow rv">Tu inscripción incluye</span><h2 class="h2 split"><span class="line"><span>Todo listo</span></span><span class="line"><span>para <span class="o">rodar</span></span></span></h2></div>
    <ol class="inc">{"".join(f'<li class="rv" data-img="assets/img/{SC[i % 3]}"><h3>{a}</h3><p>{b}</p></li>' for i, (a, b) in enumerate(INC))}</ol>
    <p class="note">Contenido incluido en la edición 2026.</p>
  </div>
  <div class="peek" aria-hidden="true"><img src="assets/img/scene-1.webp" alt=""></div>
</section>
<section class="section tight">
  <div class="wrap">
    <div class="duo">
      <article class="card rv"><span class="eyebrow">Seguridad</span><h3>Nadie se queda atrás</h3><p>Personal médico, ambulancia y carro escoba acompañan la carrera de principio a fin.</p></article>
      <article class="card rv" style="--d:1"><span class="eyebrow">Premiación</span><h3>Podio por categoría</h3><p>Reconocimiento para los tres primeros lugares de cada categoría, con ceremonia al cierre de la jornada. Las condiciones de 2027 se publican en el reglamento.</p></article>
      <article class="card rv"><span class="eyebrow">Jersey oficial</span><h3>Diseño exclusivo</h3><p>Compra adicional a la inscripción, con fecha límite de pedido antes de la carrera. Se anuncia con la apertura.</p></article>
      <article class="card rv" style="--d:1"><span class="eyebrow">Kit</span><h3>Entrega antes del evento</h3><p>El kit se recoge en los días previos a la carrera. El día del evento no se entregan kits.</p></article>
    </div>
  </div>
</section>"""

FAQ = [('¿Cuándo es la edición 2027 y cuánto cuesta?', 'La fecha y los valores se anuncian con la apertura de inscripciones. Escríbenos por WhatsApp y te avisamos primero.'),
       ('¿Puedo pagar en cuotas?', 'Sí. Puedes pagar todo de una vez o pagar una reserva hoy y el saldo antes de la fecha límite. No hay intereses ni estudio de crédito, y te recordamos el saldo por WhatsApp.'),
       ('¿Qué medios de pago aceptan?', 'El pago se hace en la página segura de Wompi: tarjeta débito o crédito, PSE y Nequi, entre otros. Esta web nunca pide ni guarda datos de tu tarjeta.'),
       ('Empecé mi inscripción y no la terminé. ¿Qué hago?', 'Abre el enlace que te enviamos por WhatsApp, o entra a Inscripción, elige "Ya empecé mi inscripción" y escribe tu documento. Te enviamos un código para retomarla donde quedó.'),
       ('Tengo un código de descuento. ¿Dónde lo uso?', 'En el paso "Tu carrera". Si lo recibiste como enlace o QR, al abrirlo el código se aplica solo.'),
       ('¿Hay devoluciones?', 'La política de devoluciones y cesión de cupo de 2027 se publica en el reglamento de la edición.')]
INFO = phero('Información', ['Lo que', '<span class="l">necesitas</span>', 'saber'], 'Pagos, cuotas, inscripción y contacto.', 'scene-1.webp') + f"""
<section class="section">
  <div class="wrap">
    <div class="head"><span class="eyebrow rv">Preguntas frecuentes</span><h2 class="h2 split"><span class="line"><span>Antes de</span></span><span class="line"><span class="o">inscribirte</span></span></h2></div>
    <div class="faq">{"".join(f'<details class="rv"><summary>{q}</summary><p>{a}</p></details>' for q, a in FAQ)}</div>
  </div>
</section>
<section class="section tight">
  <div class="wrap">
    <div class="head"><span class="eyebrow rv">Contacto</span><h2 class="h2 split"><span class="line"><span>Hablemos</span></span></h2></div>
    <div class="links two">
      <a class="linkrow rv" href="https://wa.me/{WA}?text={WA_TXT}" rel="noopener" data-track="whatsapp_info"><div><span>WhatsApp</span><strong>+57 323 933 5820</strong></div>{OUTL}</a>
      <a class="linkrow rv" href="mailto:Xuacharace2026@gmail.com" style="--d:1"><div><span>Correo</span><strong>Xuacharace2026@gmail.com</strong></div>{OUTL}</a>
      <a class="linkrow rv" href="https://www.instagram.com/xuacharace" rel="noopener"><div><span>Instagram</span><strong>@xuacharace</strong></div>{OUTL}</a>
      <a class="linkrow rv" href="https://maps.app.goo.gl/X3mqiQ79FsT1rPMZA" rel="noopener" style="--d:1"><div><span>Punto de partida</span><strong>Parque Cagua, Soacha</strong></div>{OUTL}</a>
    </div>
    <div class="head" style="margin:56px 0 20px"><span class="eyebrow rv">Documentos de referencia</span></div>
    <div class="links two">
      <a class="linkrow rv" href="Documentos/ReglamentoXR.pdf" rel="noopener"><div><span>PDF · Edición 2026</span><strong>Reglamento</strong></div>{OUTL}</a>
      <a class="linkrow rv" href="Documentos/LIBRO%20DE%20RUTA%20XR%20.pdf" rel="noopener" style="--d:1"><div><span>PDF · Edición 2026</span><strong>Libro de ruta</strong></div>{OUTL}</a>
    </div>
  </div>
</section>"""

D = 'Carrera de MTB en Soacha, Cundinamarca. Competencia de 40 km y travesía de 25 km.'
for f, t, d, b in [('index.html', 'XUACHA RACE 2027 · Carrera MTB en Soacha', D, HOME),
                   ('recorrido.html', 'Recorrido · XUACHA RACE 2027', 'Competencia 40 km y travesía 25 km desde el Parque Cagua de Soacha.', RUTA),
                   ('experiencia.html', 'Experiencia · XUACHA RACE 2027', 'Lo que incluye la inscripción a XUACHA RACE.', EXP),
                   ('info.html', 'Información · XUACHA RACE 2027', 'Pagos en cuotas, inscripción, preguntas frecuentes y contacto de XUACHA RACE.', INFO)]:
    (OUT / f).write_text(page(f, t, d, b, None), encoding='utf-8')
print('ok')
