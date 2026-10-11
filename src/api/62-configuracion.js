// Configuración (/configuracion): sucursales, usuarios y permisos, plantillas, bitácora, detalle de la bandeja de salida,
// cambio de clave propia y (superadmin) estado de las empresas. Los datos de la empresa y la marcha blanca van por
// PATCH /api/empresa (01-empresas.js); las integraciones por /api/integraciones (03-integraciones.js).
import { verificarLimite } from '../planes.js';
import crypto from 'node:crypto';
import express from 'express';
import { q, uno } from '../db.js';
import { requiere, soloSiguelo, ErrorHttp, hashClave, verificarClave, leerCookie } from '../auth.js';
import { hashSha256 } from '../cifrado.js';
import { registrar } from '../bitacora.js';
import { ROLES, MODULOS, nivel } from '../permisos.js';
import { plantillasPorDefecto } from '../plantillas-defecto.js';
import { renderizar } from '../salidas.js';
import { config } from '../config.js';
import { formatearRut } from '../util/rut.js';

const r = express.Router();
const ROLES_ASIGNABLES = ['administrador', 'counter', 'patio', 'finanzas'];
const correoValido = (c) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c);
const texto = (v, max = 200) => (v == null ? null : String(v).trim().slice(0, max) || null);

// Clave temporal legible (sin 0/O, 1/l/I)
export function claveTemporal(largo = 10) {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(largo);
  return Array.from(b, (x) => abc[x % abc.length]).join('');
}

// ── Permisos (solo lectura) ──
r.get('/configuracion/permisos', requiere(null, 'ver', { sinEmpresa: true }), (_req, res) => {
  const roles = Object.fromEntries(Object.entries(ROLES).filter(([k]) => k !== 'superadmin' && k !== 'soporte'));
  res.json({ roles, modulos: MODULOS, matriz: Object.fromEntries(Object.keys(roles).map((rol) => [rol, Object.fromEntries(Object.keys(MODULOS).map((m) => [m, nivel(rol, m)]))])) });
});

// ── Mi clave ──
r.post('/configuracion/mi-clave', requiere(null, 'ver', { sinEmpresa: true }), async (req, res) => {
  const { actual, nueva } = req.body || {};
  const u = await uno('SELECT id, clave_hash FROM usuarios WHERE id = $1', [req.usuario.id]);
  if (!verificarClave(actual || '', u.clave_hash)) throw new ErrorHttp(400, 'La clave actual no es correcta.', { campo: 'actual' });
  if (String(nueva || '').length < 10) throw new ErrorHttp(400, 'La nueva clave debe tener al menos 10 caracteres.', { campo: 'nueva' });
  if (nueva === actual) throw new ErrorHttp(400, 'La nueva clave debe ser distinta de la actual.', { campo: 'nueva' });
  await q('UPDATE usuarios SET clave_hash = $2 WHERE id = $1', [u.id, hashClave(nueva)]);
  const t = leerCookie(req, 'rc_sesion');
  await q('DELETE FROM sesiones WHERE usuario_id = $1 AND token_hash <> $2', [u.id, t ? hashSha256(t) : '']);
  await registrar(req, 'clave_cambiada', 'usuario', u.id);
  res.json({ ok: true });
});

// ── Sucursales ──
const CAMPOS_SUC = ['nombre', 'direccion', 'comuna', 'ciudad', 'telefono', 'horario'];
function leerSucursal(b, parcial = false) {
  const o = {};
  for (const c of CAMPOS_SUC) if (!parcial || c in b) o[c] = texto(b[c], 200);
  if (!parcial || 'lat' in b) o.lat = b.lat === '' || b.lat == null ? null : Number(b.lat);
  if (!parcial || 'lng' in b) o.lng = b.lng === '' || b.lng == null ? null : Number(b.lng);
  if (o.lat != null && (Number.isNaN(o.lat) || o.lat < -90 || o.lat > 90)) throw new ErrorHttp(400, 'La latitud no es válida', { campo: 'lat' });
  if (o.lng != null && (Number.isNaN(o.lng) || o.lng < -180 || o.lng > 180)) throw new ErrorHttp(400, 'La longitud no es válida', { campo: 'lng' });
  if ('activa' in b) o.activa = !!b.activa;
  if ((!parcial || 'nombre' in b) && !o.nombre) throw new ErrorHttp(400, 'Escribe el nombre de la sucursal', { campo: 'nombre' });
  return o;
}

