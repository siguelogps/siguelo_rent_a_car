// Ingreso, salida, «yo» (usuario + empresa + permisos) y cambio de empresa (superadmin).
import express from 'express';
import { q, uno } from '../db.js';
import { crearSesion, cerrarSesion, verificarClave, requiere, soloSiguelo, cambiarEmpresaSesion, puedeOperar, ErrorHttp } from '../auth.js';
import { registrar } from '../bitacora.js';
import { ROLES, esSiguelo } from '../permisos.js';
import { planDeEmpresa, MODULOS_BASE } from '../planes.js';
import { vincularTrasIngreso } from './15-app-plataforma.js';

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
  // Cliente suspendido o dado de baja con el plazo de exportación vencido: su gente no entra (22-oct, espec. Backoffice).
  if (!esSiguelo(u.rol) && u.empresa_id) {
    const e = await uno(`SELECT estado, (exportar_hasta IS NOT NULL AND exportar_hasta < (now() AT TIME ZONE 'America/Santiago')::date) AS vencido FROM empresas WHERE id = $1`, [u.empresa_id]);
    if (e?.estado === 'suspendido') throw new ErrorHttp(403, 'El servicio de tu empresa está suspendido. Escribe a soporte@siguelogps.cl o llama a Síguelo GPS.');
    if (e?.estado === 'baja' && e.vencido) throw new ErrorHttp(403, 'La cuenta de tu empresa fue dada de baja y el plazo para exportar los datos terminó.');
  }
  // App con la marca de un cliente (?app=<slug>): solo entra el personal de esa empresa (y el equipo Síguelo).
  const appEmpresa = String(req.body.app || '').trim().toLowerCase();
  if (appEmpresa && !esSiguelo(u.rol)) {
    const e = await uno('SELECT id, nombre FROM empresas WHERE slug = $1', [appEmpresa]);
    if (e && Number(e.id) !== Number(u.empresa_id)) throw new ErrorHttp(403, `Esta app es de ${e.nombre}. Ingresa con la app Síguelo On Rent o con la app de tu empresa.`);
  }
  const empresaId = esSiguelo(u.rol) ? null : u.empresa_id; // el equipo Síguelo entra a su backoffice
  // App nativa (Android): pide { nativa: true } y recibe el token de la sesión en la respuesta, no en una cookie.
  const nativa = req.body.nativa === true;
  const token = await crearSesion(res, { ...u, empresa_id: empresaId }, req.headers['user-agent'], { nativa });
  await registrar({ usuario: u, empresaId, ip: req.ip }, nativa ? 'ingreso_app' : 'ingreso', 'usuario', u.id);
  // Si vino del menú Apps de la plataforma GPS sin estar vinculado, este ingreso lo vincula (misma empresa, 15 min).
  if (!nativa) await vincularTrasIngreso(req, res, { ...u, empresa_id: empresaId });
  res.json({ ok: true, destino: esSiguelo(u.rol) ? '/empresas' : u.rol === 'patio' ? '/patio' : '/inicio', ...(nativa ? { token } : {}) });
});

r.post('/salir', async (req, res) => { await cerrarSesion(req, res); res.json({ ok: true }); });

