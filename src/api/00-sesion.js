// Ingreso, salida, «yo» (usuario + empresa + permisos) y cambio de empresa (superadmin).
import express from 'express';
import { q, uno } from '../db.js';
import { crearSesion, cerrarSesion, verificarClave, requiere, soloSiguelo, cambiarEmpresaSesion, ErrorHttp } from '../auth.js';
import { registrar } from '../bitacora.js';
import { ROLES, esSiguelo } from '../permisos.js';
import { planDeEmpresa, MODULOS_BASE } from '../planes.js';

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
  // App con la marca de un cliente (?app=<slug>): solo entra el personal de esa empresa (y el equipo Síguelo).
  const appEmpresa = String(req.body.app || '').trim().toLowerCase();
  if (appEmpresa && !esSiguelo(u.rol)) {
    const e = await uno('SELECT id, nombre FROM empresas WHERE slug = $1', [appEmpresa]);
    if (e && Number(e.id) !== Number(u.empresa_id)) throw new ErrorHttp(403, `Esta app es de ${e.nombre}. Ingresa con la app Síguelo On Rent o con la app de tu empresa.`);
  }
  const empresaId = esSiguelo(u.rol) ? null : u.empresa_id; // el equipo Síguelo entra a su backoffice
  await crearSesion(res, { ...u, empresa_id: empresaId }, req.headers['user-agent']);
  await registrar({ usuario: u, empresaId, ip: req.ip }, 'ingreso', 'usuario', u.id);
  res.json({ ok: true, destino: esSiguelo(u.rol) ? '/empresas' : u.rol === 'patio' ? '/patio' : '/inicio' });
});

r.post('/salir', async (req, res) => { await cerrarSesion(req, res); res.json({ ok: true }); });

r.get('/yo', requiere(null, 'ver', { sinEmpresa: true }), async (req, res) => {
  const empresa = req.empresaId ? await uno('SELECT id, nombre, slug, rut, razon_social, logo_clave, color, marcha_blanca, plan, ajustes FROM empresas WHERE id = $1', [req.empresaId]) : null;
  const sucursales = req.empresaId ? await q('SELECT id, nombre FROM sucursales WHERE empresa_id = $1 AND activa ORDER BY nombre', [req.empresaId]) : [];
  const plan = req.empresaId ? await planDeEmpresa(req.empresaId) : null;
  // Módulos fuera del plan contratado no aparecen en el menú (el servidor también los bloquea)
  const permisos = Object.fromEntries(Object.entries(req.usuario.permisos).map(([m, n]) => [m, !plan || MODULOS_BASE.includes(m) || plan.modulos.includes(m) ? n : null]));
  const siguelo = esSiguelo(req.usuario.rol);
  res.json({
    usuario: { id: req.usuario.id, nombre: req.usuario.nombre, correo: req.usuario.correo, rol: req.usuario.rol, rol_nombre: ROLES[req.usuario.rol], sucursal_id: req.usuario.sucursal_id },
    permisos, empresa, sucursales, siguelo, modo: siguelo && !req.empresaId ? 'backoffice' : 'cliente', ver_como: siguelo && !!req.empresaId,
    plan: plan ? { codigo: plan.codigo, nombre: plan.nombre, modulos: plan.modulos } : null, empresas: []
  });
});

// «Ver como»: el equipo Síguelo entra a la cuenta de un cliente (empresa_id) o vuelve al backoffice (null).
r.post('/empresa-activa', requiere(null, 'ver', { sinEmpresa: true }), soloSiguelo, async (req, res) => {
  if (req.body.empresa_id == null) {
    if (req.empresaId) await registrar(req, 'ver_como_fin', 'empresa', req.empresaId);
    await cambiarEmpresaSesion(req, null);
    return res.json({ ok: true, destino: '/empresas' });
  }
  const e = await uno('SELECT id, nombre FROM empresas WHERE id = $1', [req.body.empresa_id]);
  if (!e) throw new ErrorHttp(404, 'Empresa no encontrada');
  await cambiarEmpresaSesion(req, e.id);
  await registrar({ usuario: req.usuario, empresaId: e.id, ip: req.ip }, 'ver_como_inicio', 'empresa', e.id, { por: req.usuario.nombre, correo: req.usuario.correo });
  res.json({ ok: true, destino: '/inicio' });
});

export default r;
