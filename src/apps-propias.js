// Apps con la marca del cliente (marca blanca), como en Síguelo On Bus: la empresa con el módulo «app_propia»
// pide su app del equipo (el sistema para su personal) y su app de clientes (reservas en línea) con su nombre,
// ícono, logo, color y textos de la tienda; firma en línea la autorización y licencia de uso de marca para que
// Síguelo GPS las publique en Google Play; Síguelo revisa, observa o aprueba, y al aprobar se dispara la
// compilación en GitHub Actions (.github/workflows/apps-propias.yml), que sube aquí el APK y el AAB.
import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import { q, uno } from './db.js';
import { ErrorHttp } from './auth.js';
import { cifrar, descifrar } from './cifrado.js';
import { validarRut, formatearRut } from './util/rut.js';
import { fecha as fFecha, hora as fHora } from './util/formato.js';
import { encolar } from './salidas.js';
import { leerArchivo } from './almacenamiento/index.js';

export const APPS = {
  equipo: { nombre: 'App del equipo', descripcion: 'El sistema Síguelo On Rent con tu marca para tu personal: reservas, entregas y devoluciones con fotos, contratos y flota.' },
  clientes: { nombre: 'App de clientes', descripcion: 'Reservas en línea con tu marca para tus clientes: cotizar, reservar, pagar y subir sus documentos.' }
};
export const ESTADOS = {
  borrador: 'Borrador', enviada: 'Enviada', en_revision: 'En revisión', con_observaciones: 'Con observaciones',
  compilando: 'App en desarrollo', lista: 'Lista para tienda', publicada: 'Publicada'
};
export const EDITABLES = ['borrador', 'con_observaciones'];
export const FIRMADA = ['enviada', 'en_revision', 'compilando', 'lista', 'publicada'];
export const APROBADA = ['compilando', 'lista', 'publicada'];
// Cambios que hace Síguelo desde el backoffice (la aprobación, que dispara la compilación, va aparte).
export const CAMBIOS_SIGUELO = {
  enviada: ['en_revision', 'con_observaciones'],
  en_revision: ['con_observaciones', 'enviada'],
  compilando: ['lista', 'con_observaciones', 'en_revision'],
  lista: ['publicada', 'compilando', 'con_observaciones'],
  publicada: ['lista'],
  con_observaciones: ['en_revision']
};
export const PAQUETE_BASE = 'cl.siguelogps.onrent';
export const VERSION_AUTORIZACION = 1;

export const sha256 = (d) => crypto.createHash('sha256').update(d).digest('hex');

