# Cambios

## 2027.2 · 20 de noviembre de 2026 · auditoría de seguridad y pruebas de extremo a extremo

Pruebas: 37 de integración (13 nuevas de regresión) y 21 de extremo a extremo con navegador
contra la API real y un simulador de Wompi (`backend/tests/e2e/`). Producción revisada en modo
de solo lectura: CORS, firma de webhooks, rutas internas, IP del cliente y acceso a la base.

### Seguridad
- **Dependencias**: la función de Supabase corría Hono 4.6.14, con avisos de seguridad publicados
  (entre ellos ReDoS en el middleware de CORS). Pasa a Hono 4.13.19, postgres 3.4.9 y
  `@hono/node-server` 2.1.11 (el respaldo en Node tenía un aviso moderado). `npm audit`: 0.
- **Base de datos**: los roles públicos `anon` y `authenticated` tenían todos los permisos sobre
  las tablas, incluido `TRUNCATE`, frenados solo por RLS. La migración `20261120000000` los retira,
  también para tablas futuras.
- **Nombre**: se aceptaba cualquier texto (HTML, fórmulas de Excel, enlaces) que luego viajaba a
  los mensajes de WhatsApp enviados a un número escrito por quien se inscribe y a los CSV del
  panel. Ahora solo letras, espacios, apóstrofo y guion, y los mensajes usan el primer nombre
  recortado a 20 caracteres.
- **CSV del panel**: las celdas que empiezan por `=`, `+`, `-` o `@` se exportan como texto.
- **Límites de intentos**: nuevo límite de 5 inscripciones por día por número de WhatsApp, para
  que nadie use el formulario para llenar de mensajes un número ajeno. El de IP sube de 10 a 30
  por hora (redes móviles compartidas) y ya no lo gastan los errores de digitación.
- **IP del cliente**: verificado en producción que no se puede falsificar en Supabase. El servidor
  de respaldo ya no confía en encabezados enviados por el cliente (`TRUSTED_IP_HEADER`).
- **Cuerpos de más de 32 KB**: rechazados con 413 sin guardarlos en memoria ni procesarlos (antes
  se leían y se intentaban interpretar hasta 3 MB). Lo que sobra se descarta en lectura antes de
  responder: en Supabase, responder sin leer un cuerpo grande dejaba la conexión colgada.
- **Política de seguridad de contenido (CSP)** en inscripción, resultado y panel; el script y
  los estilos en línea de `resultado.html` pasan a archivos.

### Pagos y lógica de negocio
- Un código de un solo uso agotado, vencido o apagado se seguía cobrando con descuento a quien
  ya lo había aplicado. Ahora se revalida al abrir el pago y el formulario vuelve al paso 2 con
  el motivo.
- Un plan en cuotas elegido antes del cierre se podía pagar después, con el saldo ya vencido.
- Se podía abrir un segundo pago mientras otro seguía en proceso (riesgo de cobro doble).
- El cron podía vencer una inscripción mientras la persona estaba pagando en la pasarela.
- Si un pago se aprobaba sobre una inscripción ya vencida, la página de resultado se quedaba en
  "en proceso"; ahora informa que el pago quedó en revisión con la referencia.
- La API deduce el entorno de Wompi de la llave pública y `/health` avisa si no coinciden.

### Formulario
- **Otra persona en el mismo dispositivo**: no había forma de inscribir a una segunda persona
  desde el mismo teléfono; nuevo botón "Inscribir a otra persona".
- **WhatsApp mal escrito**: quien se equivocaba de número quedaba bloqueado 7 días (el código
  llegaba a otro número y el documento ya estaba ocupado). Nueva opción "Empieza de nuevo",
  solo para borradores sin pagos.
- El aviso "El pago en línea aún no está habilitado" se mostraba como "Sin conexión con el
  servidor".
- Distancias como `constructor` provocaban errores 500; datos inválidos del panel también.

## 2027.1 · 18 de noviembre de 2026

### Calidad de la animación en celular
- Causa: el juego de celular era el video reducido a 900×504. Un teléfono en vertical lo muestra
  por su altura, así que se ampliaba unas 3,3 veces y se veía pixelado.
- Solución: nuevo juego vertical de 720×1076 recortado a la resolución nativa del video, con
  paneo que sigue al ciclista (ampliación ≈1,5 veces). Se elige por orientación, no solo por ancho.
- El juego de escritorio pasa de 1600 px a la resolución nativa (1924×1076) y se activa el
  suavizado de alta calidad del canvas.
- `tools/extraer_fotogramas.sh` actualizado con estos parámetros (`PAN_START` y `PAN_END`).

### Logo oficial
- Logo vectorizado desde `assets/video/logo_xuacha.mp4` (2160 px) en tres versiones:
  `assets/img/brand/xr-logo.svg`, `xr-simbolo.svg` y `xr-palabra.svg`.
- Aplicado en la cabecera de todas las páginas, la pantalla de carga (el símbolo se llena con el
  porcentaje), el primer cuadro de la portada y el pie de página.
- Nuevo favicon, ícono para iPhone (`apple-touch-icon.png`) e imagen para compartir en redes
  (`og-xuacha-race.jpg`, 1200×630).

### Textos
- El sitio público, el formulario y la página de resultado ya no nombran a Wompi, porque la
  plataforma de pagos sigue sin definirse.

## 2027.0 · 18 de noviembre de 2026

Rediseño completo para la edición 2027 e infraestructura de inscripciones.

### Sitio público
- Paso de una sola página a cuatro: Inicio, Recorrido, Experiencia e Información.
- Portada con película controlada por el scroll: 121 fotogramas de un video generado con IA,
  dibujados en `<canvas>`, con textos por etapas y contador de distancia.
- Rutas en desplazamiento horizontal fijado, manifiesto que se ilumina con el scroll, cintas
  diagonales, títulos por líneas, cifras animadas, parallax, cursor propio y transiciones entre
  páginas (View Transitions).
- Versión sin movimiento para `prefers-reduced-motion`.
- Fuentes Oswald y Roboto autoalojadas; analítica (GA4 y Clarity) diferida.
- Se retiraron del sitio los patrocinadores de 2026; solo queda la marca SP Automatizaciones.
  Las imágenes siguen en `assets/img/sponsors/` y pueden borrarse.
- El sitio no muestra fecha ni valores de 2027 hasta que se anuncien.
- Herramientas `tools/generar_paginas.py` y `tools/extraer_fotogramas.sh`.

### Inscripciones
- `inscripcion.html`: inscripción como invitado en tres pasos (datos, carrera, pago), avance
  guardado y recuperación por enlace o código de WhatsApp, códigos de descuento por enlace o QR.
- `resultado.html`: página de regreso después del pago.
- `admin.html`: resumen, libro de pagos con CSV, control de inconsistencias y generación de
  códigos de descuento (generales, por persona o por lote) con QR.

### Backend (`backend/`)
- API en Hono para Supabase Edge Functions con servidor de respaldo en Node/Docker.
- PostgreSQL con RLS: participantes, inscripciones, cuotas, intentos de pago, eventos de webhook
  idempotentes, códigos de descuento, cola de notificaciones y auditoría.
- Cobro en dos cuotas (reserva y saldo) sin intereses, recordatorios por WhatsApp con n8n y
  Evolution API, y conciliación periódica.
- Adaptador de Wompi (Web Checkout con firma de integridad y verificación de eventos).
  **La plataforma de pagos definitiva está pendiente**; el checkout permanece deshabilitado.
- 24 pruebas de integración.

## 2026
- Sitio de una página de la edición 2026 con patrocinadores, documentos y enlaces rápidos.
