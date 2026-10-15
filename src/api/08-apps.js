// Apps (Configuración → Apps y Backoffice → Apps con marca): app genérica Síguelo On Rent y apps con la marca de
// cada cliente (marca blanca) — pedido, solicitud con autorización firmada en línea, revisión y aprobación de
// Síguelo, compilación en GitHub Actions y descarga de los APK/AAB. Lógica en src/apps-propias.js.
import crypto from 'node:crypto';
import express from 'express';
import { q, uno } from '../db.js';
import { requiere, soloSiguelo, soloSuperadmin, ErrorHttp } from '../auth.js';
import { registrar } from '../bitacora.js';
import { incluye, limpiarCachePlanes } from '../planes.js';
import { config } from '../config.js';
import { guardarArchivo, leerArchivo, borrarArchivo } from '../almacenamiento/index.js';
import * as P from '../apps-propias.js';

const r = express.Router();
const bo = [requiere(null, 'ver', { sinEmpresa: true }), soloSiguelo];
const MIME = { apk: 'application/vnd.android.package-archive', aab: 'application/vnd.android.aab' };
const hostApps = () => new URL(config.urlBase).host;
let fetchGithub = (...a) => fetch(...a);
export function _usarFetch(fn) { fetchGithub = fn || ((...a) => fetch(...a)); }

function vista(s, { siguelo = false } = {}) {
  if (!s) return null;
  return {
    id: Number(s.id), empresa_id: Number(s.empresa_id), estado: s.estado, estadoNombre: P.ESTADOS[s.estado], datos: s.datos || {},
    icono_archivo_id: s.icono_archivo_id ? Number(s.icono_archivo_id) : null, logo_archivo_id: s.logo_archivo_id ? Number(s.logo_archivo_id) : null,
    capturas: (s.capturas || []).map(Number), observaciones: s.observaciones, historial: s.historial || [], url_tiendas: s.url_tiendas || null,
    editable: P.EDITABLES.includes(s.estado),
    firma: s.firma ? { nombre: s.firma.nombre, rut: s.firma.rut, cargo: s.firma.cargo, fecha: s.firma.fecha, ip: s.firma.ip, hash: s.firma.hash, pdf: !!s.firma.pdf_archivo_id } : null,
    compilacion: s.compilacion ? (siguelo ? s.compilacion : { fecha: s.compilacion.fecha, disparada: s.compilacion.disparada }) : null,
    creada: s.creada, actualizada: s.actualizada
  };
}

