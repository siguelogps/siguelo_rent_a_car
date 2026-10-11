// Sesiones con cookie httpOnly (token aleatorio; en la base solo se guarda su hash), claves con scrypt.
import crypto from 'node:crypto';
import { q, uno } from './db.js';
import { config } from './config.js';
import { hashSha256, tokenAleatorio } from './cifrado.js';
import { puede, permisosDe, esSiguelo } from './permisos.js';
import { incluye } from './planes.js';

const COOKIE = 'rc_sesion';
const DURACION_MS = 12 * 3600e3;

export function hashClave(clave) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(clave), sal, 64);
  return `scrypt$${sal.toString('base64')}$${h.toString('base64')}`;
}
export function verificarClave(clave, guardado) {
  if (!guardado?.startsWith('scrypt$')) return false;
  const [, sal, h] = guardado.split('$');
  const calc = crypto.scryptSync(String(clave), Buffer.from(sal, 'base64'), 64);
  const esperado = Buffer.from(h, 'base64');
  return calc.length === esperado.length && crypto.timingSafeEqual(calc, esperado);
}

export async function crearSesion(res, usuario, agente = '') {
  const token = tokenAleatorio(32);
  await q('INSERT INTO sesiones (token_hash, usuario_id, empresa_id, expira_en, agente) VALUES ($1,$2,$3,$4,$5)',
    [hashSha256(token), usuario.id, usuario.empresa_id, new Date(Date.now() + DURACION_MS), String(agente).slice(0, 200)]);
  await q('UPDATE usuarios SET ultimo_acceso = now() WHERE id = $1', [usuario.id]);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.produccion, maxAge: DURACION_MS, path: '/' });
}

export async function cerrarSesion(req, res) {
  const t = leerCookie(req, COOKIE);
  if (t) await q('DELETE FROM sesiones WHERE token_hash = $1', [hashSha256(t)]);
  res.clearCookie(COOKIE, { path: '/' });
}

export function leerCookie(req, nombre) {
  const c = req.headers.cookie || '';
  for (const parte of c.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nombre) return decodeURIComponent(v.join('='));
  }
  return null;
}

// Middleware: deja req.usuario { id, nombre, correo, rol, empresa_id (activa), permisos } o nada.
export async function cargarSesion(req, _res, next) {
  const t = leerCookie(req, COOKIE);
  if (!t) return next();
  const s = await uno(
    `SELECT u.id, u.nombre, u.correo, u.rol, u.sucursal_id, u.activo, s.empresa_id, s.token_hash
       FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = $1 AND s.expira_en > now()`, [hashSha256(t)]);
  if (s && s.activo) {
    req.usuario = { ...s, permisos: permisosDe(s.rol), siguelo: esSiguelo(s.rol) };
    req.empresaId = s.empresa_id;
    req.verComo = esSiguelo(s.rol) && !!s.empresa_id; // equipo Síguelo dentro de la cuenta de un cliente
  }
  next();
}

export class ErrorHttp extends Error {
  constructor(estado, mensaje, extra = {}) { super(mensaje); this.estado = estado; Object.assign(this, extra); }
}

// requiere('reservas', 'editar') → 401/403 si no corresponde; exige empresa activa salvo { sinEmpresa: true }.
export const requiere = (modulo = null, accion = 'ver', { sinEmpresa = false } = {}) => async (req, _res, next) => {
  if (!req.usuario) throw new ErrorHttp(401, 'Tu sesión terminó. Vuelve a ingresar.');
  if (modulo && !puede(req.usuario.rol, modulo, accion)) throw new ErrorHttp(403, 'Tu rol no tiene permiso para esta acción.');
  if (!sinEmpresa && !req.empresaId) throw new ErrorHttp(400, req.usuario.siguelo ? 'Entra a la cuenta de un cliente con «Ver como» desde el backoffice.' : 'Elige una empresa para continuar.');
  if (modulo && req.empresaId && !(await incluye(req.empresaId, modulo))) throw new ErrorHttp(403, 'El plan contratado no incluye este módulo. Pide a Síguelo un cambio de plan.');
  next();
};
export const soloSuperadmin = (req, _res, next) => {
  if (req.usuario?.rol !== 'superadmin') throw new ErrorHttp(403, 'Solo un superadmin de Síguelo puede hacer esto.');
  next();
};
export const soloSiguelo = (req, _res, next) => {
  if (!esSiguelo(req.usuario?.rol)) throw new ErrorHttp(403, 'Solo el equipo de Síguelo puede hacer esto.');
  next();
};

export async function cambiarEmpresaSesion(req, empresaId) {
  const t = leerCookie(req, COOKIE);
  await q('UPDATE sesiones SET empresa_id = $1 WHERE token_hash = $2', [empresaId, hashSha256(t)]);
}
