// Backoffice Síguelo: planes comerciales (detalle de lo que incluye cada uno) y equipo Síguelo
// (usuarios que administran la plataforma). Planes: lo ve todo el equipo; editarlos y administrar el equipo, solo superadmin.
import express from 'express';
import crypto from 'node:crypto';
import { q, uno } from '../db.js';
import { requiere, soloSiguelo, soloSuperadmin, hashClave, ErrorHttp } from '../auth.js';
import { registrar } from '../bitacora.js';
import { MODULOS_PLAN, limpiarCachePlanes } from '../planes.js';

const r = express.Router();
const base = requiere(null, 'ver', { sinEmpresa: true });
const claveTemporal = () => { const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from(crypto.randomBytes(12), (x) => abc[x % abc.length]).join(''); };
const entero = (v) => (v === '' || v == null ? null : Math.max(0, Math.round(Number(v))));

// ── Planes ──
r.get('/backoffice/planes', base, soloSiguelo, async (_req, res) => {
  const planes = await q(`SELECT p.*, (SELECT count(*)::int FROM empresas e WHERE e.plan = p.codigo) AS empresas FROM planes p ORDER BY p.orden, p.codigo`);
  res.json({ planes, modulos: MODULOS_PLAN });
});

async function guardarPlan(req, codigo, nuevo) {
  const b = req.body || {};
  if (!String(b.nombre || '').trim()) throw new ErrorHttp(400, 'Falta el nombre del plan', { campo: 'nombre' });
  const modulos = (Array.isArray(b.modulos) ? b.modulos : []).filter((m) => MODULOS_PLAN[m]);
  if (!modulos.length) throw new ErrorHttp(400, 'El plan debe incluir al menos un módulo');
  const precio = b.precio_uf === '' || b.precio_uf == null ? null : Number(String(b.precio_uf).replace(',', '.'));
  if (precio != null && !(precio >= 0)) throw new ErrorHttp(400, 'Precio no válido', { campo: 'precio_uf' });
  const vals = [codigo, String(b.nombre).trim().slice(0, 60), String(b.descripcion || '').slice(0, 500), precio, entero(b.max_vehiculos), entero(b.max_usuarios), entero(b.max_sucursales), modulos, entero(b.orden) ?? 0, b.activo !== false];
  const [p] = nuevo
    ? await q(`INSERT INTO planes (codigo, nombre, descripcion, precio_uf, max_vehiculos, max_usuarios, max_sucursales, modulos, orden, activo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, vals)
    : await q(`UPDATE planes SET nombre = $2, descripcion = $3, precio_uf = $4, max_vehiculos = $5, max_usuarios = $6, max_sucursales = $7, modulos = $8, orden = $9, activo = $10, actualizado_en = now() WHERE codigo = $1 RETURNING *`, vals);
  if (!p) throw new ErrorHttp(404, 'Plan no encontrado');
  limpiarCachePlanes();
  await registrar(req, nuevo ? 'plan_creado' : 'plan_editado', 'plan', null, { codigo, nombre: p.nombre });
  return p;
}

r.post('/backoffice/planes', base, soloSuperadmin, async (req, res) => {
  const codigo = String(req.body?.codigo || req.body?.nombre || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
  if (!codigo) throw new ErrorHttp(400, 'Falta el nombre del plan');
  if (await uno('SELECT 1 AS ok FROM planes WHERE codigo = $1', [codigo])) throw new ErrorHttp(409, 'Ya existe un plan con ese código');
  res.json(await guardarPlan(req, codigo, true));
});
r.put('/backoffice/planes/:codigo', base, soloSuperadmin, async (req, res) => res.json(await guardarPlan(req, req.params.codigo, false)));

// ── Equipo Síguelo ──
r.get('/backoffice/equipo', base, soloSuperadmin, async (_req, res) => {
  res.json(await q(`SELECT id, nombre, correo, rol, activo, ultimo_acceso, creado_en FROM usuarios WHERE empresa_id IS NULL AND rol IN ('superadmin','soporte') ORDER BY activo DESC, nombre`));
});

r.post('/backoffice/equipo', base, soloSuperadmin, async (req, res) => {
  const b = req.body || {};
  const correo = String(b.correo || '').trim().toLowerCase();
  if (!String(b.nombre || '').trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) throw new ErrorHttp(400, 'Indica nombre y un correo válido');
  if (!['superadmin', 'soporte'].includes(b.rol)) throw new ErrorHttp(400, 'Rol no válido');
  if (await uno('SELECT 1 AS ok FROM usuarios WHERE lower(correo) = $1', [correo])) throw new ErrorHttp(409, 'Ese correo ya tiene un usuario', { campo: 'correo' });
  const clave = claveTemporal();
  const [u] = await q(`INSERT INTO usuarios (empresa_id, nombre, correo, clave_hash, rol) VALUES (NULL, $1, $2, $3, $4) RETURNING id, nombre, correo, rol, activo`, [String(b.nombre).trim(), correo, hashClave(clave), b.rol]);
  await registrar(req, 'equipo_usuario_creado', 'usuario', u.id, { correo, rol: b.rol });
  res.json({ usuario: u, clave_temporal: clave });
});

r.patch('/backoffice/equipo/:id', base, soloSuperadmin, async (req, res) => {
  const id = Number(req.params.id), b = req.body || {};
  const u = await uno(`SELECT id FROM usuarios WHERE id = $1 AND empresa_id IS NULL AND rol IN ('superadmin','soporte')`, [id]);
  if (!u) throw new ErrorHttp(404, 'Usuario no encontrado');
  if (id === req.usuario.id && (b.activo === false || (b.rol && b.rol !== 'superadmin'))) throw new ErrorHttp(400, 'No puedes desactivarte ni quitarte el rol de superadmin a ti mismo');
  const sets = [], vals = [id];
  if ('nombre' in b && String(b.nombre).trim()) { vals.push(String(b.nombre).trim()); sets.push(`nombre = $${vals.length}`); }
  if ('rol' in b) { if (!['superadmin', 'soporte'].includes(b.rol)) throw new ErrorHttp(400, 'Rol no válido'); vals.push(b.rol); sets.push(`rol = $${vals.length}`); }
  if ('activo' in b) { vals.push(!!b.activo); sets.push(`activo = $${vals.length}`); }
  if (!sets.length) throw new ErrorHttp(400, 'Nada que cambiar');
  const [x] = await q(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = $1 RETURNING id, nombre, correo, rol, activo`, vals);
  if ('activo' in b && !b.activo) await q('DELETE FROM sesiones WHERE usuario_id = $1', [id]);
  await registrar(req, 'equipo_usuario_editado', 'usuario', id, b);
  res.json(x);
});

r.post('/backoffice/equipo/:id/clave', base, soloSuperadmin, async (req, res) => {
  const id = Number(req.params.id);
  const u = await uno(`SELECT id FROM usuarios WHERE id = $1 AND empresa_id IS NULL AND rol IN ('superadmin','soporte')`, [id]);
  if (!u) throw new ErrorHttp(404, 'Usuario no encontrado');
  const clave = claveTemporal();
  await q('UPDATE usuarios SET clave_hash = $2 WHERE id = $1', [id, hashClave(clave)]);
  await q('DELETE FROM sesiones WHERE usuario_id = $1', [id]);
  await registrar(req, 'equipo_clave_reiniciada', 'usuario', id);
  res.json({ clave_temporal: clave });
});

export default r;