async function cambiarEstado(s, estado, { usuario = null, nota = null, extra = {} } = {}) {
  const evento = { estado, fecha: new Date().toISOString(), usuario: usuario?.nombre || 'Sistema', nota: nota || null };
  const sets = ['estado = $2', 'historial = historial || $3::jsonb', 'actualizada = now()'];
  const vals = [s.id, estado, JSON.stringify([evento])];
  for (const [k, v] of Object.entries(extra)) { vals.push(['compilacion', 'url_tiendas', 'firma', 'datos'].includes(k) ? JSON.stringify(v) : v); sets.push(`${k} = $${vals.length}`); }
  return uno(`UPDATE solicitudes_app SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals);
}

// Última versión de cada app y formato de una empresa.
async function versiones(empresaId) {
  const filas = await q(`SELECT DISTINCT ON (app, formato) app, formato, version, paquete, tamano, subida, archivo_id
                         FROM app_versiones WHERE empresa_id = $1 ORDER BY app, formato, subida DESC, id DESC`, [empresaId]);
  const out = {};
  for (const f of filas) (out[f.app] ||= {})[f.formato] = { version: f.version, paquete: f.paquete, tamano: f.tamano, subida: f.subida };
  return out;
}

// ── Configuración → Apps (cliente) ──
const cargarMia = (req) => uno('SELECT * FROM solicitudes_app WHERE empresa_id = $1', [req.empresaId]);

r.get('/apps/panel', requiere('configuracion', 'ver'), async (req, res) => {
  const e = await uno('SELECT id, nombre, slug, razon_social, rut, color, ajustes FROM empresas WHERE id = $1', [req.empresaId]);
  const s = await cargarMia(req);
  const aprobada = s && P.APROBADA.includes(s.estado);
  const base = config.urlBase;
  res.json({
    empresa: { id: Number(e.id), nombre: e.nombre, slug: e.slug },
    modulo: await incluye(req.empresaId, 'app_propia'),
    pedido: e.ajustes?.app_propia_pedido || null,
    solicitud: vista(s),
    autorizacion: P.textoAutorizacion({ empresa: e, datos: s?.datos || {} }),
    paquetes: { equipo: P.paquete(e.slug, 'equipo'), clientes: P.paquete(e.slug, 'clientes') },
    apps: P.APPS,
    versiones: aprobada ? await versiones(req.empresaId) : {},
    links: {
      sistema: `${base}/ingresar`,
      reservas: `${base}/reservar/${e.slug}`,
      descargas: aprobada ? { equipo: `${base}/api/apps/descargas/${e.slug}/equipo.apk`, clientes: `${base}/api/apps/descargas/${e.slug}/clientes.apk` } : null
    },
    estados: P.ESTADOS
  });
});

// Sin el módulo: la empresa pide la personalización y Síguelo la habilita (y decide si se cobra).
r.post('/apps/pedir-personalizacion', requiere('configuracion', 'editar'), async (req, res) => {
  if (await incluye(req.empresaId, 'app_propia')) throw new ErrorHttp(409, 'La personalización ya está habilitada: completa la solicitud.');
  const nota = String(req.body?.nota || '').trim().slice(0, 500) || null;
  const pedido = { fecha: new Date().toISOString(), usuario: req.usuario.nombre, correo: req.usuario.correo, nota };
  await q(`UPDATE empresas SET ajustes = jsonb_set(ajustes, '{app_propia_pedido}', $2::jsonb) WHERE id = $1`, [req.empresaId, JSON.stringify(pedido)]);
  await registrar(req, 'app_propia_pedida', 'empresa', req.empresaId, { nota });
  res.json(pedido);
});

async function exigirModulo(req) {
  if (!(await incluye(req.empresaId, 'app_propia'))) throw new ErrorHttp(403, 'Tu plan no incluye apps con tu marca. Pídela a Síguelo desde esta misma pantalla.');
}

r.put('/apps/solicitud', requiere('configuracion', 'editar'), async (req, res) => {
  await exigirModulo(req);
  const b = req.body || {};
  let s = await cargarMia(req);
  if (s && !P.EDITABLES.includes(s.estado)) throw new ErrorHttp(409, `La solicitud está «${P.ESTADOS[s.estado]}» y ya no se puede editar.`);
  const datos = P.leerDatos(b);
  const icono = await P.validarArchivo(req.empresaId, b.icono_archivo_id, { tipo: 'icono' });
  const logo = await P.validarArchivo(req.empresaId, b.logo_archivo_id, { tipo: 'logo' });
  const capturas = [];
  for (const id of (Array.isArray(b.capturas) ? b.capturas : []).slice(0, 8)) capturas.push(await P.validarArchivo(req.empresaId, id, { tipo: 'captura' }));
  if (!s) {
    s = await uno(`INSERT INTO solicitudes_app (empresa_id, datos, icono_archivo_id, logo_archivo_id, capturas, creada_por, historial)
                   VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.empresaId, JSON.stringify(datos), icono, logo, capturas, req.usuario.id, JSON.stringify([{ estado: 'borrador', fecha: new Date().toISOString(), usuario: req.usuario.nombre, nota: null }])]);
    await registrar(req, 'solicitud_app_creada', 'solicitud_app', s.id);
  } else {
    s = await uno('UPDATE solicitudes_app SET datos = $2, icono_archivo_id = $3, logo_archivo_id = $4, capturas = $5, actualizada = now() WHERE id = $1 RETURNING *',
      [s.id, JSON.stringify(datos), icono, logo, capturas]);
    await registrar(req, 'solicitud_app_editada', 'solicitud_app', s.id);
  }
  res.json(vista(s));
});

