// Sesiones con cookie httpOnly (token aleatorio; en la base solo se guarda su hash), claves con scrypt.
import crypto from 'node:crypto';
import { q, uno } from './db.js';
import { config } from './config.js';
import { hashSha256, tokenAleatorio } from './cifrado.js';
import { puede, permisosDe, esSiguelo } from './permisos.js';
import { incluye } from './planes.js';

const COOKIE = 'rc_sesion';
const DURACION_MS = 12 * 3600e3;
// App nativa: la sesión dura 30 días (el personal de patio no puede reingresar a cada rato con el teléfono en la mano).
// Se cierra al salir, al eliminar la cuenta o al desactivar al usuario, igual que la de la web.
const DURACION_NATIVA_MS = 30 * 24 * 3600e3;

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

// nativa = true: la app Android. El token va en la respuesta (la app lo guarda cifrado con el Keystore y lo manda como
// «Authorization: Bearer»), no en una cookie. El navegador nunca recibe el token: sigue con la cookie httpOnly.
export async function crearSesion(res, usuario, agente = '', { nativa = false } = {}) {
  const token = tokenAleatorio(32);
  const dura = nativa ? DURACION_NATIVA_MS : DURACION_MS;
  await q('INSERT INTO sesiones (token_hash, usuario_id, empresa_id, expira_en, agente) VALUES ($1,$2,$3,$4,$5)',
    [hashSha256(token), usuario.id, usuario.empresa_id, new Date(Date.now() + dura), String(agente).slice(0, 200)]);
  await q('UPDATE usuarios SET ultimo_acceso = now() WHERE id = $1', [usuario.id]);
  if (nativa) return token;
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.produccion, maxAge: dura, path: '/' });
  return null;
}

export async function cerrarSesion(req, res) {
  const t = tokenDeSesion(req);
  if (t) await q('DELETE FROM sesiones WHERE token_hash = $1', [hashSha256(t)]);
  res.clearCookie(COOKIE, { path: '/' });
}

// Token de la sesión: «Authorization: Bearer …» (app nativa) o la cookie (web).
export function tokenDeSesion(req) {
  const a = String(req.headers.authorization || '');
  if (/^Bearer [\w-]{20,100}$/.test(a)) return a.slice(7);
  return leerCookie(req, COOKIE);
}

export function leerCookie(req, nombre) {
  const c = req.headers.cookie || '';
  for (const parte of c.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nombre) return decodeURIComponent(v.join('='));
  }
  return null;
}

// Nivel de Síguelo On Board de una persona del equipo: admin y usa pueden «Operar»; ve solo «Ver como».
// Quien entró con usuario y clave (sin pasar por el panel) conserva lo que dice su rol: superadmin = admin, soporte = usa.
export const nivelPanel = (u) => (['admin', 'usa', 've'].includes(u?.nivel_panel) ? u.nivel_panel : u?.rol === 'superadmin' ? 'admin' : 'usa');
export const puedeOperar = (u) => esSiguelo(u?.rol) && nivelPanel(u) !== 've';

const MENSAJE_BLOQUEO = {
  suspendido: 'El servicio de tu empresa está suspendido. Escribe a soporte@siguelogps.cl o llama a Síguelo GPS.',
  baja: 'La cuenta de tu empresa fue dada de baja y el plazo para exportar los datos terminó.'
};