r.get('/yo', requiere(null, 'ver', { sinEmpresa: true }), async (req, res) => {
  const empresa = req.empresaId ? await uno('SELECT id, nombre, slug, rut, razon_social, logo_clave, color, marcha_blanca, plan, ajustes, estado, exportar_hasta FROM empresas WHERE id = $1', [req.empresaId]) : null;
  const sucursales = req.empresaId ? await q('SELECT id, nombre FROM sucursales WHERE empresa_id = $1 AND activa ORDER BY nombre', [req.empresaId]) : [];
  const plan = req.empresaId ? await planDeEmpresa(req.empresaId) : null;
  // Módulos fuera del plan contratado no aparecen en el menú (el servidor también los bloquea)
  const permisos = Object.fromEntries(Object.entries(req.usuario.permisos).map(([m, n]) => [m, !plan || MODULOS_BASE.includes(m) || plan.modulos.includes(m) ? n : null]));
  const siguelo = esSiguelo(req.usuario.rol);
  res.json({
    usuario: { id: req.usuario.id, nombre: req.usuario.nombre, correo: req.usuario.correo, rol: req.usuario.rol, rol_nombre: ROLES[req.usuario.rol], sucursal_id: req.usuario.sucursal_id },
    permisos, empresa, sucursales, siguelo, modo: siguelo && !req.empresaId ? 'backoffice' : 'cliente', ver_como: req.modoSiguelo === 'ver',
    // 22-oct: equipo Síguelo dentro de un cliente: «ver» (solo lectura, franja azul) u «operar» (con motivo, franja amarilla).
    siguelo_modo: req.modoSiguelo, siguelo_motivo: req.motivoSiguelo, siguelo_desde: req.entradaSiguelo ? (await uno('SELECT inicio FROM entradas_siguelo WHERE id = $1', [req.entradaSiguelo]))?.inicio || null : null,
    siguelo_nivel: req.usuario.nivel, puede_operar: puedeOperar(req.usuario), solo_lectura: !!req.soloLectura,
    plan: plan ? { codigo: plan.codigo, nombre: plan.nombre, modulos: plan.modulos } : null, empresas: []
  });
});

// Entrar a la cuenta de un cliente (22-oct, espec. Backoffice): «Ver como» (solo lectura, lo bloquea el servidor) u
// «Operar» (con motivo; solo niveles admin y usa de On Board; cada cambio queda en la bitácora del cliente con el nombre de
// quien operó). La entrada se anota en entradas_siguelo y en la bitácora del cliente. empresa_id = null vuelve al backoffice.
export async function entrarComoSiguelo(req, empresaId, modo, motivo) {
  modo = modo === 'operar' ? 'operar' : 'ver';
  motivo = String(motivo || '').trim().slice(0, 300);
  const e = await uno('SELECT id, nombre, estado FROM empresas WHERE id = $1', [empresaId]);
  if (!e) throw new ErrorHttp(404, 'Cliente no encontrado');
  if (modo === 'operar') {
    if (!puedeOperar(req.usuario)) throw new ErrorHttp(403, 'Tu nivel en Síguelo On Board solo permite «Ver como».');
    if (e.estado !== 'activo') throw new ErrorHttp(409, `A un cliente ${e.estado === 'baja' ? 'dado de baja' : 'suspendido'} solo se puede entrar con «Ver como».`);
    if (motivo.length < 4) throw new ErrorHttp(400, 'Para operar escribe el motivo (por ejemplo, «Soporte, ticket 1187»).', { campo: 'motivo' });
  }
  await salirDeCliente(req);
  const [ent] = await q('INSERT INTO entradas_siguelo (empresa_id, usuario_id, modo, motivo) VALUES ($1,$2,$3,$4) RETURNING id', [e.id, req.usuario.id, modo, motivo || null]);
  await cambiarEmpresaSesion(req, e.id, { modo, motivo: motivo || null, entradaId: ent.id });
  await registrar({ usuario: req.usuario, empresaId: e.id, ip: req.ip }, modo === 'operar' ? 'siguelo_entro_operar' : 'siguelo_entro_ver', 'empresa', e.id,
    { por: req.usuario.nombre, correo: req.usuario.correo, ...(motivo ? { motivo } : {}), siguelo: { modo, ...(motivo ? { motivo } : {}) } });
  return e;
}

async function salirDeCliente(req) {
  if (!req.empresaId) return;
  if (req.entradaSiguelo) await q('UPDATE entradas_siguelo SET fin = now() WHERE id = $1 AND fin IS NULL', [req.entradaSiguelo]);
  await registrar(req, 'siguelo_salio', 'empresa', req.empresaId, { por: req.usuario.nombre });
}

r.post('/empresa-activa', requiere(null, 'ver', { sinEmpresa: true }), soloSiguelo, async (req, res) => {
  if (req.body.empresa_id == null) {
    await salirDeCliente(req);
    await cambiarEmpresaSesion(req, null);
    return res.json({ ok: true, destino: '/empresas' });
  }
  await entrarComoSiguelo(req, Number(req.body.empresa_id), req.body.modo, req.body.motivo);
  res.json({ ok: true, destino: '/inicio' });
});

export default r;
