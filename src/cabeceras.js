// Cabeceras de seguridad y tamaño de los cuerpos JSON (31-oct, pendientes de la revisión de seguridad).
//
// · CSP en modo informe (Content-Security-Policy-Report-Only): el navegador NO bloquea nada, solo avisa a
//   POST /api/csp-informe cada vez que la página hace algo que la política no permite. Sirve para medir, en producción
//   y con usuarios reales, qué faltaría arreglar antes de pasar a una CSP de bloqueo. No se pone de bloqueo todavía
//   porque hay <script> en línea (public/ingresar.html) y onclick= en varias pantallas que la política rechazaría.
// · Incrustación: /embed/:slug y /reservar/:slug se incrustan a propósito en el sitio del rentacar (embed.js), así que
//   van sin restricción. /portal/:token es la sesión del cliente (sus datos y documentos): nunca dentro de un iframe
//   ajeno (frame-ancestors 'none' + X-Frame-Options: DENY, las dos porque hay navegadores viejos que solo leen una).
//   El resto solo se incrusta desde el propio sitio (SAMEORIGIN; p. ej. la vista previa del portal en Configuración).
// · Cuerpo JSON: 2 MB por defecto para toda la API. Solo las rutas que reciben fotos, firmas o documentos como data URL
//   aceptan 25 MB; antes el límite de 25 MB regía para todo y cualquier ruta podía recibir un cuerpo enorme.
import { config } from './config.js';

// Orígenes externos que la pantalla usa hoy: mapas de OpenStreetMap (gps.html, vehiculo.html) y el formulario de pago
// que se envía a Webpay (reservar.html). Las fuentes IBM Plex y Leaflet se sirven desde el propio servidor.
export const POLITICA_CSP_INFORME = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // estilos en línea (style="…" y <style>) por todas las pantallas: se permiten
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "form-action 'self' https://webpay3g.transbank.cl https://webpay3gint.transbank.cl",
  'report-uri /api/csp-informe'
].join('; ');

export function cabecerasSeguridad(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // HSTS solo en producción (en desarrollo se entra por http://localhost y el navegador recordaría el «solo https»).
  if (config.produccion) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  if (req.path.startsWith('/api/')) {
    // La API no se guarda en caché (listas de clientes, pagos, contratos en un navegador compartido); las rutas que sí
    // se cachean (logo, archivos) ponen la suya después y mandan.
    res.setHeader('Cache-Control', 'no-store');
  } else {
    res.setHeader('Content-Security-Policy-Report-Only', POLITICA_CSP_INFORME);
  }
  if (req.path.startsWith('/portal')) {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  } else if (!req.path.startsWith('/reservar') && !req.path.startsWith('/embed')) {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  }
  next();
}

// Rutas que reciben fotos, firmas o documentos como data URL (base64 dentro del JSON) y por eso aceptan 25 MB.
// Al agregar una ruta nueva que reciba archivos, hay que sumarla aquí: si no, el cuerpo grande cae con 413.
export const RUTAS_CON_ARCHIVOS = [
  /^\/api\/archivos$/,                               // subida genérica (fotos de vehículos, ícono y capturas de las apps…)
  /^\/api\/empresa$/,                                // logo de la empresa (PATCH)
  /^\/api\/clientes\/\d+\/documentos$/,              // cédula y licencia del cliente
  /^\/api\/patio\/(inspecciones\/)?\d+\/fotos$/,     // fotos de la inspección (y su alias corto)
  /^\/api\/patio\/inspecciones\/\d+\/danos$/,        // daño nuevo con foto
  /^\/api\/patio\/danos\/\d+$/,                      // edición del daño con foto (PATCH)
  /^\/api\/patio\/inspecciones\/\d+\/completar$/,    // firma del cliente al completar la inspección
  /^\/api\/incidentes$/,                             // incidente con hasta 8 fotos
  /^\/api\/incidentes\/\d+\/nota$/,                  // nota con foto
  /^\/api\/portal\/r\/[^/]+\/documentos$/,           // documentos que el cliente sube desde el portal
  /^\/api\/firmar\/[^/]+$/,                          // firma dibujada del contrato (pública, por token)
  /^\/api\/apps\/solicitud\/firmar$/                 // firma dibujada de la autorización de las apps con marca
];

export const recibeArchivos = (req) => ['POST', 'PUT', 'PATCH'].includes(req.method) && RUTAS_CON_ARCHIVOS.some((r) => r.test(req.path));