// Firma en línea de la autorización y envío a Síguelo: PDF firmado con fecha, IP y hash SHA-256.
r.post('/apps/solicitud/firmar', requiere('configuracion', 'editar'), async (req, res) => {
  await exigirModulo(req);
  const s = await cargarMia(req);
  if (!s) throw new ErrorHttp(409, 'Primero guarda los datos de tus apps.');
  if (!P.EDITABLES.includes(s.estado)) throw new ErrorHttp(409, `La solicitud está «${P.ESTADOS[s.estado]}»: ya fue enviada.`);
  const b = req.body || {};
  const empresa = await uno('SELECT id, nombre, razon_social, rut, slug FROM empresas WHERE id = $1', [req.empresaId]);
  const datos = P.leerDatos(s.datos, { completa: true });
  if (!s.icono_archivo_id) throw new ErrorHttp(400, 'Falta el ícono de la app (PNG de 512 × 512).');
  if (!s.logo_archivo_id) throw new ErrorHttp(400, 'Falta el logo.');
  const firmante = P.leerFirmante(b);
  if (b.acepta !== true) throw new ErrorHttp(400, 'Debes aceptar la autorización y la licencia de uso de marca.');
  const firmaPng = P.leerFirmaDibujada(b.firma);
  const leer = async (id) => P.sha256((await leerArchivo(req.empresaId, Number(id))).datos);
  const archivos = { icono: await leer(s.icono_archivo_id), logo: await leer(s.logo_archivo_id), capturas: [] };
  for (const id of s.capturas || []) archivos.capturas.push(await leer(id));
  const fecha = new Date().toISOString();
  const contenido = P.contenidoFirmado({ solicitud: s, empresa, datos, archivos, firmante, fecha, ip: req.ip, firmaSha256: P.sha256(firmaPng) });
  const hash = P.hashContenido(contenido);
  const logoA = await leerArchivo(req.empresaId, Number(s.logo_archivo_id));
  const logo = ['image/png', 'image/jpeg'].includes(logoA?.fila.mime) ? logoA.datos : null;
  const pdf = await P.pdfAutorizacion({ contenido, hash, firmaPng, logo });
  const fFirma = await guardarArchivo({ empresaId: req.empresaId, entidad: 'solicitud_app', entidadId: s.id, tipo: 'firma', nombre: `firma-solicitud-${s.id}.png`, mime: 'image/png', datos: firmaPng, usuarioId: req.usuario.id });
  const fPdf = await guardarArchivo({ empresaId: req.empresaId, entidad: 'solicitud_app', entidadId: s.id, tipo: 'pdf', nombre: `autorizacion-apps-${empresa.slug}-${s.id}.pdf`, mime: 'application/pdf', datos: pdf, usuarioId: req.usuario.id });
  const anteriores = [...(s.firma?.anteriores || []), ...(s.firma ? [{ hash: s.firma.hash, fecha: s.firma.fecha, pdf_archivo_id: s.firma.pdf_archivo_id }] : [])];
  const hecha = await cambiarEstado(s, 'enviada', {
    usuario: req.usuario, nota: s.estado === 'con_observaciones' ? 'Corregida y reenviada.' : 'Firmada y enviada.',
    extra: { datos, firma: { ...firmante, fecha, ip: req.ip, hash, contenido, firma_archivo_id: Number(fFirma.id), pdf_archivo_id: Number(fPdf.id), anteriores } }
  });
  await registrar(req, 'solicitud_app_firmada', 'solicitud_app', s.id, { hash, firmante: firmante.nombre });
  await P.notificarCambio(hecha);
  res.json(vista(hecha));
});

async function enviarArchivo(res, empresaId, id, { nombre = null, cache = 'private, no-cache', descarga = false } = {}) {
  const a = id ? await leerArchivo(empresaId, Number(id)) : null;
  if (!a) throw new ErrorHttp(404, 'Archivo no encontrado');
  res.setHeader('Content-Type', a.fila.mime || 'application/octet-stream');
  res.setHeader('Cache-Control', cache);
  res.setHeader('Content-Disposition', `${descarga ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(nombre || a.fila.nombre || 'archivo')}`);
  res.end(a.datos);
}

