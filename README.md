# XUACHA RACE · sitio web e inscripciones

Sitio oficial de **XUACHA RACE**, carrera de MTB en Soacha, Cundinamarca.
Publicado con GitHub Pages en **https://www.xuacharace.com** (rama `main`, archivo `CNAME`).

Desarrollo: [SP Automatizaciones](https://stevp93.github.io/SP-AUTOMATIZACIONES-WEB).

---

## Estado (18 de noviembre de 2026)

| Parte | Estado |
| --- | --- |
| Sitio público (4 páginas) | Listo y publicado con este commit |
| Formulario de inscripción, resultado y panel de administración | Listos; inscripciones **cerradas** |
| API de cobro en Supabase | Desplegada y probada; sin llaves de pasarela |
| **Plataforma de pagos** | **Pendiente de definir.** Hay un adaptador de Wompi implementado; ver [`backend/README.md`](backend/README.md) |
| Fecha y valores de la edición 2027 | Por anunciar (el sitio no los muestra a propósito) |

Mientras no se defina la pasarela, la API rechaza nuevas inscripciones (`registration_open = false`)
y responde 503 a cualquier intento de pago. El sitio público no depende de esto.

---

## Estructura

```
index.html            Inicio: película por scroll, rutas, cifras, pasos e inscripción
recorrido.html        Competencia 40 km y travesía 25 km
experiencia.html      Lo que incluye la inscripción
info.html             Preguntas frecuentes, contacto y documentos
inscripcion.html      Formulario de inscripción (datos → carrera → pago)
resultado.html        Página de regreso después del pago
admin.html            Panel de organización (pagos, conciliación, códigos y QR)

assets/
  css/site.css        Estilos y sistema de movimiento del sitio público
  css/fonts.css       Oswald y Roboto autoalojadas (licencia OFL en assets/fonts/)
  css/inscripcion.css, css/admin.css
  js/site.js          Motor de animación: película, pines, parallax, cursor, analítica diferida
  js/inscripcion.js, js/admin.js, js/xr-api.js
  js/xr-config.js     Configuración pública del formulario (URL de la API, WhatsApp de soporte)
  film/d/             121 fotogramas WebP de la portada, horizontales 1924×1076 (escritorio y tabletas)
  film/m/             121 fotogramas WebP verticales 720×1076 para celular, con paneo que sigue al ciclista
  img/brand/          Logo oficial en SVG: completo, símbolo y palabra
  img/favicon.svg, img/apple-touch-icon.png, img/og-xuacha-race.jpg   Íconos e imagen para redes
  img/scene-*.webp    Fondos de las páginas internas y póster de la portada
  img/spa/            Marca SP Automatizaciones
  img/sponsors/, video/   Material de la edición 2026; ya no se enlaza desde el sitio

backend/              Sistema de cobro (Supabase + respaldo en Node). Ver backend/README.md
tools/
  generar_paginas.py      Genera las 4 páginas públicas con una cabecera y un pie comunes
  extraer_fotogramas.sh   Convierte un video en la secuencia de fotogramas de la portada
Documentos/           Reglamento y libro de ruta 2026 (PDF)
```

## Marca

Logo oficial de XUACHA RACE: figura de inspiración muisca con cabeza de sol y la palabra
"XuachaRace" con trazo de pincel (el mismo del perfil @xuacharace y de `assets/video/logo_xuacha.mp4`).
Se vectorizó a partir del video original en 2160 px y está en `assets/img/brand/`:

| Archivo | Uso |
| --- | --- |
| `xr-logo.svg` | Logo completo: portada, pie de página, imagen para redes |
| `xr-simbolo.svg` | Solo la figura: cabecera, pantalla de carga, favicon |
| `xr-palabra.svg` | Solo la palabra: cabecera junto al símbolo |

Color: crema `#EACFB5`, tomado del video del logo. En Instagram el logo aparece en amarillo
dorado; para cambiar el color basta con editar el atributo `fill` de los SVG.

Dónde aparece: cabecera de todas las páginas (símbolo + palabra), pantalla de carga (el símbolo
se llena de abajo arriba con el porcentaje), primer cuadro de la película de la portada, pie de
página, favicon e ícono de inicio en iPhone, e imagen que se muestra al compartir el enlace.

## Diseño y movimiento

Dirección visual: cine de montaña y cinta de carrera. Negro profundo, naranja de largada
(`#FF5722`) y lima (`#C4F82A`), con Oswald para titulares y Roboto para texto.

- **Película por scroll (inicio).** Un video generado con IA (toma continua de dron siguiendo a un
  ciclista por una cresta andina al atardecer) se convirtió en 121 fotogramas. Un `<canvas>` fijo
  dibuja el fotograma que corresponde al avance del scroll, con `requestAnimationFrame` y
  `devicePixelRatio`. Encima, los textos cambian por etapas (`XUACHA RACE` → `NO SE PEDALEA` →
  `SE CONQUISTA` → `40 · 25 KM` → llamado a inscribirse) y un contador de 0 a 40 km.
- **Carga progresiva.** Primero se descarga uno de cada ocho fotogramas para que el scroll funcione
  de inmediato y luego el resto. La pantalla de carga se retira al 35 % o a los 4,5 s, lo que ocurra
  antes.
- **Calidad en celular.** Un teléfono en vertical muestra el fotograma por su altura. Por eso el
  juego de celular no es una versión reducida del horizontal (eso obligaba a ampliarlo más de 3 veces
  y se veía pixelado), sino un recorte vertical de 720×1076 a la resolución nativa del video, con un
  paneo que mantiene al ciclista centrado. Se usa cuando la pantalla es vertical y mide menos de
  900 px de ancho; en el resto se usa el juego horizontal.
- **Rutas en horizontal.** La sección se fija y los paneles avanzan de lado mientras se baja.
- **Otros efectos.** Cintas diagonales, manifiesto que se ilumina palabra por palabra, títulos que
  suben línea por línea, cifras animadas, parallax en fondos, barras de terreno, vista previa que
  sigue al cursor (Experiencia), botones magnéticos, cursor propio y transición entre páginas con
  View Transitions.
- **Accesibilidad.** Con `prefers-reduced-motion` no hay película ni animaciones: se muestra un
  póster fijo y las secciones en vertical. Enlace para saltar al contenido, foco visible y menú
  móvil que se cierra con Escape.
- **Rendimiento.** Fuentes autoalojadas con precarga, imágenes WebP, carga diferida, y Google
  Analytics y Clarity solo cuando el navegador está inactivo.

Verificado a 1440 px y en celular de 375 y 390 px (densidad 3x): sin desbordamiento horizontal ni
errores de consola.

## Cómo hacer cambios

**Textos de las páginas públicas.** Editar `tools/generar_paginas.py` y ejecutar:

```bash
python tools/generar_paginas.py
```

El script sobrescribe `index.html`, `recorrido.html`, `experiencia.html` e `info.html`; un cambio
hecho a mano en esos archivos se pierde al volver a generarlos.

**Cambiar la película de la portada.** Con un video nuevo (toma continua, sin cortes ni texto):

```bash
tools/extraer_fotogramas.sh nuevo-video.mp4
```

Actualizar `data-frames` en `tools/generar_paginas.py` con el número que imprime el script y
regenerar las páginas.

**Publicar.** Ver `GUIA_ACTUALIZACION.txt`. GitHub Pages publica `main` en unos minutos.

## Inscripciones y pagos

El detalle técnico (esquema de base de datos, API, cuotas, conciliación, códigos de descuento,
recordatorios por WhatsApp, respaldo y pruebas) está en [`backend/README.md`](backend/README.md).

Antes de abrir inscripciones falta:

1. Definir la plataforma de pagos y configurar sus llaves en Supabase. El sitio público no nombra
   ninguna pasarela; el panel de administración y el backend sí mencionan Wompi porque es el
   adaptador implementado.
2. Configurar `ADMIN_API_KEY` e `INTERNAL_API_KEY` en Supabase.
3. Cargar fecha, valores y plan de cuotas de 2027 y abrir inscripciones.
4. Actualizar el prompt del agente de WhatsApp (`system_prompt_agente_whatsapp.md`), que todavía
   corresponde a 2026.

## Historial

Ver [`CHANGELOG.md`](CHANGELOG.md).
