// Configuración del formulario de inscripción. Solo valores públicos: aquí no va ningún secreto.
window.XR_CONFIG = {
  // API principal (Supabase Edge Functions, proyecto "Pasarela pagos Xuacha Race 2027").
  apiBase: 'https://bxtmachwamcfugodthef.supabase.co/functions/v1/api',
  // API de respaldo en servidor propio, conectada a la misma base. Dejar vacío si no existe.
  fallbackApiBase: '',
  // Llave pública de Cloudflare Turnstile. Vacío = sin desafío anti-bot.
  turnstileSiteKey: '',
  // Dirección pública del sitio; se usa para armar los enlaces y QR de los códigos de descuento.
  siteUrl: 'https://www.xuacharace.com',
  // WhatsApp de soporte que se muestra en los mensajes de ayuda.
  supportWhatsapp: '573239335820'
};
