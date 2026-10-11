// Ingreso, salida, «yo» (usuario + empresa + permisos) y cambio de empresa (superadmin).
import express from 'express';
import { q, uno } from '../db.js';
import { crearSesion, cerrarSesion, verificarClave, requiere, soloSuperadmin, cambiarEmpresaSesion, ErrorHttp } from '../auth.js';
import { registrar } from '../bitacora.js';
import { ROLES } from '../permisos.js';

const r = express.Router();
const intentos = new Map(); // límite simple de intentos fallidos por correo+IP

r.post('/ingresar', async (req, res) => {
  const correo = String(req.body.correo || '').trim().toLowerCase();
  const k = `${correo}|${req.ip}`;
  const i = intentos.get(k) || { n: 0, hasta: 0 };
  if (i.hasta > Date.now()) throw new ErrorHttp(429, 'Demasiados intentos. Espera unos minutos.');
  const u = await uno('SELECT * FROM usuarios WHERE lower(correo) = $1', [correo]);
  if (!u || !u.activo || !verificarClave(req.body.clave || '', u.clave_hash)) {
    i.n += 1; if (i.n >= 8) { i.hasta = Date.now() + 10 * 60e3; i.n = 0; }
    intentos.set(k, i);
    throw new ErrorHttp(401, 'Correo o clave incorrectos.');
  }
  intentos.delete(k);
  let empresaId = u.empresa_id;
  if (!empresaId && u.rol === 'superadmin') empresaId = (await uno('SELECT id FROM empresas WHERE activa ORDER BY id LIMIT 1'))?.id || null;
  await crearSesion(res, { ...u, empresa_id: empresaId }, req.headers['user-agent']);
  await registrar({ usuario: u, empresaId, ip: req.ip }, 'ingreso', 'usuario', u.id);
  res.json({ ok: true, destino: u.rol === 'patio' ? '/patio' : '/inicio' });
});

r.post('/salir', async (req, res) => { await cerrarSesion(req, res); res.json({ ok: true }); });

r.get('/yo', requiere(null, 'ver', { sinEmpresa: true }), async (req, res) => {
  const empresa = req.empresaId ? await uno('SELECT id, nombre, slug, rut, razon_social, logo_clave, color, marcha_blanca, plan, ajustes FROM empresas WHERE id = $1', [req.empresaId]) : null;
  const empresas = req.usuario.rol === 'superadmin' ? await q('SELECT id, nombre FROM empresas ORDER BY nombre') : [];
  const sucursales = req.empresaId ? await q('SELECT id, nombre FROM sucursales WHERE empresa_id = $1 AND activa ORDER BY nombre', [req.empresaId]) : [];
  res.json({ usuario: { id: req.usuario.id, nombre: req.usuario.nombre, correo: req.usuario.correo, rol: req.usuario.rol, rol_nombre: ROLES[req.usuario.rol], sucursal_id: req.usuario.sucursal_id }, permisos: req.usuario.permisos, empresa, empresas, sucursales });
});

r.post('/empresa-activa', requiere(null, 'ver', { sinEmpresa: true }), soloSuperadmin, async (req, res) => {
  const e = await uno('SELECT id FROM empresas WHERE id = $1', [req.body.empresa_id]);
  if (!e) throw new ErrorHttp(404, 'Empresa no encontrada');
  await cambiarEmpresaSesion(req, e.id);
  res.json({ ok: true });
});

export default r;
