// Entrada desde el menú Apps de la plataforma GPS (Síguelo Pro / Síguelo Lite), con el estándar de Síguelo OS.
// La página public/app-plataforma.html limpia la URL y manda authHash + baseUrl aquí. src/app-plataforma.js canjea el
// hash (lista cerrada de cuentas, nunca se llama a la baseUrl recibida) y dice quién es según la plataforma. Acá:
//   · cuenta de la plataforma → empresa: la que conectó esa cuenta en Configuración › Integraciones (empresas.gps_cuenta_id,
//     que se anota al conectar o probar la conexión). Nunca un parámetro de la URL.
//   · usuario de la plataforma → usuario de On Rent: usuarios.gps_usuario_id. Si aún no está vinculado, se pide entrar
//     una vez con correo y clave (cookie firmada de 15 min): así se vincula sin crear usuarios ni roles por adivinanza.
//   · sesión normal de On Rent (la misma cookie del ingreso) + cookie volver_plataforma para la franja y el «Salir».
// No se crea ningún token de la plataforma: On Rent ya trabaja con el token que la empresa conectó.
import express from 'express';
import { q, uno } from '../db.js';
import { crearSesion } from '../auth.js';
import { registrar } from '../bitacora.js';
import { leer } from '../integraciones/index.js';
import { config } from '../config.js';
import * as AP from '../app-plataforma.js';

const HERRAMIENTA = 'Síguelo On Rent';
const M = AP.mensajes(HERRAMIENTA);
const CONTACTO = { correo: 'soporte@siguelogps.cl' };

// Para pruebas: la plataforma no se llama de verdad.
let fetchPlataforma = (...a) => fetch(...a);
export function _usarFetchPlataforma(fn) { fetchPlataforma = fn || ((...a) => fetch(...a)); }

// Límite propio por IP (como el ingreso): el canje es una puerta de entrada.
const intentos = new Map();
function limitar(ip) {
  const ahora = Date.now();
  const i = intentos.get(ip);
  if (!i || ahora - i.desde > 10 * 60e3) { intentos.set(ip, { n: 1, desde: ahora }); return; }
  if (++i.n > 30) throw new AP.ErrorApp('red', 'Demasiados intentos seguidos. Espera unos minutos y vuelve a abrir la app.', 429);
  if (intentos.size > 5000) intentos.clear();
}

/** Empresas cuya conexión a la plataforma GPS es de la cuenta de quien entra. */
async function empresasDe(quien) {
  if (quien.cuentaId) {
    const filas = await q('SELECT id, nombre, activa FROM empresas WHERE gps_cuenta_id = $1', [quien.cuentaId]);
    if (filas.length) return filas;
  }
  // Conexiones anteriores a gps_cuenta_id: el usuario conectado (guardado al conectar) es el mismo que entra, o es la
  // cuenta. Se compara con lo que dijo la plataforma, y si calza se anota la cuenta para la próxima vez.
  const candidatas = await q("SELECT e.id, e.nombre, e.activa FROM empresas e JOIN integraciones i ON i.empresa_id = e.id AND i.tipo = 'gps' WHERE e.gps_cuenta_id IS NULL");
  const nombres = [quien.nombre, quien.cuentaNombre].filter(Boolean).map((n) => n.toLowerCase());
  const calzan = [];
  for (const e of candidatas) {
    const u = String((await leer(e.id, 'gps')).config.usuario || '').trim().toLowerCase();
    if (u && nombres.includes(u)) calzan.push(e);
  }
  if (calzan.length === 1 && quien.cuentaId) await q('UPDATE empresas SET gps_cuenta_id = $1 WHERE id = $2 AND gps_cuenta_id IS NULL', [quien.cuentaId, calzan[0].id]);
  return calzan;
}

const r = express.Router();

