// Página pública del portal de reservas (/reservar/:slug y /embed/:slug) servida desde el servidor con el <head> listo.
//
// Auditoría 8-nov (On Rent #3 y #4): el portal es la página que el rentacar pone en su web y manda por WhatsApp, pero
// el título con el nombre del rentacar lo armaba JavaScript, y WhatsApp, Facebook o Google no lo ejecutan: la vista previa
// quedaba en «Reserva tu vehículo», sin descripción ni imagen. Además un slug que no existe respondía 200 (un «404
// blando» indexable). Ahora el servidor busca el rentacar, pone nombre, descripción, logo y canonical en el <head>, y
// responde 404 (con la misma página, que ya dice «No encontramos este rentacar») cuando no existe o no tiene el portal.
// El <script> de reservar.html no se toca: la CSP en modo informe lleva su hash (src/cabeceras.js).
import fs from 'node:fs';
import { uno, q } from '../db.js';
import { incluye } from '../planes.js';
import { config } from '../config.js';

const PLANTILLA = new URL('../../public/reservar.html', import.meta.url);
let plantilla = null;
const leerPlantilla = () => (config.produccion && plantilla) || (plantilla = fs.readFileSync(PLANTILLA, 'utf8'));

const escA = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Lista «Santiago, Temuco y Puerto Montt» con las ciudades (o comunas) de las sucursales, sin repetir. */
export function ciudadesDe(sucursales = []) {
  const vistas = [];
  for (const s of sucursales) {
    const c = String(s.ciudad || s.comuna || '').trim();
    if (c && !vistas.some((v) => v.toLowerCase() === c.toLowerCase())) vistas.push(c);
  }
  if (vistas.length <= 1) return vistas[0] || '';
  return `${vistas.slice(0, -1).join(', ')} y ${vistas[vistas.length - 1]}`;
}

/** Etiquetas del <head> para un rentacar (o para «no existe» si `empresa` es null). Pura: se prueba sin servidor. */
export function cabezaPortal({ empresa, sucursales = [], urlBase, embed = false }) {
  if (!empresa) {
    return { titulo: 'Reserva tu vehículo', etiquetas: '<meta name="robots" content="noindex">' };
  }
  const nombre = empresa.nombre;
  const url = `${urlBase}/reservar/${encodeURIComponent(empresa.slug)}`;
  const ciudades = ciudadesDe(sucursales);
  const descripcion = `Reserva en línea tu vehículo en ${nombre}: elige fechas y sucursal, revisa el precio y confirma tu reserva.${ciudades ? ` Sucursales en ${ciudades}.` : ''}`;
  const imagen = empresa.logo_clave ? `${urlBase}/api/logo/${encodeURIComponent(empresa.slug)}` : `${urlBase}/img/app/icono-512.png`;
  const titulo = `Reserva tu vehículo · ${nombre}`;
  const etiquetas = [
    `<meta name="description" content="${escA(descripcion)}">`,
    `<link rel="canonical" href="${escA(url)}">`,
    // El formulario incrustado repite el portal: el que se indexa es /reservar/:slug (canonical arriba).
    embed ? '<meta name="robots" content="noindex">' : '',
    '<meta property="og:type" content="website">',
    `<meta property="og:title" content="${escA(titulo)}">`,
    `<meta property="og:description" content="${escA(descripcion)}">`,
    `<meta property="og:url" content="${escA(url)}">`,
    `<meta property="og:image" content="${escA(imagen)}">`,
    `<meta property="og:site_name" content="${escA(nombre)}">`,
    '<meta property="og:locale" content="es_CL">',
    '<meta name="twitter:card" content="summary">'
  ].filter(Boolean).join('\n');
  return { titulo, etiquetas };
}

export function htmlPortal(datos) {
  const { titulo, etiquetas } = cabezaPortal(datos);
  return leerPlantilla().replace('<title>Reserva tu vehículo</title>', `<title>${escA(titulo)}</title>\n${etiquetas}`);
}

/** Express: GET /reservar/:slug y /embed/:slug. 404 si el rentacar no existe, está inactivo o no tiene el portal. */
export async function paginaPortal(req, res, next) {
  try {
    const embed = req.path.startsWith('/embed');
    const e = await uno('SELECT id, nombre, slug, logo_clave FROM empresas WHERE slug = $1 AND activa', [String(req.params.slug || '').toLowerCase()]);
    const valida = e && (await incluye(e.id, 'portal'));
    const sucursales = valida ? await q('SELECT comuna, ciudad FROM sucursales WHERE empresa_id = $1 AND activa ORDER BY id', [e.id]) : [];
    res.status(valida ? 200 : 404).type('html').setHeader('Cache-Control', 'no-cache');
    res.send(htmlPortal({ empresa: valida ? e : null, sucursales, urlBase: config.urlBase, embed }));
  } catch (err) { next(err); }
}