/** JSON con las claves ordenadas: el mismo contenido siempre da el mismo hash. */
export function jsonCanonico(v) {
  if (Array.isArray(v)) return `[${v.map(jsonCanonico).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${jsonCanonico(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
export const hashContenido = (c) => sha256(jsonCanonico(c));

export function dimensionesPng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { ancho: buf.readUInt32BE(16), alto: buf.readUInt32BE(20) };
}

/** Segmento del paquete Android a partir del slug de la empresa («andes-rent» → «andesrent»). */
export function segmentoPaquete(slug) {
  const s = String(slug || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return (/^[a-z]/.test(s) ? s : `e${s}`).slice(0, 30);
}
export const paquete = (slug, app) => `${PAQUETE_BASE}.${segmentoPaquete(slug)}.${app}`;

const texto = (v, nombre, { requerido = false, max = 200 } = {}) => {
  const s = v == null ? '' : String(v).trim();
  if (!s && requerido) throw new ErrorHttp(400, `Falta ${nombre}.`);
  if (s.length > max) throw new ErrorHttp(400, `${nombre[0].toUpperCase()}${nombre.slice(1)} admite hasta ${max} caracteres.`);
  return s || null;
};
const color = (v) => {
  const s = String(v || '').trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(s)) throw new ErrorHttp(400, 'El color principal debe ser un color #RRGGBB (ej.: #0B5FFF).', { campo: 'color' });
  return s.toUpperCase();
};
const correo = (v, requerido) => {
  const s = String(v || '').trim().toLowerCase();
  if (!s) { if (requerido) throw new ErrorHttp(400, 'Falta el correo de soporte.', { campo: 'correo_soporte' }); return null; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw new ErrorHttp(400, 'El correo de soporte no es válido.', { campo: 'correo_soporte' });
  return s;
};

/** Datos que escribe el cliente. Con «completa» exige lo necesario para firmar y enviar. */
export function leerDatos(b = {}, { completa = false } = {}) {
  const r = { requerido: completa };
  const d = {
    nombre_equipo: texto(b.nombre_equipo, 'el nombre de la app del equipo', { ...r, max: 30 }),
    nombre_clientes: texto(b.nombre_clientes, 'el nombre de la app de clientes', { ...r, max: 30 }),
    color: b.color || completa ? color(b.color) : null,
    desc_corta_equipo: texto(b.desc_corta_equipo, 'la descripción corta de la app del equipo', { max: 80 }),
    desc_larga_equipo: texto(b.desc_larga_equipo, 'la descripción larga de la app del equipo', { max: 4000 }),
    desc_corta_clientes: texto(b.desc_corta_clientes, 'la descripción corta de la app de clientes', { max: 80 }),
    desc_larga_clientes: texto(b.desc_larga_clientes, 'la descripción larga de la app de clientes', { max: 4000 }),
    correo_soporte: correo(b.correo_soporte, completa),
    telefono_soporte: texto(b.telefono_soporte, 'el teléfono de soporte', { max: 40 })
  };
  // Las descripciones de la tienda son opcionales: si faltan, se parte de un texto base con el nombre de la app.
  if (completa) {
    d.desc_corta_equipo ||= `${d.nombre_equipo}: reservas, entregas, contratos y flota en tu teléfono.`.slice(0, 80);
    d.desc_corta_clientes ||= `${d.nombre_clientes}: arrienda tu vehículo en minutos.`.slice(0, 80);
    d.desc_larga_equipo ||= `${d.nombre_equipo} es la app para el equipo: reservas, entregas y devoluciones con fotos y checklist, contratos con firma digital, cobros y flota.`;
    d.desc_larga_clientes ||= `${d.nombre_clientes} es la app para arrendar: elige fechas y sucursal, cotiza con extras, reserva y paga en línea, y sube tus documentos antes de retirar.`;
  }
  return d;
}

/** Revisa que un archivo sea de la empresa y, para el ícono, que sea PNG de 512×512. */
export async function validarArchivo(empresaId, id, { tipo }) {
  if (id === null || id === undefined || id === '') return null;
  const a = await leerArchivo(empresaId, Number(id));
  if (!a) throw new ErrorHttp(400, 'El archivo no existe o no es de tu empresa.');
  if (tipo === 'icono') {
    if (a.fila.mime !== 'image/png') throw new ErrorHttp(400, 'El ícono debe ser un PNG de 512 × 512 píxeles.');
    const dim = dimensionesPng(a.datos);
    if (!dim || dim.ancho !== 512 || dim.alto !== 512) throw new ErrorHttp(400, `El ícono debe medir exactamente 512 × 512 píxeles${dim ? ` (el tuyo mide ${dim.ancho} × ${dim.alto})` : ''}.`);
  } else if (!['image/png', 'image/jpeg', 'image/webp'].includes(a.fila.mime)) {
    throw new ErrorHttp(400, tipo === 'logo' ? 'El logo debe ser una imagen PNG, JPG o WebP.' : 'Las capturas deben ser imágenes PNG, JPG o WebP.');
  }
  return Number(a.fila.id);
}

/** Texto de la autorización y licencia de uso de marca (lo que se firma). */
export function textoAutorizacion({ empresa, datos }) {
  const cliente = `${empresa.razon_social || empresa.nombre}${empresa.rut ? `, RUT ${formatearRut(empresa.rut)}` : ''}`;
  const apps = `«${datos.nombre_equipo || 'App del equipo'}» y «${datos.nombre_clientes || 'App de clientes'}»`;
  return [
    `1. Objeto. ${cliente} (en adelante, «el Cliente») autoriza a Tecnologías de Rastreo y Seguridad SpA, «Síguelo GPS» (en adelante, «Síguelo»), a compilar, firmar y publicar en Google Play, en la cuenta de desarrollador de Síguelo y en nombre y por cuenta del Cliente, las aplicaciones ${apps} (en adelante, «las Apps»), que operan sobre el sistema Síguelo On Rent que el Cliente tiene contratado.`,
    '2. Licencia de uso de marca. El Cliente otorga a Síguelo una licencia no exclusiva, gratuita, intransferible y revocable para usar su nombre comercial, logotipos, íconos, colores, capturas y textos entregados en esta solicitud, únicamente para identificar las Apps, su ficha en Google Play, sus pantallas y el material de soporte. Síguelo no adquiere ningún derecho sobre las marcas del Cliente.',
    '3. Titularidad y responsabilidad. El Cliente declara ser titular de las marcas y contenidos entregados, o contar con autorización suficiente para usarlos y licenciarlos, y se hace responsable ante cualquier reclamo de terceros por su uso. Declara además que los textos de la ficha son veraces.',
    '4. Políticas de Google Play. Síguelo podrá ajustar los textos, imágenes y la configuración de las Apps para cumplir las políticas de Google Play y sus requisitos técnicos, informando al Cliente. Google puede rechazar, retirar o exigir cambios a las Apps; Síguelo hará lo razonable para corregirlo, sin garantizar su aprobación.',
    '5. Cuenta, firma y actualizaciones. Las Apps se publican en la cuenta de desarrollador de Síguelo, firmadas con claves que Síguelo custodia, y el desarrollador visible en Google Play es Síguelo GPS. Síguelo publicará las actualizaciones necesarias mientras el servicio esté vigente.',
    '6. Datos personales. Las Apps tratan datos del personal y de los clientes del Cliente según la Política de privacidad de Síguelo On Rent. El Cliente es responsable de esos datos y Síguelo actúa como encargado de su tratamiento, conforme a la Ley 19.628 y sus modificaciones.',
    '7. Vigencia y término. Esta autorización rige mientras el Cliente tenga contratado el servicio. Al término del servicio, o si el Cliente revoca esta autorización con 30 días de aviso por escrito, Síguelo podrá despublicar las Apps de Google Play.',
    '8. Firma electrónica. Quien firma declara tener facultades para representar al Cliente y acepta que esta autorización se firme en línea mediante firma electrónica simple (Ley 19.799). Queda registro de la fecha, la dirección IP y el resumen criptográfico (hash SHA-256) del contenido firmado.'
  ];
}

export function contenidoFirmado({ solicitud, empresa, datos, archivos, firmante, fecha, ip, firmaSha256 }) {
  return {
    documento: 'Autorización y licencia de uso de marca · publicación en Google Play',
    version: VERSION_AUTORIZACION,
    solicitud: Number(solicitud.id),
    empresa: { id: Number(empresa.id), nombre: empresa.nombre, razon_social: empresa.razon_social || null, rut: empresa.rut || null },
    datos, archivos,
    paquetes: { equipo: paquete(empresa.slug, 'equipo'), clientes: paquete(empresa.slug, 'clientes') },
    autorizacion: textoAutorizacion({ empresa, datos }),
    firmante: { nombre: firmante.nombre, rut: firmante.rut, cargo: firmante.cargo, acepta: true },
    fecha, ip, firma_sha256: firmaSha256
  };
}

export function leerFirmante(b = {}) {
  const nombre = texto(b.nombre, 'el nombre de quien firma', { requerido: true, max: 120 });
  const cargo = texto(b.cargo, 'el cargo de quien firma', { requerido: true, max: 80 });
  if (!validarRut(b.rut)) throw new ErrorHttp(400, 'El RUT de quien firma no es válido.', { campo: 'rut' });
  return { nombre, rut: formatearRut(b.rut), cargo };
}

export function leerFirmaDibujada(v) {
  const m = String(v || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new ErrorHttp(400, 'Dibuja tu firma en el recuadro.');
  const buf = Buffer.from(m[1], 'base64');
  if (!dimensionesPng(buf) || buf.length > 600_000) throw new ErrorHttp(400, 'La firma dibujada no es válida.');
  if (buf.length < 400) throw new ErrorHttp(400, 'Dibuja tu firma en el recuadro.');
  return buf;
}

/** PDF de la autorización firmada. */
export async function pdfAutorizacion({ contenido, hash, firmaPng, logo = null }) {
  const NEGRO = '#15181D'; const GRIS = '#5B6170'; const LINEA = '#E3E6EA';
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true, info: { Title: `Autorización app propia · ${contenido.empresa.nombre}`, Author: 'Síguelo GPS', Subject: `sha256:${hash}`, Keywords: hash, Creator: 'Síguelo On Rent' } });
  const partes = [];
  doc.on('data', (b) => partes.push(b));
  const fin = new Promise((ok) => doc.on('end', () => ok(Buffer.concat(partes))));
  const x0 = 50; const ancho = doc.page.width - 100;
  if (logo) { try { doc.image(logo, x0 + ancho - 110, 46, { fit: [110, 44] }); } catch { /* formato no soportado */ } }
  doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text('SÍGUELO GPS · SÍGUELO ON RENT', x0, 50, { characterSpacing: 1 });
  doc.font('Helvetica-Bold').fontSize(16).fillColor(NEGRO).text('Autorización y licencia de uso de marca', x0, 64, { width: ancho - 120 });
  doc.font('Helvetica').fontSize(10).fillColor(GRIS).text('Publicación de apps propias en Google Play por Síguelo GPS', { width: ancho - 120 });
  let y = Math.max(doc.y, 100) + 10;
  doc.moveTo(x0, y).lineTo(x0 + ancho, y).lineWidth(2).strokeColor(NEGRO).stroke();
  y += 12;
  const fila = (k, v) => {
    doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text(k.toUpperCase(), x0, y, { width: 150, characterSpacing: 0.5 });
    doc.font('Helvetica').fontSize(10).fillColor(NEGRO).text(v || '—', x0 + 155, y, { width: ancho - 155 });
    y = Math.max(doc.y, y + 12) + 4;
  };
  const e = contenido.empresa; const d = contenido.datos;
  fila('Cliente', `${e.razon_social || e.nombre}${e.rut ? ` · RUT ${formatearRut(e.rut)}` : ''}`);
  fila('Solicitud', `N° ${contenido.solicitud}`);
  fila('App del equipo', `${d.nombre_equipo} · ${contenido.paquetes.equipo}`);
  fila('App de clientes', `${d.nombre_clientes} · ${contenido.paquetes.clientes}`);
  fila('Color principal', d.color);
  fila('Soporte', [d.correo_soporte, d.telefono_soporte].filter(Boolean).join(' · '));
  y += 6;
  for (const p of contenido.autorizacion) {
    if (y > doc.page.height - 120) { doc.addPage(); y = 50; }
    doc.font('Helvetica').fontSize(9.5).fillColor(NEGRO).text(p, x0, y, { width: ancho, align: 'justify', lineGap: 1.5 });
    y = doc.y + 7;
  }
  if (y > doc.page.height - 260) { doc.addPage(); y = 50; }
  y += 8;
  doc.rect(x0, y, ancho, 1).fill(LINEA);
  y += 12;
  const f = contenido.firmante;
  const cuando = new Date(contenido.fecha);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(NEGRO).text('Firma del representante', x0, y);
  y = doc.y + 6;
  try { doc.image(firmaPng, x0, y, { fit: [220, 90] }); } catch { /* sin imagen */ }
  doc.moveTo(x0, y + 94).lineTo(x0 + 230, y + 94).lineWidth(0.8).strokeColor(GRIS).stroke();
  doc.font('Helvetica-Bold').fontSize(10).fillColor(NEGRO).text(f.nombre, x0, y + 100, { width: 230 });
  doc.font('Helvetica').fontSize(9).fillColor(GRIS).text(`RUT ${f.rut} · ${f.cargo}`, { width: 230 }).text('Aceptó la autorización y la licencia de uso de marca.', { width: 230 });
  const xr = x0 + 260; const wr = ancho - 260;
  doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text('FECHA Y HORA (CHILE)', xr, y, { characterSpacing: 0.5 });
  doc.font('Helvetica').fontSize(10).fillColor(NEGRO).text(`${fFecha(cuando)} ${fHora(cuando)}`, xr, doc.y + 1, { width: wr });
  doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text('DIRECCIÓN IP', xr, doc.y + 6, { characterSpacing: 0.5 });
  doc.font('Helvetica').fontSize(10).fillColor(NEGRO).text(contenido.ip || '—', xr, doc.y + 1, { width: wr });
  doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text('HASH SHA-256 DEL CONTENIDO', xr, doc.y + 6, { characterSpacing: 0.5 });
  doc.font('Courier').fontSize(8).fillColor(NEGRO).text(hash, xr, doc.y + 1, { width: wr });
  y = Math.max(doc.y, y + 150) + 18;
  doc.font('Helvetica').fontSize(7.5).fillColor(GRIS).text('El hash se calcula sobre el contenido firmado (datos de la solicitud, archivos, texto de la autorización, firmante, fecha, IP y firma dibujada) en JSON canónico. Cualquier cambio posterior produce un hash distinto. Síguelo GPS conserva el registro.', x0, y, { width: ancho });
  const n = doc.bufferedPageRange().count;
  for (let i = 0; i < n; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // el pie va bajo el margen: sin esto pdfkit agrega una página en blanco
    doc.font('Helvetica').fontSize(7.5).fillColor(GRIS).text(`Síguelo GPS · Solicitud N° ${contenido.solicitud} · página ${i + 1} de ${n}`, x0, doc.page.height - 36, { width: ancho, align: 'center', lineBreak: false });
  }
  doc.end();
  return fin;
}

// ── Ajustes globales de las apps (backoffice): GitHub para disparar la compilación y token de servicio ──
const CLAVE_AJUSTES = 'apps_ajustes';
export async function ajustesApps() {
  const f = await uno('SELECT valor FROM sistema WHERE clave = $1', [CLAVE_AJUSTES]);
  let v = {};
  try { v = f?.valor ? descifrar(f.valor) : {}; } catch { v = {}; }
  return { github_token: null, github_repo: 'siguelogps/siguelo_rent_a_car', token_hash: null, token_creado: null, correo_avisos: null, ...v };
}
export async function guardarAjustesApps(a) {
  await q(`INSERT INTO sistema (clave, valor) VALUES ($1, $2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`, [CLAVE_AJUSTES, cifrar(a)]);
}

/** Parámetros de la compilación (los mismos para el disparo automático y para ejecutarlo a mano). */
export function parametrosCompilacion({ solicitud, empresa, host }) {
  const d = solicitud.datos || {};
  return {
    app: 'ambas',
    empresa: empresa.slug,
    host,
    nombre_equipo: d.nombre_equipo,
    nombre_clientes: d.nombre_clientes,
    color: d.color,
    icono_url: `https://${host}/api/apps/marca/${empresa.slug}/icono.png`
  };
}

