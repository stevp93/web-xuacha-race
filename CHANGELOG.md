# Cambios

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