r.get('/apps/solicitud/pdf', requiere('configuracion', 'ver'), async (req, res) => {
  const s = await cargarMia(req);
  if (!s?.firma?.pdf_archivo_id) throw new ErrorHttp(404, 'La autorización firmada no existe.');
  await enviarArchivo(res, req.empresaId, s.firma.pdf_archivo_id);
});

// Descarga del AAB (para revisar) y del APK de la empresa con sesión.
r.get('/apps/archivo/:app.:formato', requiere('configuracion', 'ver'), async (req, res) => {
  const v = await uno('SELECT archivo_id FROM app_versiones WHERE empresa_id = $1 AND app = $2 AND formato = $3 ORDER BY subida DESC, id DESC LIMIT 1', [req.empresaId, req.params.app, req.params.formato]);
  if (!v) throw new ErrorHttp(404, 'Esa app todavía no está compilada.');
  await enviarArchivo(res, req.empresaId, v.archivo_id, { descarga: true });
});

// ── Público: marca de una app propia (la usa la app antes del ingreso y la compilación para el ícono) ──
async function empresaPorSlug(slug, estados = P.APROBADA) {
  return uno(`SELECT e.id, e.nombre, e.slug, e.color, s.estado, s.datos, s.icono_archivo_id, s.logo_archivo_id
              FROM empresas e JOIN solicitudes_app s ON s.empresa_id = e.id
              WHERE e.slug = $1 AND e.activa AND s.estado = ANY($2)`, [String(slug || '').toLowerCase(), estados]);
}
r.get('/apps/marca/:slug', async (req, res) => {
  const e = await empresaPorSlug(req.params.slug);
  if (!e) throw new ErrorHttp(404, 'No hay una app con ese identificador.');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ slug: e.slug, empresa: e.nombre, color: e.datos?.color || e.color || null, nombres: { equipo: e.datos?.nombre_equipo, clientes: e.datos?.nombre_clientes },
    logo: e.logo_archivo_id ? `/api/apps/marca/${e.slug}/logo` : null, icono: e.icono_archivo_id ? `/api/apps/marca/${e.slug}/icono.png` : null });
});
r.get('/apps/marca/:slug/logo', async (req, res) => {
  const e = await empresaPorSlug(req.params.slug, P.FIRMADA);
  if (!e) throw new ErrorHttp(404, 'No encontrado');
  await enviarArchivo(res, e.id, e.logo_archivo_id, { cache: 'public, max-age=3600' });
});
r.get('/apps/marca/:slug/icono.png', async (req, res) => {
  const e = await empresaPorSlug(req.params.slug, P.FIRMADA);
  if (!e) throw new ErrorHttp(404, 'No encontrado');
  await enviarArchivo(res, e.id, e.icono_archivo_id, { nombre: `${e.slug}-icono.png`, cache: 'public, max-age=3600' });
});
// Link para compartir con el personal o los clientes: siempre la última versión del APK.
r.get('/apps/descargas/:slug/:app.apk', async (req, res) => {
  const e = await uno('SELECT id FROM empresas WHERE slug = $1 AND activa', [String(req.params.slug).toLowerCase()]);
  const v = e && await uno(`SELECT archivo_id FROM app_versiones WHERE empresa_id = $1 AND app = $2 AND formato = 'apk' ORDER BY subida DESC, id DESC LIMIT 1`, [e.id, req.params.app]);
  if (!v) return res.status(404).type('text/plain; charset=utf-8').send('Esta app todavía no está publicada.');
  await enviarArchivo(res, e.id, v.archivo_id, { descarga: true });
});