/** Dispara el workflow «Apps con marca» con repository_dispatch. Devuelve { disparada, motivo }. */
export async function dispararCompilacion(parametros, fetchFn = fetch) {
  const a = await ajustesApps();
  if (!a.github_token || !a.github_repo) return { disparada: false, motivo: 'Falta el token de GitHub (Backoffice → Apps con marca → Compilación). Ejecuta el workflow a mano con estos parámetros.' };
  try {
    const r = await fetchFn(`https://api.github.com/repos/${a.github_repo}/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${a.github_token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'siguelo-on-rent' },
      body: JSON.stringify({ event_type: 'compilar-app-propia', client_payload: parametros })
    });
    if (r.status !== 204 && !r.ok) {
      const j = await r.json().catch(() => ({}));
      return { disparada: false, motivo: `GitHub respondió ${r.status}${j.message ? `: ${j.message}` : ''}. Ejecuta el workflow a mano con estos parámetros.` };
    }
    return { disparada: true, motivo: `Compilación disparada en ${a.github_repo}.` };
  } catch (e) {
    return { disparada: false, motivo: `No se pudo contactar a GitHub (${e.message}). Ejecuta el workflow a mano con estos parámetros.` };
  }
}

/** Correo al cliente en cada cambio de estado (bandeja de salida de la empresa). */
export async function notificarCambio(solicitud, { nota = null } = {}) {
  const e = await uno('SELECT id, nombre, correo FROM empresas WHERE id = $1', [solicitud.empresa_id]);
  const creador = solicitud.creada_por ? await uno('SELECT correo FROM usuarios WHERE id = $1', [solicitud.creada_por]) : null;
  const estado = ESTADOS[solicitud.estado];
  const nombres = [solicitud.datos?.nombre_equipo, solicitud.datos?.nombre_clientes].filter(Boolean).join(' y ') || 'tus apps';
  const explicacion = {
    enviada: 'Recibimos tu solicitud firmada. El equipo de Síguelo la revisará y te avisará.',
    en_revision: 'El equipo de Síguelo está revisando tu solicitud.',
    con_observaciones: 'Tu solicitud tiene observaciones. Corrígela en Configuración → Apps y vuelve a firmarla y enviarla.',
    compilando: 'Aprobamos tu solicitud: tus apps están en desarrollo.',
    lista: 'Tus apps están compiladas y listas para la tienda. Puedes descargarlas y probarlas desde Apps mientras Google Play las revisa.',
    publicada: 'Tus apps ya están publicadas en Google Play.'
  }[solicitud.estado] || '';
  const cuerpo = `Hola,\n\nTu solicitud de apps con tu marca (${nombres}) cambió a «${estado}».\n${explicacion}${nota ? `\n\nObservaciones de Síguelo:\n${nota}` : ''}\n\nPuedes verla en Síguelo On Rent → Apps.\n\nEquipo Síguelo GPS`;
  const destinos = [...new Set([e?.correo, creador?.correo].filter(Boolean).map((c) => c.toLowerCase()))];
  for (const destino of destinos) {
    await encolar({ empresaId: e.id, canal: 'correo', destino, asunto: `Apps con tu marca: ${estado}`, cuerpo, entidad: 'solicitud_app', entidadId: solicitud.id }).catch(() => {});
  }
}