r.post('/app-plataforma/sesion', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const seguro = config.produccion;
  try {
    limitar(req.ip);
    const quien = await AP.canjear({ authHash: req.body?.authHash, baseUrl: req.body?.baseUrl }, { herramienta: HERRAMIENTA, fetch: fetchPlataforma });
    const empresas = await empresasDe(quien);
    if (empresas.length !== 1) {
      if (empresas.length > 1) console.warn(`[app-plataforma] La cuenta ${quien.cuentaId} está conectada a ${empresas.length} empresas.`);
      throw new AP.ErrorApp('sin_acceso', empresas.length > 1 ? 'Tu cuenta de la plataforma de rastreo está conectada a más de una empresa. Escríbenos a soporte para dejarla en una sola.' : M.sin_acceso, 403);
    }
    const e = empresas[0];
    if (!e.activa) throw new AP.ErrorApp('suspendida', M.suspendida, 403);
    const { config: gps } = await leer(e.id, 'gps');
    const volverA = AP.volverPara(quien, gps.cuenta === 'lite' ? 'lite' : 'pro');

    const u = await uno("SELECT * FROM usuarios WHERE empresa_id = $1 AND gps_usuario_id = $2 AND rol <> 'superadmin'", [e.id, quien.id]);
    if (u && !u.activo) throw new AP.ErrorApp('suspendida', M.suspendida, 403);
    if (!u) {
      res.append('Set-Cookie', AP.cookieVinculo({ empresa: e.id, gpsId: quien.id, nombre: quien.nombre, volver: volverA }, config.secreto, { seguro }));
      await registrar({ usuario: null, empresaId: e.id, ip: req.ip }, 'ingreso_plataforma_sin_vincular', 'usuario', null, { gps_usuario: quien.nombre, gps_usuario_id: quien.id });
      return res.status(403).json({ motivo: 'no_vinculado', error: M.no_vinculado, ingreso: '/ingresar' });
    }
    await crearSesion(res, u, req.headers['user-agent']);
    res.append('Set-Cookie', AP.cookieVolver(volverA, { seguro }));
    await registrar({ usuario: u, empresaId: e.id, ip: req.ip }, 'ingreso', 'usuario', u.id, { origen: 'plataforma_gps' });
    res.json({ ok: true, ir: u.rol === 'patio' ? '/patio' : '/inicio', nombre: u.nombre, empresa: e.nombre });
  } catch (err) {
    if (err instanceof AP.ErrorApp) {
      return res.status(err.status).json({ motivo: err.motivo, error: err.message, ...(['sin_acceso', 'suspendida'].includes(err.motivo) ? { contacto: CONTACTO } : {}) });
    }
    console.error('[app-plataforma] Error en la entrada desde el menú Apps:', err.message);
    res.status(500).json({ motivo: 'red', error: M.red });
  }
});

/**
 * Después de un ingreso con correo y clave: si había un usuario de la plataforma por vincular (cookie firmada, 15 min)
 * y es de la MISMA empresa, se vinculan. Si no, la sesión es «normal» y se borra la marca de la plataforma.
 */
export async function vincularTrasIngreso(req, res, u) {
  const seguro = config.produccion;
  const v = AP.leerVinculo(AP.leerCookie(req, AP.COOKIE_VINCULO), config.secreto);
  res.append('Set-Cookie', AP.cookieBorrar(AP.COOKIE_VINCULO, { seguro }));
  if (!v || !u.empresa_id || String(u.empresa_id) !== v.empresa) { res.append('Set-Cookie', AP.cookieBorrar(AP.COOKIE_VOLVER, { seguro })); return false; }
  const ocupado = await uno('SELECT id FROM usuarios WHERE empresa_id = $1 AND gps_usuario_id = $2', [u.empresa_id, v.gpsId]);
  if (!ocupado) {
    await q('UPDATE usuarios SET gps_usuario_id = $1 WHERE id = $2 AND gps_usuario_id IS NULL', [v.gpsId, u.id]);
    await registrar({ usuario: u, empresaId: u.empresa_id, ip: req.ip }, 'vincular_plataforma_gps', 'usuario', u.id, { gps_usuario: v.nombre, gps_usuario_id: v.gpsId });
  }
  if (v.volver) res.append('Set-Cookie', AP.cookieVolver(v.volver, { seguro }));
  return !ocupado;
}

export default r;