// ── Publicación por token de servicio (GitHub Actions): Authorization: Bearer <token>, x-empresa, x-version, x-formato, x-paquete ──
r.post('/apps/servicio/:app', express.raw({ type: () => true, limit: '80mb' }), async (req, res) => {
  const a = await P.ajustesApps();
  const token = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const dado = crypto.createHash('sha256').update(token).digest();
  if (!a.token_hash || !token || !crypto.timingSafeEqual(dado, Buffer.from(a.token_hash, 'hex'))) throw new ErrorHttp(401, 'Token de publicación no válido.');
  const app = req.params.app;
  if (!P.APPS[app]) throw new ErrorHttp(404, 'App desconocida.');
  const e = await uno('SELECT id, slug FROM empresas WHERE slug = $1', [String(req.get('x-empresa') || '').toLowerCase()]);
  if (!e) throw new ErrorHttp(404, 'No hay una empresa con ese identificador.');
  const formato = String(req.get('x-formato') || 'apk').toLowerCase();
  if (!MIME[formato]) throw new ErrorHttp(400, 'Formato desconocido (apk o aab).');
  const version = String(req.get('x-version') || '').trim().slice(0, 30);
  if (!/^\d+(\.\d+){0,3}([-.][\w]+)?$/.test(version)) throw new ErrorHttp(400, 'Indica la versión (ej.: 1.0.3).');
  const datos = req.body;
  if (!Buffer.isBuffer(datos) || datos.length < 4 || datos.toString('latin1', 0, 2) !== 'PK') throw new ErrorHttp(400, `El archivo no es un ${formato.toUpperCase()} válido.`);
  const f = await guardarArchivo({ empresaId: e.id, entidad: 'app', tipo: formato, nombre: `${e.slug}-${app}-${version}.${formato}`, mime: MIME[formato], datos, maximoMb: 80 });
  const anteriores = await q('SELECT id, archivo_id FROM app_versiones WHERE empresa_id = $1 AND app = $2 AND formato = $3', [e.id, app, formato]);
  await q('INSERT INTO app_versiones (empresa_id, app, formato, version, paquete, archivo_id, tamano) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [e.id, app, formato, version, String(req.get('x-paquete') || P.paquete(e.slug, app)).slice(0, 120), f.id, datos.length]);
  // Solo se guarda la última versión de cada formato (el link siempre entrega la última).
  for (const x of anteriores) { await q('DELETE FROM app_versiones WHERE id = $1', [x.id]); await borrarArchivo(e.id, Number(x.archivo_id)); }
  await registrar({ empresaId: e.id, ip: req.ip }, 'app_publicada', 'app', null, { app, formato, version, tamano: datos.length, por: 'servicio' });
  // Con las dos apps compiladas, la solicitud pasa a «Lista para tienda».
  const s = await uno('SELECT * FROM solicitudes_app WHERE empresa_id = $1', [e.id]);
  const v = await versiones(e.id);
  if (s?.estado === 'compilando' && Object.keys(P.APPS).every((k) => v[k]?.apk || v[k]?.aab)) {
    const hecha = await cambiarEstado(s, 'lista', { nota: `Compiladas: ${Object.keys(P.APPS).map((k) => `${k} ${(v[k].apk || v[k].aab).version}`).join(', ')}.` });
    await P.notificarCambio(hecha);
  }
  res.status(201).json({ ok: true, app, formato, version });
});

// ── Backoffice → Apps con marca (equipo Síguelo) ──
r.get('/backoffice/apps', ...bo, async (_req, res) => {
  const filas = await q(`SELECT s.*, e.nombre AS empresa, e.slug FROM solicitudes_app s JOIN empresas e ON e.id = s.empresa_id ORDER BY s.actualizada DESC`);
  const pedidos = await q(`SELECT id, nombre, slug, ajustes->'app_propia_pedido' AS pedido FROM empresas WHERE ajustes ? 'app_propia_pedido' AND NOT ('app_propia' = ANY(modulos_extra)) ORDER BY nombre`);
  const a = await P.ajustesApps();
  const solicitudes = [];
  for (const f of filas) solicitudes.push({ ...vista(f, { siguelo: true }), empresa: f.empresa, slug: f.slug, modulo: await incluye(f.empresa_id, 'app_propia') });
  res.json({ estados: P.ESTADOS, solicitudes, pedidos: pedidos.map((p) => ({ ...p, id: Number(p.id) })),
    ajustes: { github_repo: a.github_repo, github_conectado: !!a.github_token, token_cargado: !!a.token_hash, token_creado: a.token_creado, host: hostApps() } });
});

const cargarSolicitud = async (id) => {
  const s = await uno('SELECT * FROM solicitudes_app WHERE id = $1', [Number(id)]);
  if (!s) throw new ErrorHttp(404, 'Solicitud no encontrada');
  return s;
};

r.get('/backoffice/apps/:id', ...bo, async (req, res) => {
  const s = await cargarSolicitud(req.params.id);
  const e = await uno('SELECT id, nombre, slug, rut, razon_social, correo FROM empresas WHERE id = $1', [s.empresa_id]);
  res.json({ solicitud: vista(s, { siguelo: true }), empresa: { ...e, id: Number(e.id) }, paquetes: { equipo: P.paquete(e.slug, 'equipo'), clientes: P.paquete(e.slug, 'clientes') },
    parametros: P.parametrosCompilacion({ solicitud: s, empresa: e, host: hostApps() }), cambios: P.CAMBIOS_SIGUELO[s.estado] || [], estados: P.ESTADOS,
    versiones: await versiones(s.empresa_id), modulo: await incluye(s.empresa_id, 'app_propia') });
});

r.get('/backoffice/apps/:id/archivo/:archivo', ...bo, async (req, res) => {
  const s = await cargarSolicitud(req.params.id);
  const a = Number(req.params.archivo);
  const permitidos = [s.icono_archivo_id, s.logo_archivo_id, ...(s.capturas || []), s.firma?.firma_archivo_id, s.firma?.pdf_archivo_id].filter(Boolean).map(Number);
  if (!permitidos.includes(a)) throw new ErrorHttp(404, 'Archivo no encontrado');
  await enviarArchivo(res, s.empresa_id, a, { cache: 'private, max-age=3600' });
});

r.get('/backoffice/apps/:id/pdf', ...bo, async (req, res) => {
  const s = await cargarSolicitud(req.params.id);
  if (!s.firma?.pdf_archivo_id) throw new ErrorHttp(404, 'La autorización firmada no existe.');
  await enviarArchivo(res, s.empresa_id, s.firma.pdf_archivo_id);
});

r.get('/backoffice/apps/:id/:app.:formato', ...bo, async (req, res) => {
  const s = await cargarSolicitud(req.params.id);
  const v = await uno('SELECT archivo_id FROM app_versiones WHERE empresa_id = $1 AND app = $2 AND formato = $3 ORDER BY subida DESC, id DESC LIMIT 1', [s.empresa_id, req.params.app, req.params.formato]);
  if (!v) throw new ErrorHttp(404, 'Esa app todavía no está compilada.');
  await enviarArchivo(res, s.empresa_id, v.archivo_id, { descarga: true });
});

r.post('/backoffice/apps/:id/estado', ...bo, async (req, res) => {
  const s = await cargarSolicitud(req.params.id);
  const estado = String(req.body?.estado || '');
  if (!(P.CAMBIOS_SIGUELO[s.estado] || []).includes(estado)) throw new ErrorHttp(409, `No se puede pasar de «${P.ESTADOS[s.estado]}» a «${P.ESTADOS[estado] || estado}».`);
  const nota = String(req.body?.observaciones || '').trim().slice(0, 4000) || null;
  if (estado === 'con_observaciones' && !nota) throw new ErrorHttp(400, 'Escribe las observaciones para el cliente.', { campo: 'observaciones' });
  const extra = {};
  if (estado === 'con_observaciones') extra.observaciones = nota;
  if (estado === 'publicada') {
    const url = (k) => {
      const u = String(req.body?.[`url_${k}`] || '').trim();
      if (u && !/^https:\/\/play\.google\.com\//.test(u)) throw new ErrorHttp(400, 'El link de Google Play debe empezar con https://play.google.com/.', { campo: `url_${k}` });
      return u || null;
    };
    extra.url_tiendas = { equipo: url('equipo'), clientes: url('clientes') };
  }
  const hecha = await cambiarEstado(s, estado, { usuario: req.usuario, nota, extra });
  await registrar(req, 'solicitud_app_estado', 'solicitud_app', s.id, { de: s.estado, a: estado, empresaId: s.empresa_id });
  await P.notificarCambio(hecha, { nota });
  res.json(vista(hecha, { siguelo: true }));
});

// Aprobar: dispara la compilación en GitHub Actions (repository_dispatch) si hay token; si no, devuelve los parámetros.
r.post('/backoffice/apps/:id/aprobar', ...bo, async (req, res) => {
  const s = await cargarSolicitud(req.params.id);
  if (!P.FIRMADA.includes(s.estado) || !s.firma?.hash) throw new ErrorHttp(409, 'Solo se aprueba una solicitud firmada y enviada.');
  if (!(await incluye(s.empresa_id, 'app_propia'))) throw new ErrorHttp(409, 'Primero habilita «Apps con marca» para esta empresa (botón Habilitar en esta misma pantalla o en su plan).');
  const e = await uno('SELECT id, nombre, slug FROM empresas WHERE id = $1', [s.empresa_id]);
  const parametros = P.parametrosCompilacion({ solicitud: s, empresa: e, host: hostApps() });
  const disparo = await P.dispararCompilacion(parametros, fetchGithub);
  const hecha = await cambiarEstado(s, 'compilando', {
    usuario: req.usuario, nota: disparo.disparada ? 'Aprobada: compilación disparada.' : 'Aprobada: compilación pendiente de ejecutar a mano.',
    extra: { compilacion: { fecha: new Date().toISOString(), parametros, ...disparo } }
  });
  await registrar(req, 'solicitud_app_aprobada', 'solicitud_app', s.id, { disparada: disparo.disparada, empresaId: s.empresa_id });
  await P.notificarCambio(hecha);
  res.json({ solicitud: vista(hecha, { siguelo: true }), parametros, ...disparo });
});

// Habilitar o quitar «Apps con marca» a una empresa fuera de su plan (Síguelo decide si se cobra; queda la nota).
r.post('/backoffice/empresas/:id/app-propia', ...bo, async (req, res) => {
  const id = Number(req.params.id);
  const habilitar = req.body?.habilitado !== false;
  const nota = String(req.body?.nota || '').trim().slice(0, 300) || null;
  const e = await uno(`UPDATE empresas SET modulos_extra = CASE WHEN $2 THEN array(SELECT DISTINCT unnest(modulos_extra || ARRAY['app_propia'])) ELSE array_remove(modulos_extra, 'app_propia') END,
                         ajustes = CASE WHEN $2 THEN (ajustes - 'app_propia_pedido') || jsonb_build_object('app_propia_nota', $3::text) ELSE ajustes END
                       WHERE id = $1 RETURNING id, nombre, modulos_extra`, [id, habilitar, nota]);
  if (!e) throw new ErrorHttp(404, 'Empresa no encontrada');
  limpiarCachePlanes();
  await registrar(req, habilitar ? 'app_propia_habilitada' : 'app_propia_quitada', 'empresa', id, { nota, empresaId: id });
  res.json({ ok: true, modulos_extra: e.modulos_extra });
});

// Ajustes de la compilación (solo superadmin): GitHub y token de servicio para que Actions publique las versiones.
r.put('/backoffice/apps-ajustes', ...bo, soloSuperadmin, async (req, res) => {
  const a = await P.ajustesApps();
  const b = req.body || {};
  if (b.github_repo !== undefined) {
    const repo = String(b.github_repo || '').trim();
    if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new ErrorHttp(400, 'El repositorio debe ser dueño/nombre (ej.: siguelogps/siguelo_rent_a_car).', { campo: 'github_repo' });
    a.github_repo = repo || null;
  }
  if (b.github_token) a.github_token = String(b.github_token).trim();
  if (b.quitar_github_token) a.github_token = null;
  await P.guardarAjustesApps(a);
  await registrar(req, 'apps_ajustes', 'sistema', null, { repo: a.github_repo, github: !!a.github_token });
  res.json({ github_repo: a.github_repo, github_conectado: !!a.github_token });
});

r.post('/backoffice/apps-token', ...bo, soloSuperadmin, async (req, res) => {
  const token = `sor_${crypto.randomBytes(30).toString('base64url')}`;
  const a = await P.ajustesApps();
  a.token_hash = crypto.createHash('sha256').update(token).digest('hex');
  a.token_creado = new Date().toISOString();
  await P.guardarAjustesApps(a);
  await registrar(req, 'apps_token_creado', 'sistema');
  res.status(201).json({ token, creado: a.token_creado, url: config.urlBase });
});

export default r;