// Middleware: deja req.usuario { id, nombre, correo, rol, empresa_id (activa), permisos } o nada.
// 22-oct (espec. Backoffice): req.modoSiguelo = 'ver' | 'operar' cuando el equipo Síguelo está dentro de un cliente, y
// req.soloLectura cuando el servidor debe rechazar cualquier cambio («Ver como», o un cliente dado de baja que exporta).
export async function cargarSesion(req, _res, next) {
  const t = tokenDeSesion(req);
  if (!t) return next();
  const s = await uno(
    `SELECT u.id, u.nombre, u.correo, u.rol, u.sucursal_id, u.activo, u.nivel_panel, s.empresa_id, s.token_hash, s.modo, s.motivo, s.entrada_id, s.creado_en AS sesion_desde,
            e.estado AS empresa_estado, (e.exportar_hasta IS NOT NULL AND e.exportar_hasta < (now() AT TIME ZONE 'America/Santiago')::date) AS exportar_vencido
       FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id LEFT JOIN empresas e ON e.id = s.empresa_id
      WHERE s.token_hash = $1 AND s.expira_en > now()`, [hashSha256(t)]);
  if (s && s.activo) {
    const siguelo = esSiguelo(s.rol);
    // Cliente suspendido (o dado de baja con el plazo vencido): su gente no entra. Síguelo sí («Ver como»).
    if (!siguelo && (s.empresa_estado === 'suspendido' || (s.empresa_estado === 'baja' && s.exportar_vencido))) {
      req.bloqueo = MENSAJE_BLOQUEO[s.empresa_estado];
      return next();
    }
    const { modo, motivo, entrada_id: entradaId, empresa_estado: estado, exportar_vencido: _v, ...u } = s;
    req.usuario = { ...u, permisos: permisosDe(s.rol), siguelo, nivel: siguelo ? nivelPanel(s) : null };
    req.empresaId = s.empresa_id;
    req.empresaEstado = estado || null;
    req.modoSiguelo = siguelo && s.empresa_id ? (modo === 'operar' ? 'operar' : 'ver') : null;
    req.motivoSiguelo = req.modoSiguelo === 'operar' ? motivo : null;
    req.entradaSiguelo = entradaId || null;
    req.verComo = req.modoSiguelo === 'ver';
    req.soloLectura = req.modoSiguelo === 'ver' || (!siguelo && estado === 'baja');
    req.tokenHash = s.token_hash;
  }
  next();
}

// Lo que se puede hacer aunque la sesión sea de solo lectura: salir, volver al backoffice o pasar a operar, «Mi clave»
// y las vistas previas que no guardan nada.
const PERMITIDO_SOLO_LECTURA = [/^\/api\/salir$/, /^\/api\/empresa-activa$/, /^\/api\/configuracion\/mi-clave$/, /^\/api\/configuracion\/plantillas\/vista-previa$/, /^\/api\/buscar/];
export function soloLectura(req, _res, next) {
  if (!req.soloLectura || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const ruta = req.originalUrl.split('?')[0];
  if (PERMITIDO_SOLO_LECTURA.some((r) => r.test(ruta))) return next();
  if (req.usuario?.siguelo && ruta.startsWith('/api/backoffice/')) return next(); // acciones del backoffice (sobre un cliente explícito, con su propia bitácora)
  throw new ErrorHttp(403, req.modoSiguelo === 'ver'
    ? 'Estás en «Ver como» (solo lectura): no se puede cambiar nada. Para hacer cambios, vuelve al backoffice y usa «Operar» con un motivo.'
    : 'La cuenta de tu empresa fue dada de baja: puedes revisar y exportar tus datos, pero no hacer cambios.', { soloLectura: true });
}

export class ErrorHttp extends Error {
  constructor(estado, mensaje, extra = {}) { super(mensaje); this.estado = estado; Object.assign(this, extra); }
}

// requiere('reservas', 'editar') → 401/403 si no corresponde; exige empresa activa salvo { sinEmpresa: true }.
export const requiere = (modulo = null, accion = 'ver', { sinEmpresa = false } = {}) => async (req, _res, next) => {
  if (!req.usuario && req.bloqueo) throw new ErrorHttp(403, req.bloqueo, { bloqueo: true });
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

export async function cambiarEmpresaSesion(req, empresaId, { modo = null, motivo = null, entradaId = null } = {}) {
  const t = tokenDeSesion(req);
  await q('UPDATE sesiones SET empresa_id = $1, modo = $3, motivo = $4, entrada_id = $5 WHERE token_hash = $2', [empresaId, hashSha256(t), empresaId ? modo : null, empresaId ? motivo : null, empresaId ? entradaId : null]);
}