r.get('/configuracion/sucursales', requiere('configuracion', 'ver'), async (req, res) => {
  res.json(await q(`SELECT s.*, (SELECT count(*)::int FROM vehiculos v WHERE v.sucursal_id = s.id AND v.activo) AS vehiculos,
                           (SELECT count(*)::int FROM usuarios u WHERE u.sucursal_id = s.id AND u.activo) AS usuarios
                      FROM sucursales s WHERE s.empresa_id = $1 ORDER BY s.activa DESC, s.id`, [req.empresaId]));
});

r.post('/configuracion/sucursales', requiere('configuracion', 'editar'), async (req, res) => {
  const o = leerSucursal(req.body || {});
  await verificarLimite(req.empresaId, 'sucursales');
  const [s] = await q(`INSERT INTO sucursales (empresa_id, nombre, direccion, comuna, ciudad, telefono, horario, lat, lng, activa)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
  [req.empresaId, o.nombre, o.direccion, o.comuna, o.ciudad, o.telefono, o.horario, o.lat, o.lng, o.activa ?? true]);
  await registrar(req, 'sucursal_creada', 'sucursal', s.id, { nombre: s.nombre });
  res.json(s);
});

r.patch('/configuracion/sucursales/:id', requiere('configuracion', 'editar'), async (req, res) => {
  const o = leerSucursal(req.body || {}, true);
  const claves = Object.keys(o);
  if (!claves.length) throw new ErrorHttp(400, 'Nada que cambiar');
  if (o.activa === false) {
    const [n] = await q('SELECT count(*)::int AS n FROM sucursales WHERE empresa_id = $1 AND activa AND id <> $2', [req.empresaId, req.params.id]);
    if (!n.n) throw new ErrorHttp(400, 'Debe quedar al menos una sucursal activa.');
  }
  const vals = claves.map((k) => o[k]);
  const [s] = await q(`UPDATE sucursales SET ${claves.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE id = $1 AND empresa_id = $2 RETURNING *`, [req.params.id, req.empresaId, ...vals]);
  if (!s) throw new ErrorHttp(404, 'Sucursal no encontrada');
  await registrar(req, 'sucursal_editada', 'sucursal', s.id, { campos: claves });
  res.json(s);
});

// ── Usuarios ──
const COLS_USUARIO = 'u.id, u.nombre, u.correo, u.rol, u.sucursal_id, u.telefono, u.activo, u.ultimo_acceso, u.creado_en, s.nombre AS sucursal';

r.get('/configuracion/usuarios', requiere('usuarios', 'ver'), async (req, res) => {
  const filas = await q(`SELECT ${COLS_USUARIO} FROM usuarios u LEFT JOIN sucursales s ON s.id = u.sucursal_id WHERE u.empresa_id = $1 ORDER BY u.activo DESC, u.nombre`, [req.empresaId]);
  res.json(filas.map((u) => ({ ...u, rol_nombre: ROLES[u.rol] })));
});

async function sucursalValida(empresaId, id) {
  if (!id) return null;
  const s = await uno('SELECT id FROM sucursales WHERE id = $1 AND empresa_id = $2', [id, empresaId]);
  if (!s) throw new ErrorHttp(400, 'Sucursal no válida', { campo: 'sucursal_id' });
  return s.id;
}

r.post('/configuracion/usuarios', requiere('usuarios', 'editar'), async (req, res) => {
  const b = req.body || {};
  const nombre = texto(b.nombre, 100), correo = String(b.correo || '').trim().toLowerCase();
  if (!nombre) throw new ErrorHttp(400, 'Escribe el nombre', { campo: 'nombre' });
  await verificarLimite(req.empresaId, 'usuarios');
  if (!correoValido(correo)) throw new ErrorHttp(400, 'El correo no es válido', { campo: 'correo' });
  if (!ROLES_ASIGNABLES.includes(b.rol)) throw new ErrorHttp(400, 'Elige un rol', { campo: 'rol' });
  if (await uno('SELECT 1 FROM usuarios WHERE lower(correo) = $1', [correo])) throw new ErrorHttp(400, 'Ya existe un usuario con ese correo', { campo: 'correo' });
  const sucursalId = await sucursalValida(req.empresaId, b.sucursal_id ? Number(b.sucursal_id) : null);
  const clave = claveTemporal();
  const [u] = await q(`INSERT INTO usuarios (empresa_id, nombre, correo, clave_hash, rol, sucursal_id, telefono) VALUES ($1,$2,$3,$4,$5,$6,$7)
                       RETURNING id, nombre, correo, rol, sucursal_id, telefono, activo`, [req.empresaId, nombre, correo, hashClave(clave), b.rol, sucursalId, texto(b.telefono, 30)]);
  await registrar(req, 'usuario_creado', 'usuario', u.id, { correo, rol: b.rol });
  res.json({ usuario: { ...u, rol_nombre: ROLES[u.rol] }, clave_temporal: clave });
});

async function quedanAdmins(empresaId, excluirId) {
  const [n] = await q(`SELECT count(*)::int AS n FROM usuarios WHERE empresa_id = $1 AND rol = 'administrador' AND activo AND id <> $2`, [empresaId, excluirId]);
  return n.n > 0;
}

r.patch('/configuracion/usuarios/:id', requiere('usuarios', 'editar'), async (req, res) => {
  const b = req.body || {};
  const u = await uno('SELECT * FROM usuarios WHERE id = $1 AND empresa_id = $2', [req.params.id, req.empresaId]);
  if (!u) throw new ErrorHttp(404, 'Usuario no encontrado');
  const sets = {}, propio = u.id === req.usuario.id;
  if ('nombre' in b) { sets.nombre = texto(b.nombre, 100); if (!sets.nombre) throw new ErrorHttp(400, 'Escribe el nombre', { campo: 'nombre' }); }
  if ('telefono' in b) sets.telefono = texto(b.telefono, 30);
  if ('sucursal_id' in b) sets.sucursal_id = await sucursalValida(req.empresaId, b.sucursal_id ? Number(b.sucursal_id) : null);
  if ('rol' in b && b.rol !== u.rol) {
    if (!ROLES_ASIGNABLES.includes(b.rol)) throw new ErrorHttp(400, 'Rol no válido', { campo: 'rol' });
    if (propio) throw new ErrorHttp(400, 'No puedes cambiar tu propio rol.');
    if (u.rol === 'administrador' && !(await quedanAdmins(req.empresaId, u.id))) throw new ErrorHttp(400, 'Debe quedar al menos un administrador activo.');
    sets.rol = b.rol;
  }
  if ('activo' in b && !!b.activo !== u.activo) {
    if (propio) throw new ErrorHttp(400, 'No puedes desactivar tu propio usuario.');
    if (!b.activo && u.rol === 'administrador' && !(await quedanAdmins(req.empresaId, u.id))) throw new ErrorHttp(400, 'Debe quedar al menos un administrador activo.');
    sets.activo = !!b.activo;
  }
  const claves = Object.keys(sets);
  if (!claves.length) return res.json(u);
  const [n] = await q(`UPDATE usuarios SET ${claves.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE id = $1 AND empresa_id = $2
                       RETURNING id, nombre, correo, rol, sucursal_id, telefono, activo`, [u.id, req.empresaId, ...claves.map((k) => sets[k])]);
  if (sets.activo === false || sets.rol) await q('DELETE FROM sesiones WHERE usuario_id = $1', [u.id]);
  await registrar(req, 'usuario_editado', 'usuario', u.id, { campos: claves, ...(sets.rol ? { rol: sets.rol } : {}), ...('activo' in sets ? { activo: sets.activo } : {}) });
  res.json({ ...n, rol_nombre: ROLES[n.rol] });
});

r.post('/configuracion/usuarios/:id/clave', requiere('usuarios', 'editar'), async (req, res) => {
  const u = await uno('SELECT id, correo FROM usuarios WHERE id = $1 AND empresa_id = $2', [req.params.id, req.empresaId]);
  if (!u) throw new ErrorHttp(404, 'Usuario no encontrado');
  const clave = claveTemporal();
  await q('UPDATE usuarios SET clave_hash = $2 WHERE id = $1', [u.id, hashClave(clave)]);
  if (u.id !== req.usuario.id) await q('DELETE FROM sesiones WHERE usuario_id = $1', [u.id]);
  await registrar(req, 'clave_restablecida', 'usuario', u.id, { correo: u.correo });
  res.json({ ok: true, clave_temporal: clave });
});

// ── Plantillas ──
async function datosEjemplo(empresaId) {
  const e = await uno('SELECT * FROM empresas WHERE id = $1', [empresaId]);
  const s = await uno('SELECT nombre, direccion, ciudad FROM sucursales WHERE empresa_id = $1 AND activa ORDER BY id LIMIT 1', [empresaId]);
  const suc = { nombre: s?.nombre || 'Casa matriz', direccion: s?.direccion || 'Av. Providencia 2133', ciudad: s?.ciudad || 'Santiago' };
  return {
    empresa: { nombre: e.nombre, razon_social: e.razon_social || e.nombre, rut: e.rut ? formatearRut(e.rut) : '76.543.210-3', direccion: e.direccion || '', comuna: e.comuna || '', telefono: e.telefono || '', correo: e.correo || '' },
    cliente: { nombre: 'Valentina', apellidos: 'Soto Riquelme', nombre_completo: 'Valentina Soto Riquelme', documento_tipo: 'RUT', documento: '16.482.903-0', direccion: 'Los Aromos 123, Ñuñoa' },
    vehiculo: { marca: 'Hyundai', modelo: 'Accent', anio: 2023, color: 'Gris plata', patente: 'PBVX-61', km: '48.320', combustible: '7/8' },
    reserva: { folio: 'R-1008', inicio: '14-10-2026 14:00', fin: '19-10-2026 12:00', total: '$238.455', detalle: 'Arriendo Sedán 5 días × $32.990; Conductor adicional $25.000; Silla de niño $20.000',
      km_incluidos: '1.250 km', precio_km_extra: '$180', garantia: '$500.000', deducible: '$450.000', categoria: 'Sedán' },
    sucursal_retiro: suc, sucursal_devolucion: suc,
    contrato: { folio: 'CT-2026-0012' },
    liquidacion: { total_cargos: '$43.900', garantia_liberada: '$456.100', detalle: 'Combustible faltante 2/8: $28.900\nLavado: $15.000' },
    ajustes: { tolerancia_min: e.ajustes?.tolerancia_min ?? 59 },
    conductores: 'Felipe Soto Riquelme (RUT 17.935.221-4)', condiciones_adicionales: 'Sin condiciones adicionales.',
    hoy: new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()),
    url_verificacion: `${config.urlBase}/verificar/AB12CD34`, url_portal: `${config.urlBase}/portal/ejemplo`, url_contrato: `${config.urlBase}/portal/ejemplo`,
    detalle: '12-10-2026 08:14 · Pórtico Costanera Norte · $1.450\n12-10-2026 18:40 · Autopista Central · $2.310', total: '$3.760'
  };
}
const aplanar = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? aplanar(v, `${pre}${k}.`) : [`${pre}${k}`]));

r.get('/configuracion/plantillas', requiere('configuracion', 'ver'), async (req, res) => {
  const filas = await q('SELECT id, tipo, clave, nombre, asunto, cuerpo, activa, actualizado_en FROM plantillas WHERE empresa_id = $1 ORDER BY tipo, nombre', [req.empresaId]);
  const defecto = new Set(plantillasPorDefecto().map((p) => `${p.tipo}:${p.clave}`));
  res.json({ plantillas: filas.map((p) => ({ ...p, tiene_defecto: defecto.has(`${p.tipo}:${p.clave}`) })), variables: aplanar(await datosEjemplo(req.empresaId)) });
});

r.put('/configuracion/plantillas/:id', requiere('configuracion', 'editar'), async (req, res) => {
  const b = req.body || {};
  if (!String(b.cuerpo || '').trim()) throw new ErrorHttp(400, 'La plantilla no puede quedar vacía', { campo: 'cuerpo' });
  const [p] = await q(`UPDATE plantillas SET nombre = COALESCE($3, nombre), asunto = $4, cuerpo = $5, activa = COALESCE($6, activa), actualizado_en = now()
                       WHERE id = $1 AND empresa_id = $2 RETURNING *`,
  [req.params.id, req.empresaId, texto(b.nombre, 120), texto(b.asunto, 300), String(b.cuerpo).slice(0, 60000), 'activa' in b ? !!b.activa : null]);
  if (!p) throw new ErrorHttp(404, 'Plantilla no encontrada');
  await registrar(req, 'plantilla_editada', 'plantilla', p.id, { clave: p.clave, tipo: p.tipo });
  res.json(p);
});

r.post('/configuracion/plantillas/:id/restaurar', requiere('configuracion', 'editar'), async (req, res) => {
  const p = await uno('SELECT * FROM plantillas WHERE id = $1 AND empresa_id = $2', [req.params.id, req.empresaId]);
  if (!p) throw new ErrorHttp(404, 'Plantilla no encontrada');
  const d = plantillasPorDefecto().find((x) => x.tipo === p.tipo && x.clave === p.clave);
  if (!d) throw new ErrorHttp(400, 'Esta plantilla no tiene versión por defecto');
  const [n] = await q('UPDATE plantillas SET nombre = $3, asunto = $4, cuerpo = $5, activa = true, actualizado_en = now() WHERE id = $1 AND empresa_id = $2 RETURNING *',
    [p.id, req.empresaId, d.nombre, d.asunto || null, d.cuerpo]);
  await registrar(req, 'plantilla_restaurada', 'plantilla', p.id, { clave: p.clave, tipo: p.tipo });
  res.json(n);
});

r.post('/configuracion/plantillas/vista-previa', requiere('configuracion', 'ver'), async (req, res) => {
  const datos = await datosEjemplo(req.empresaId);
  res.json({ asunto: renderizar(req.body?.asunto || '', datos), cuerpo: renderizar(req.body?.cuerpo || '', datos) });
});

// ── Bandeja de salida: mensaje completo ──
r.get('/configuracion/salidas/:id', requiere('configuracion', 'ver'), async (req, res) => {
  const s = await uno('SELECT * FROM salidas WHERE id = $1 AND empresa_id = $2', [req.params.id, req.empresaId]);
  if (!s) throw new ErrorHttp(404, 'Mensaje no encontrado');
  res.json(s);
});

// ── Bitácora ──
r.get('/configuracion/bitacora', requiere('configuracion', 'ver'), async (req, res) => {
  const f = req.query;
  const porPagina = Math.min(200, Math.max(10, Number(f.por_pagina) || 50));
  const pagina = Math.max(1, Number(f.pagina) || 1);
  const fecha = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? s : null);
  const params = [req.empresaId, f.usuario_id ? Number(f.usuario_id) : null, texto(f.accion, 80), texto(f.entidad, 80), fecha(f.desde), fecha(f.hasta)];
  const donde = `b.empresa_id = $1 AND ($2::bigint IS NULL OR b.usuario_id = $2) AND ($3::text IS NULL OR b.accion = $3) AND ($4::text IS NULL OR b.entidad = $4)
                 AND ($5::date IS NULL OR b.creado_en >= ($5::date::timestamp AT TIME ZONE 'America/Santiago'))
                 AND ($6::date IS NULL OR b.creado_en < (($6::date + 1)::timestamp AT TIME ZONE 'America/Santiago'))`;
  const [{ n }] = await q(`SELECT count(*)::int AS n FROM bitacora b WHERE ${donde}`, params);
  const filas = await q(`SELECT b.id, b.accion, b.entidad, b.entidad_id, b.detalle, b.ip, b.creado_en, u.nombre AS usuario, u.correo AS usuario_correo
                           FROM bitacora b LEFT JOIN usuarios u ON u.id = b.usuario_id WHERE ${donde}
                          ORDER BY b.creado_en DESC, b.id DESC LIMIT ${porPagina} OFFSET ${(pagina - 1) * porPagina}`, params);
  const [acciones, entidades, usuarios] = await Promise.all([
    q('SELECT DISTINCT accion FROM bitacora WHERE empresa_id = $1 ORDER BY accion', [req.empresaId]),
    q('SELECT DISTINCT entidad FROM bitacora WHERE empresa_id = $1 AND entidad IS NOT NULL ORDER BY entidad', [req.empresaId]),
    q('SELECT DISTINCT u.id, u.nombre FROM bitacora b JOIN usuarios u ON u.id = b.usuario_id WHERE b.empresa_id = $1 ORDER BY u.nombre', [req.empresaId])
  ]);
  res.json({ filas, total: n, pagina, por_pagina: porPagina, paginas: Math.max(1, Math.ceil(n / porPagina)),
    opciones: { acciones: acciones.map((a) => a.accion), entidades: entidades.map((e) => e.entidad), usuarios } });
});

// ── Superadmin: estado y plan de cada empresa ──
r.patch('/configuracion/empresas/:id', requiere(null, 'ver', { sinEmpresa: true }), soloSiguelo, async (req, res) => {
  const b = req.body || {};
  const sets = [], vals = [req.params.id];
  if ('activa' in b) { vals.push(!!b.activa); sets.push(`activa = $${vals.length}`); }
  if ('plan' in b) {
    const plan = texto(b.plan, 30);
    if (!plan || !(await uno('SELECT 1 AS ok FROM planes WHERE codigo = $1', [plan]))) throw new ErrorHttp(400, 'Plan no válido');
    vals.push(plan); sets.push(`plan = $${vals.length}`);
  }
  if (!sets.length) throw new ErrorHttp(400, 'Nada que cambiar');
  const [e] = await q(`UPDATE empresas SET ${sets.join(', ')} WHERE id = $1 RETURNING id, nombre, activa, plan`, vals);
  if (!e) throw new ErrorHttp(404, 'Empresa no encontrada');
  (await import('../planes.js')).limpiarCachePlanes();
  await registrar({ usuario: req.usuario, empresaId: e.id, ip: req.ip }, 'empresa_estado', 'empresa', e.id, { activa: e.activa, plan: e.plan });
  res.json(e);
});

export default r;
