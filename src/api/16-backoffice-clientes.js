// Backoffice Síguelo estándar (espec. aprobada por Pablo el 22-oct; mockups en On Bus, aquí con el estilo de On Rent).
// Clientes: lista con salud de integraciones, alta en 4 pasos (el primer administrador recibe una invitación), ficha con
// pestañas, suspender / reactivar / dar de baja con motivo y nombre escrito, marcha blanca (solo Síguelo), integraciones
// gestionadas por Síguelo, enlace de carga del certificado y los CAF, usuarios del cliente, «Ver como» y «Operar».
// Además: bandeja «Solicitudes», Conexiones generales (almacenamiento, correo de Síguelo, CRM) y bitácora global.
// Quién puede qué: todo el equipo ve; cambiar algo exige nivel admin o usa de On Board (el nivel ve solo mira y «Ver como»);
// las conexiones generales, solo superadmin. Nunca vuelve un secreto al navegador.
import express from 'express';
import { q, uno } from '../db.js';
import { requiere, soloSiguelo, soloSuperadmin, puedeOperar, ErrorHttp } from '../auth.js';
import { registrar } from '../bitacora.js';
import { hashSha256, tokenAleatorio } from '../cifrado.js';
import { config } from '../config.js';
import { normalizarRut, validarRut } from '../util/rut.js';
import { MODULOS_PLAN, planDeEmpresa, usoDeEmpresa, limpiarCachePlanes } from '../planes.js';
import { TIPOS, leer, leerPublica, guardar, activar, registrarPrueba, desconectarTodo, tiposDe, HOST_SESION_GPS, limpiarCache } from '../integraciones/index.js';
import { probador } from '../integraciones/probadores.js';
import { crearEmpresa } from './01-empresas.js';
import { entrarComoSiguelo } from './00-sesion.js';
import { saludDeTodos, salud } from '../siguelo/tarjetas.js';
import { invitar } from '../siguelo/invitaciones.js';
import { crearEnlace, enlacesDe, PIEZAS } from '../siguelo/carga.js';
import { TIPOS_SOLICITUD, reintentarCrm } from '../siguelo/solicitudes.js';
import { GENERALES, leerGeneral, leerGeneralPublica, guardarGeneral, registrarPruebaGeneral } from '../siguelo/conexiones.js';
import { enviarCorreoSiguelo } from '../siguelo/correo.js';
import { firmar, HERRAMIENTA } from '../siguelo/crm.js';
import { DIAS_EXPORTAR, procesarBajasVencidas } from '../siguelo/bajas.js';
import { configuracionPush } from '../app-nativa/push.js';
import { registrarTarea } from '../tareas.js';
import { ROLES } from '../permisos.js';

const r = express.Router();
const base = [requiere(null, 'ver', { sinEmpresa: true }), soloSiguelo];
const cambia = (req, _res, next) => {
  if (!puedeOperar(req.usuario)) throw new ErrorHttp(403, 'Tu nivel en Síguelo On Board permite mirar y «Ver como», no hacer cambios.');
  next();
};
const texto = (v, max = 200) => (v == null ? null : String(v).trim().slice(0, max) || null);
const correoValido = (c) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(c || ''));
const bit = (req, empresaId, accion, detalle = {}) => registrar({ usuario: req.usuario, empresaId, ip: req.ip }, accion, 'empresa', empresaId, { por: req.usuario.nombre, ...detalle });

async function empresaDe(id) {
  const e = await uno('SELECT * FROM empresas WHERE id = $1', [Number(id)]);
  if (!e) throw new ErrorHttp(404, 'Cliente no encontrado');
  return e;
}
const mismoNombre = (a, b) => String(a || '').trim().toLowerCase().replace(/\s+/g, ' ') === String(b || '').trim().toLowerCase().replace(/\s+/g, ' ');

// ── Resumen para el menú (contadores) ──
r.get('/backoffice/resumen', ...base, async (req, res) => {
  const [c] = await q(`SELECT count(*)::int AS clientes, (SELECT count(*)::int FROM solicitudes_siguelo WHERE estado IN ('pendiente','en_curso')) AS solicitudes FROM empresas WHERE estado <> 'baja'`);
  res.json({ ...c, nivel: req.usuario.nivel, puede_operar: puedeOperar(req.usuario), superadmin: req.usuario.rol === 'superadmin' });
});

// ── Lista de clientes ──
r.get('/backoffice/clientes', ...base, async (_req, res) => {
  const filas = await q(`SELECT e.id, e.nombre, e.razon_social, e.rut, e.slug, e.color, e.logo_clave, e.estado, e.estado_motivo, e.estado_en, e.marcha_blanca, e.plan, e.creado_en, e.exportar_hasta, e.distribuidor,
      p.nombre AS plan_nombre, e.modulos_extra,
      (SELECT count(*)::int FROM vehiculos v WHERE v.empresa_id = e.id AND v.activo) AS vehiculos,
      (SELECT count(*)::int FROM usuarios u WHERE u.empresa_id = e.id AND u.activo) AS usuarios,
      (SELECT max(b.creado_en) FROM bitacora b WHERE b.empresa_id = e.id) AS ultima_actividad,
      (SELECT count(*)::int FROM solicitudes_siguelo s WHERE s.empresa_id = e.id AND s.estado IN ('pendiente','en_curso')) AS solicitudes
    FROM empresas e LEFT JOIN planes p ON p.codigo = e.plan ORDER BY e.nombre`);
  const saludes = await saludDeTodos();
  const tipos = tiposDe('siguelo');
  res.json({ clientes: filas.map((e) => ({ ...e, salud: Object.fromEntries(tipos.map((t) => [t, saludes.get(e.id)?.[t] || 'no'])) })), tipos: tipos.map((t) => ({ tipo: t, nombre: TIPOS[t].nombreCliente || TIPOS[t].nombre })) });
});

// ── Alta (asistente de 4 pasos) ──
r.post('/backoffice/clientes', ...base, cambia, async (req, res) => {
  const b = req.body || {};
  const d = b.datos || {}, admin = b.admin || {}, integ = b.integraciones || {};
  if (!texto(d.nombre)) throw new ErrorHttp(400, 'Escribe el nombre de fantasía', { campo: 'nombre', paso: 1 });
  if (d.rut && !validarRut(d.rut)) throw new ErrorHttp(400, 'El RUT no es válido', { campo: 'rut', paso: 1 });
  if (!texto(admin.nombre)) throw new ErrorHttp(400, 'Escribe el nombre del primer administrador', { campo: 'admin_nombre', paso: 4 });
  const correoAdmin = String(admin.correo || '').trim().toLowerCase();
  if (!correoValido(correoAdmin)) throw new ErrorHttp(400, 'El correo del administrador no es válido', { campo: 'admin_correo', paso: 4 });
  if (await uno('SELECT 1 AS ok FROM usuarios WHERE lower(correo) = $1', [correoAdmin])) throw new ErrorHttp(409, 'Ese correo ya tiene un usuario en Síguelo On Rent', { campo: 'admin_correo', paso: 4 });
  const plan = b.plan && await uno('SELECT codigo FROM planes WHERE codigo = $1 AND activo', [b.plan]) ? b.plan : 'pro';
  const e = await crearEmpresa({ ...d, rut: d.rut ? normalizarRut(d.rut) : null, plan, admin_nombre: texto(admin.nombre, 100), admin_correo: correoAdmin, admin_telefono: texto(admin.telefono, 30) });
  const extras = (Array.isArray(b.modulos_extra) ? b.modulos_extra : []).filter((m) => MODULOS_PLAN[m]);
  if (extras.length) await q('UPDATE empresas SET modulos_extra = $2 WHERE id = $1', [e.id, extras]);
  // Integraciones elegidas: se dejan listas. El cliente parte en marcha blanca: aunque queden activas, nada sale.
  const hechas = [];
  if (integ.gps) { await guardar(e.id, 'gps', { cuenta: integ.gps.cuenta === 'lite' ? 'lite' : 'hosting' }, req.usuario.id); hechas.push('gps'); }
  if (integ.correo) {
    await guardar(e.id, 'correo', { modo: 'siguelo', remitente_nombre: texto(integ.correo.remitente_nombre, 80) || e.nombre, responder_a: texto(integ.correo.responder_a, 120) || d.correo || null }, req.usuario.id);
    await activar(e.id, 'correo', true, req.usuario.id); hechas.push('correo');
  }
  if (integ.dashboard_siguelo) { await activar(e.id, 'dashboard_siguelo', true, req.usuario.id); hechas.push('dashboard_siguelo'); }
  if (integ.whatsapp) hechas.push('whatsapp');
  let enlace = null;
  if (integ.simpleapi) {
    hechas.push('simpleapi');
    if (integ.simpleapi.pedir_archivos !== false) enlace = await crearEnlace({ empresaId: e.id, piezas: ['certificado', 'caf_39', 'caf_33', 'caf_61'], correo: integ.simpleapi.correo || correoAdmin, usuarioId: req.usuario.id }).catch((x) => ({ error: x.message }));
  }
  await bit(req, e.id, 'cliente_alta', { nombre: e.nombre, plan, integraciones: hechas });
  const invitacion = await invitar(e.admin_id);
  res.json({ empresa: { id: e.id, nombre: e.nombre, slug: e.slug }, invitacion, enlace_carga: enlace });
});

// ── Ficha ──
async function historialIntegracion(empresaId, tipo) {
  return q(`SELECT b.accion, b.detalle, b.creado_en, u.nombre AS usuario FROM bitacora b LEFT JOIN usuarios u ON u.id = b.usuario_id
             WHERE b.empresa_id = $1 AND b.entidad = 'integracion' AND b.detalle->>'tipo' = $2 ORDER BY b.id DESC LIMIT 6`, [empresaId, tipo]);
}

r.get('/backoffice/clientes/:id', ...base, async (req, res) => {
  const e = await empresaDe(req.params.id);
  const [plan, uso, planes] = await Promise.all([planDeEmpresa(e.id), usoDeEmpresa(e.id), q('SELECT * FROM planes ORDER BY orden, codigo')]);
  const integraciones = [];
  for (const tipo of [...tiposDe('siguelo'), ...tiposDe('cliente')]) {
    const v = await leer(e.id, tipo);
    integraciones.push({ ...(await leerPublica(e.id, tipo)), salud: salud(tipo, v), historial: await historialIntegracion(e.id, tipo) });
  }
  const usuarios = await q(`SELECT u.id, u.nombre, u.correo, u.rol, u.activo, u.ultimo_acceso, u.creado_en, u.telefono, (u.clave_hash IS NULL) AS sin_clave,
      (u.invitacion_hash IS NOT NULL AND u.invitacion_vence > now()) AS invitacion_vigente, u.invitacion_vence, s.nombre AS sucursal
    FROM usuarios u LEFT JOIN sucursales s ON s.id = u.sucursal_id WHERE u.empresa_id = $1 ORDER BY u.activo DESC, u.rol = 'administrador' DESC, u.nombre`, [e.id]);
  const entradas = await q(`SELECT en.id, en.modo, en.motivo, en.inicio, en.fin, u.nombre AS usuario,
      (SELECT count(*)::int FROM bitacora b WHERE b.empresa_id = en.empresa_id AND b.usuario_id = en.usuario_id AND b.creado_en >= en.inicio AND b.creado_en <= COALESCE(en.fin, now()) AND b.accion NOT LIKE 'siguelo_%') AS cambios
    FROM entradas_siguelo en JOIN usuarios u ON u.id = en.usuario_id WHERE en.empresa_id = $1 ORDER BY en.inicio DESC LIMIT 10`, [e.id]);
  const solicitudes = await q('SELECT * FROM solicitudes_siguelo WHERE empresa_id = $1 ORDER BY id DESC LIMIT 20', [e.id]);
  const { logo_clave: _l, ...empresa } = e;
  res.json({
    empresa: { ...empresa, tiene_logo: !!e.logo_clave }, plan: plan ? { codigo: plan.codigo, nombre: plan.nombre, modulos: plan.modulos, max_vehiculos: plan.max_vehiculos, max_usuarios: plan.max_usuarios, max_sucursales: plan.max_sucursales, precio_uf: plan.precio_uf } : null,
    planes, modulos: MODULOS_PLAN, uso, integraciones, enlaces: await enlacesDe(e.id), piezas: Object.fromEntries(Object.entries(PIEZAS).map(([k, p]) => [k, p.nombre])),
    usuarios: usuarios.map((u) => ({ ...u, rol_nombre: ROLES[u.rol] })), entradas, solicitudes,
    puede_operar: puedeOperar(req.usuario), dias_exportar: DIAS_EXPORTAR
  });
});

r.patch('/backoffice/clientes/:id', ...base, cambia, async (req, res) => {
  const e = await empresaDe(req.params.id);
  const b = req.body || {};
  if (b.rut && !validarRut(b.rut)) throw new ErrorHttp(400, 'El RUT no es válido', { campo: 'rut' });
  const campos = ['nombre', 'razon_social', 'rut', 'giro', 'direccion', 'comuna', 'ciudad', 'telefono', 'correo'];
  const sets = [], vals = [e.id];
  for (const c of campos) if (c in b) { vals.push(c === 'rut' ? (b.rut ? normalizarRut(b.rut) : null) : texto(b[c], 200)); sets.push(`${c} = $${vals.length}`); }
  if (!sets.length) throw new ErrorHttp(400, 'Nada que cambiar');
  if ('nombre' in b && !texto(b.nombre)) throw new ErrorHttp(400, 'El nombre no puede quedar vacío', { campo: 'nombre' });
  const [n] = await q(`UPDATE empresas SET ${sets.join(', ')} WHERE id = $1 RETURNING id, nombre`, vals);
  await bit(req, e.id, 'cliente_datos_editados', { campos: Object.keys(b).filter((k) => campos.includes(k)) });
  res.json(n);
});

// ── Plan y módulos ──
r.put('/backoffice/clientes/:id/plan', ...base, cambia, async (req, res) => {
  const e = await empresaDe(req.params.id);
  const b = req.body || {};
  const plan = texto(b.plan, 30);
  if (!plan || !(await uno('SELECT 1 AS ok FROM planes WHERE codigo = $1', [plan]))) throw new ErrorHttp(400, 'Plan no válido');
  const extras = (Array.isArray(b.modulos_extra) ? b.modulos_extra : e.modulos_extra || []).filter((m) => MODULOS_PLAN[m]);
  await q('UPDATE empresas SET plan = $2, modulos_extra = $3 WHERE id = $1', [e.id, plan, extras]);
  limpiarCachePlanes();
  await bit(req, e.id, 'cliente_plan', { antes: e.plan, plan, modulos_extra: extras });
  res.json({ ok: true, plan, modulos_extra: extras });
});

// ── Marcha blanca (solo Síguelo) ──
r.post('/backoffice/clientes/:id/marcha-blanca', ...base, cambia, async (req, res) => {
  const e = await empresaDe(req.params.id);
  const activa = !!req.body?.activa;
  if (e.estado === 'baja') throw new ErrorHttp(409, 'El cliente está dado de baja');
  await q('UPDATE empresas SET marcha_blanca = $2, marcha_blanca_en = now(), marcha_blanca_por = $3 WHERE id = $1', [e.id, activa, req.usuario.id]);
  limpiarCache();
  await bit(req, e.id, activa ? 'marcha_blanca_activada' : 'marcha_blanca_desactivada', { motivo: texto(req.body?.motivo, 300) });
  res.json({ ok: true, marcha_blanca: activa });
});

// ── Estado: suspender, reactivar, dar de baja ──
async function avisarAdmins(e, asunto, texto_) {
  const admins = await q(`SELECT correo FROM usuarios WHERE empresa_id = $1 AND rol = 'administrador' AND activo`, [e.id]);
  if (!admins.length) return { ok: false, motivo: 'El cliente no tiene administradores activos' };
  return enviarCorreoSiguelo({ para: admins.map((a) => a.correo), asunto, texto: texto_ });
}
const cerrarSesionesCliente = (id) => q(`DELETE FROM sesiones WHERE usuario_id IN (SELECT id FROM usuarios WHERE empresa_id = $1)`, [id]);

r.post('/backoffice/clientes/:id/suspender', ...base, cambia, async (req, res) => {
  const e = await empresaDe(req.params.id);
  const b = req.body || {};
  if (e.estado !== 'activo') throw new ErrorHttp(409, 'El cliente no está activo');
  const motivo = texto(b.motivo, 120);
  if (!motivo) throw new ErrorHttp(400, 'Elige el motivo', { campo: 'motivo' });
  if (!mismoNombre(b.confirmacion, e.nombre)) throw new ErrorHttp(400, 'Para confirmar, escribe el nombre del cliente tal como aparece', { campo: 'confirmacion' });
  await q(`UPDATE empresas SET estado = 'suspendido', activa = false, estado_motivo = $2, estado_detalle = $3, estado_en = now(), estado_por = $4 WHERE id = $1`, [e.id, motivo, texto(b.detalle, 1000), req.usuario.id]);
  await cerrarSesionesCliente(e.id);
  limpiarCache();
  const aviso = b.avisar ? await avisarAdmins(e, `Síguelo On Rent · servicio suspendido`, `El servicio de Síguelo On Rent de ${e.nombre} quedó suspendido (motivo: ${motivo}). Sus datos se conservan. Para reactivarlo, escribe a soporte@siguelogps.cl.`) : null;
  await bit(req, e.id, 'cliente_suspendido', { motivo, detalle: texto(b.detalle, 1000), aviso: aviso ? (aviso.ok ? 'enviado' : aviso.motivo) : 'sin aviso' });
  res.json({ ok: true, estado: 'suspendido', aviso });
});

r.post('/backoffice/clientes/:id/reactivar', ...base, cambia, async (req, res) => {
  const e = await empresaDe(req.params.id);
  if (e.estado !== 'suspendido') throw new ErrorHttp(409, e.estado === 'baja' ? 'Un cliente dado de baja no se reactiva: crea un alta nueva.' : 'El cliente ya está activo');
  const motivo = texto(req.body?.motivo, 300);
  if (!motivo) throw new ErrorHttp(400, 'Escribe el motivo de la reactivación', { campo: 'motivo' });
  await q(`UPDATE empresas SET estado = 'activo', activa = true, estado_motivo = $2, estado_detalle = NULL, estado_en = now(), estado_por = $3 WHERE id = $1`, [e.id, motivo, req.usuario.id]);
  limpiarCache();
  await bit(req, e.id, 'cliente_reactivado', { motivo });
  res.json({ ok: true, estado: 'activo' });
});

r.post('/backoffice/clientes/:id/baja', ...base, cambia, async (req, res) => {
  const e = await empresaDe(req.params.id);
  const b = req.body || {};
  if (e.estado === 'baja') throw new ErrorHttp(409, 'El cliente ya está dado de baja');
  const motivo = texto(b.motivo, 120);
  if (!motivo) throw new ErrorHttp(400, 'Elige el motivo', { campo: 'motivo' });
  if (!mismoNombre(b.confirmacion, e.nombre)) throw new ErrorHttp(400, 'Para confirmar, escribe el nombre del cliente tal como aparece', { campo: 'confirmacion' });
  const [x] = await q(`UPDATE empresas SET estado = 'baja', activa = false, estado_motivo = $2, estado_detalle = $3, estado_en = now(), estado_por = $4,
      exportar_hasta = ((now() AT TIME ZONE 'America/Santiago')::date + ${DIAS_EXPORTAR}) WHERE id = $1 RETURNING exportar_hasta`, [e.id, motivo, texto(b.detalle, 1000), req.usuario.id]);
  await desconectarTodo(e.id);
  await q('UPDATE enlaces_carga SET anulado_en = now() WHERE empresa_id = $1 AND usado_en IS NULL AND anulado_en IS NULL', [e.id]);
  limpiarCache();
  const aviso = b.avisar ? await avisarAdmins(e, 'Síguelo On Rent · fin del servicio', `El servicio de Síguelo On Rent de ${e.nombre} terminó. Hasta el ${String(x.exportar_hasta).split('-').reverse().join('-')} puedes entrar a revisar y exportar tus datos (Reportes). Después se eliminan o anonimizan.`) : null;
  await bit(req, e.id, 'cliente_baja', { motivo, detalle: texto(b.detalle, 1000), exportar_hasta: x.exportar_hasta, aviso: aviso ? (aviso.ok ? 'enviado' : aviso.motivo) : 'sin aviso' });
  res.json({ ok: true, estado: 'baja', exportar_hasta: x.exportar_hasta, aviso });
});

// ── Integraciones del cliente (solo las que administra Síguelo) ──
function tipoSiguelo(tipo) {
  if (!TIPOS[tipo] || TIPOS[tipo].administra !== 'siguelo') {
    if (TIPOS[tipo]?.administra === 'cliente') throw new ErrorHttp(403, 'Los cobros en línea los configura el cliente. Para ayudarlo, entra con «Operar».');
    throw new ErrorHttp(404, 'Integración desconocida');
  }
  return tipo;
}
async function probarYAnotar(empresaId, tipo) {
  const fn = probador(tipo);
  if (!fn) return null;
  try { const mensaje = await fn((await leer(empresaId, tipo)).config, empresaId); await registrarPrueba(empresaId, tipo, `ok: ${mensaje}`); return { ok: true, mensaje }; }
  catch (x) { await registrarPrueba(empresaId, tipo, `error: ${x.message}`); return { ok: false, mensaje: x.message }; }
}
const integracionFicha = async (empresaId, tipo) => ({ ...(await leerPublica(empresaId, tipo)), salud: salud(tipo, await leer(empresaId, tipo)), historial: await historialIntegracion(empresaId, tipo) });

r.put('/backoffice/clientes/:id/integraciones/:tipo', ...base, cambia, async (req, res) => {
  const e = await empresaDe(req.params.id);
  const tipo = tipoSiguelo(req.params.tipo);
  const cambios = { ...(req.body || {}) };
  if (tipo === 'gps') delete cambios.token; // el token solo entra por el ingreso con usuario y clave (o «pegar a mano», abajo)
  await guardar(e.id, tipo, cambios, req.usuario.id);
  await registrar({ usuario: req.usuario, empresaId: e.id, ip: req.ip }, 'integracion_configurada', 'integracion', null, { tipo, por: req.usuario.nombre, siguelo: { modo: 'backoffice' } });
  res.json(await integracionFicha(e.id, tipo));
});

r.post('/backoffice/clientes/:id/integraciones/:tipo/activar', ...base, cambia, async (req, res) => {
  const e = await empresaDe(req.params.id);
  const tipo = tipoSiguelo(req.params.tipo);
  await activar(e.id, tipo, !!req.body?.activa, req.usuario.id);
  await registrar({ usuario: req.usuario, empresaId: e.id, ip: req.ip }, req.body?.activa ? 'integracion_activada' : 'integracion_desactivada', 'integracion', null, { tipo, por: req.usuario.nombre, siguelo: { modo: 'backoffice' } });
  res.json(await integracionFicha(e.id, tipo));
});

r.post('/backoffice/clientes/:id/integraciones/:tipo/probar', ...base, async (req, res) => {
  const e = await empresaDe(req.params.id);
  const tipo = req.params.tipo;
  if (!TIPOS[tipo] || TIPOS[tipo].administra === 'general') throw new ErrorHttp(404, 'Integración desconocida');
  const p = await probarYAnotar(e.id, tipo);
  if (!p) throw new ErrorHttp(400, 'Esta integración no tiene prueba de conexión');
  res.json(p);
});

r.post('/backoffice/clientes/:id/integraciones/:tipo/desconectar', ...base, cambia, async (req, res) => {
  const e = await empresaDe(req.params.id);
  const tipo = tipoSiguelo(req.params.tipo);
  const secretos = Object.fromEntries(TIPOS[tipo].campos.filter((f) => f.secreto).map((f) => [f.clave, '']));
  await guardar(e.id, tipo, { ...secretos, ...(tipo === 'gps' ? { usuario: '' } : {}) }, req.usuario.id);
  await activar(e.id, tipo, false, req.usuario.id);
  await registrar({ usuario: req.usuario, empresaId: e.id, ip: req.ip }, 'integracion_desconectada', 'integracion', null, { tipo, por: req.usuario.nombre, siguelo: { modo: 'backoffice' } });
  res.json(await integracionFicha(e.id, tipo));
});

// Plataforma GPS: «Ingresar con usuario y clave» en nombre del cliente. La vuelta trae un «estado» de un solo uso que dice a
// qué cliente va el token (la empresa nunca viaja escrita en la dirección ni en el cuerpo).
r.get('/backoffice/clientes/:id/integraciones/gps/ingreso', ...base, cambia, async (req, res) => {
  const e = await empresaDe(req.params.id);
  const cuenta = req.query.cuenta === 'lite' ? 'lite' : 'hosting';
  const estado = tokenAleatorio(18);
  await q(`DELETE FROM gps_ingresos WHERE vence_en < now()`);
  await q(`INSERT INTO gps_ingresos (estado_hash, empresa_id, usuario_id, cuenta, vence_en) VALUES ($1,$2,$3,$4, now() + interval '20 minutes')`, [hashSha256(estado), e.id, req.usuario.id, cuenta]);
  const p = new URLSearchParams({ client_id: 'SigueloRentacar', access_type: '-1', activation_time: '0', duration: '0', flags: '0x1', lang: 'es',
    redirect_uri: `${config.urlBase}/integracion-gps?gps=${cuenta}&estado=${estado}` });
  res.json({ url: `${HOST_SESION_GPS[cuenta]}/login.html?${p}`, cuenta });
});

async function guardarTokenGps(req, empresaId, { token, cuenta, usuario }) {
  token = String(token || '').trim();
  if (!/^[A-Za-z0-9]{20,200}$/.test(token)) throw new ErrorHttp(400, 'La plataforma GPS no devolvió un token válido. Vuelve a intentarlo.');
  cuenta = cuenta === 'lite' ? 'lite' : 'hosting';
  await guardar(empresaId, 'gps', { token, cuenta, usuario: String(usuario || '').slice(0, 120) }, req.usuario.id);
  await registrar({ usuario: req.usuario, empresaId, ip: req.ip }, 'integracion_gps_conectada', 'integracion', null, { tipo: 'gps', cuenta, usuario: usuario || null, por: req.usuario.nombre, siguelo: { modo: 'backoffice' } });
  return { integracion: await integracionFicha(empresaId, 'gps'), prueba: await probarYAnotar(empresaId, 'gps') };
}

// Vuelta del ingreso (página /integracion-gps): el estado decide el cliente y debe ser de quien lo pidió.
r.post('/backoffice/integraciones/gps/token', ...base, cambia, async (req, res) => {
  const b = req.body || {};
  const [ing] = await q(`DELETE FROM gps_ingresos WHERE estado_hash = $1 AND usuario_id = $2 AND vence_en > now() RETURNING empresa_id, cuenta`, [hashSha256(String(b.estado || '')), req.usuario.id]);
  if (!ing) throw new ErrorHttp(400, 'Este ingreso venció o ya se usó. Vuelve a abrir «Ingresar con usuario y clave» desde la ficha del cliente.');
  const r2 = await guardarTokenGps(req, ing.empresa_id, { token: b.token, cuenta: ing.cuenta, usuario: b.usuario });
  res.json({ ...r2, empresa_id: ing.empresa_id });
});
// Token pegado a mano (soporte)
r.post('/backoffice/clientes/:id/integraciones/gps/token', ...base, cambia, async (req, res) => {
  const e = await empresaDe(req.params.id);
  res.json(await guardarTokenGps(req, e.id, { token: req.body?.token, cuenta: req.body?.cuenta, usuario: 'token de soporte' }));
});

// Enlace de carga del certificado y los CAF
r.post('/backoffice/clientes/:id/enlace-carga', ...base, cambia, async (req, res) => {
  const e = await empresaDe(req.params.id);
  if (e.estado !== 'activo') throw new ErrorHttp(409, 'El cliente no está activo');
  const x = await crearEnlace({ empresaId: e.id, piezas: req.body?.piezas, correo: req.body?.correo, usuarioId: req.usuario.id });
  await bit(req, e.id, 'enlace_carga_enviado', { piezas: x.piezas, correo: req.body?.correo, enviado: x.enviado });
  res.json(x);
});

// ── Usuarios del cliente ──
r.post('/backoffice/clientes/:id/usuarios', ...base, cambia, async (req, res) => {
  const e = await empresaDe(req.params.id);
  const b = req.body || {};
  const correo = String(b.correo || '').trim().toLowerCase();
  if (!texto(b.nombre)) throw new ErrorHttp(400, 'Escribe el nombre', { campo: 'nombre' });
  if (!correoValido(correo)) throw new ErrorHttp(400, 'El correo no es válido', { campo: 'correo' });
  if (await uno('SELECT 1 AS ok FROM usuarios WHERE lower(correo) = $1', [correo])) throw new ErrorHttp(409, 'Ese correo ya tiene un usuario', { campo: 'correo' });
  const rol = ['administrador', 'counter', 'patio', 'finanzas'].includes(b.rol) ? b.rol : 'administrador';
  const suc = await uno('SELECT id FROM sucursales WHERE empresa_id = $1 AND activa ORDER BY id LIMIT 1', [e.id]);
  const [u] = await q('INSERT INTO usuarios (empresa_id, nombre, correo, clave_hash, rol, sucursal_id, telefono) VALUES ($1,$2,$3,NULL,$4,$5,$6) RETURNING id, nombre, correo, rol', [e.id, texto(b.nombre, 100), correo, rol, suc?.id || null, texto(b.telefono, 30)]);
  const inv = await invitar(u.id);
  await registrar({ usuario: req.usuario, empresaId: e.id, ip: req.ip }, 'usuario_creado', 'usuario', u.id, { correo, rol, por: req.usuario.nombre, invitacion: true, siguelo: { modo: 'backoffice' } });
  res.json({ usuario: u, invitacion: inv });
});

r.post('/backoffice/clientes/:id/usuarios/:uid/invitacion', ...base, cambia, async (req, res) => {
  const e = await empresaDe(req.params.id);
  const u = await uno('SELECT id, correo FROM usuarios WHERE id = $1 AND empresa_id = $2 AND activo', [Number(req.params.uid), e.id]);
  if (!u) throw new ErrorHttp(404, 'Usuario no encontrado');
  const inv = await invitar(u.id);
  await registrar({ usuario: req.usuario, empresaId: e.id, ip: req.ip }, 'invitacion_reenviada', 'usuario', u.id, { correo: u.correo, por: req.usuario.nombre, siguelo: { modo: 'backoffice' } });
  res.json(inv);
});

r.patch('/backoffice/clientes/:id/usuarios/:uid', ...base, cambia, async (req, res) => {
  const e = await empresaDe(req.params.id);
  const u = await uno('SELECT * FROM usuarios WHERE id = $1 AND empresa_id = $2', [Number(req.params.uid), e.id]);
  if (!u) throw new ErrorHttp(404, 'Usuario no encontrado');
  if (!('activo' in (req.body || {}))) throw new ErrorHttp(400, 'Nada que cambiar');
  const activo = !!req.body.activo;
  if (!activo && u.rol === 'administrador') {
    const [n] = await q(`SELECT count(*)::int AS n FROM usuarios WHERE empresa_id = $1 AND rol = 'administrador' AND activo AND id <> $2`, [e.id, u.id]);
    if (!n.n) throw new ErrorHttp(400, 'Debe quedar al menos un administrador activo.');
  }
  await q('UPDATE usuarios SET activo = $2 WHERE id = $1', [u.id, activo]);
  if (!activo) await q('DELETE FROM sesiones WHERE usuario_id = $1', [u.id]);
  await registrar({ usuario: req.usuario, empresaId: e.id, ip: req.ip }, 'usuario_editado', 'usuario', u.id, { activo, por: req.usuario.nombre, siguelo: { modo: 'backoffice' } });
  res.json({ ok: true });
});

r.post('/backoffice/clientes/:id/usuarios/:uid/cerrar-sesiones', ...base, cambia, async (req, res) => {
  const e = await empresaDe(req.params.id);
  const u = await uno('SELECT id FROM usuarios WHERE id = $1 AND empresa_id = $2', [Number(req.params.uid), e.id]);
  if (!u) throw new ErrorHttp(404, 'Usuario no encontrado');
  await q('DELETE FROM sesiones WHERE usuario_id = $1', [u.id]);
  await registrar({ usuario: req.usuario, empresaId: e.id, ip: req.ip }, 'sesiones_cerradas', 'usuario', u.id, { por: req.usuario.nombre, siguelo: { modo: 'backoffice' } });
  res.json({ ok: true });
});

// ── Entrar a la cuenta del cliente ──
r.post('/backoffice/clientes/:id/entrar', ...base, async (req, res) => {
  await entrarComoSiguelo(req, Number(req.params.id), req.body?.modo, req.body?.motivo);
  res.json({ ok: true, destino: '/inicio' });
});

// ── Actividad y bitácora del cliente ──
r.get('/backoffice/clientes/:id/bitacora', ...base, async (req, res) => {
  const e = await empresaDe(req.params.id);
  const pagina = Math.max(1, Number(req.query.pagina) || 1);
  const soloSiguelo_ = req.query.siguelo === '1';
  const filas = await q(`SELECT b.id, b.accion, b.entidad, b.entidad_id, b.detalle, b.creado_en, u.nombre AS usuario, u.rol FROM bitacora b LEFT JOIN usuarios u ON u.id = b.usuario_id
    WHERE b.empresa_id = $1 ${soloSiguelo_ ? `AND u.rol IN ('superadmin','soporte')` : ''} ORDER BY b.id DESC LIMIT 50 OFFSET ${(pagina - 1) * 50}`, [e.id]);
  res.json({ filas, pagina });
});

// ── Solicitudes ──
r.get('/backoffice/solicitudes', ...base, async (req, res) => {
  const estado = ['pendiente', 'en_curso', 'resuelta', 'descartada'].includes(req.query.estado) ? req.query.estado : null;
  const filas = await q(`SELECT s.*, e.nombre AS empresa, e.rut, u.nombre AS resuelta_por_nombre FROM solicitudes_siguelo s JOIN empresas e ON e.id = s.empresa_id LEFT JOIN usuarios u ON u.id = s.resuelta_por
    WHERE ($1::text IS NULL OR s.estado = $1) ORDER BY (s.estado IN ('pendiente','en_curso')) DESC, s.id DESC LIMIT 200`, [estado]);
  res.json({ solicitudes: filas, tipos: TIPOS_SOLICITUD });
});

r.patch('/backoffice/solicitudes/:id', ...base, cambia, async (req, res) => {
  const b = req.body || {};
  if (!['pendiente', 'en_curso', 'resuelta', 'descartada'].includes(b.estado)) throw new ErrorHttp(400, 'Estado no válido');
  const cierra = ['resuelta', 'descartada'].includes(b.estado);
  const [s] = await q(`UPDATE solicitudes_siguelo SET estado = $2, nota = COALESCE($3, nota), resuelta_por = CASE WHEN $4 THEN $5::bigint ELSE NULL END, resuelta_en = CASE WHEN $4 THEN now() ELSE NULL END
    WHERE id = $1 RETURNING *`, [Number(req.params.id), b.estado, texto(b.nota, 1000), cierra, req.usuario.id]);
  if (!s) throw new ErrorHttp(404, 'Solicitud no encontrada');
  await registrar({ usuario: req.usuario, empresaId: s.empresa_id, ip: req.ip }, 'solicitud_siguelo_actualizada', 'solicitud', s.id, { tipo: s.tipo, estado: s.estado, nota: s.nota, por: req.usuario.nombre, siguelo: { modo: 'backoffice' } });
  res.json(s);
});

r.post('/backoffice/solicitudes/reintentar-crm', ...base, cambia, async (_req, res) => res.json({ reintentadas: await reintentarCrm() }));

// ── Conexiones generales ──
r.get('/backoffice/conexiones', ...base, async (_req, res) => {
  const lista = [];
  for (const tipo of Object.keys(GENERALES)) lista.push(await leerGeneralPublica(tipo));
  const propios = await q(`SELECT e.id, e.nombre FROM integraciones i JOIN empresas e ON e.id = i.empresa_id WHERE i.tipo = 'almacenamiento' AND i.config_cifrada IS NOT NULL ORDER BY e.nombre`);
  res.json({ conexiones: lista, almacenamiento_propio: propios, push: await configuracionPush().catch(() => ({ configurado: false })), herramienta: HERRAMIENTA });
});

r.put('/backoffice/conexiones/:tipo', ...base, soloSuperadmin, async (req, res) => {
  if (!GENERALES[req.params.tipo]) throw new ErrorHttp(404, 'Conexión desconocida');
  const b = req.body || {};
  if (req.params.tipo === 'crm' && b.url && !/^https:\/\/[^\s]+$/i.test(b.url) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(b.url)) throw new ErrorHttp(400, 'La dirección del CRM debe empezar con https://', { campo: 'url' });
  await guardarGeneral(req.params.tipo, b, req.usuario.id);
  await registrar(req, 'conexion_general_configurada', 'sistema', null, { tipo: req.params.tipo });
  res.json(await leerGeneralPublica(req.params.tipo));
});

r.post('/backoffice/conexiones/:tipo/probar', ...base, soloSuperadmin, async (req, res) => {
  const tipo = req.params.tipo;
  if (!GENERALES[tipo]) throw new ErrorHttp(404, 'Conexión desconocida');
  let ok = false, mensaje = '';
  try {
    const { config: c, lista } = await leerGeneral(tipo);
    if (!lista) throw new Error('Faltan datos');
    if (tipo === 'almacenamiento') {
      const { S3Client, PutObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      const s3 = new S3Client({ region: c.region || 'auto', endpoint: c.endpoint || undefined, forcePathStyle: !!c.endpoint, credentials: { accessKeyId: c.access_key, secretAccessKey: c.secret_key } });
      const k = `${c.prefijo || 'rentacar'}/_prueba/${Date.now()}.txt`;
      await s3.send(new PutObjectCommand({ Bucket: c.bucket, Key: k, Body: 'ok', ContentType: 'text/plain' }));
      await s3.send(new DeleteObjectCommand({ Bucket: c.bucket, Key: k }));
      ok = true; mensaje = `Escritura y borrado correctos en «${c.bucket}»`;
    } else if (tipo === 'correo_siguelo') {
      const r2 = await enviarCorreoSiguelo({ para: c.aviso_equipo || req.usuario.correo, asunto: 'Síguelo On Rent · prueba del correo de Síguelo', texto: 'Si recibiste esto, el correo de Síguelo funciona.' });
      if (!r2.ok) throw new Error(r2.motivo);
      ok = true; mensaje = `Correo de prueba enviado a ${c.aviso_equipo || req.usuario.correo}`;
    } else {
      // Pedido firmado con cuerpo incompleto: si el CRM acepta la firma responde 400 (falta la empresa); si no, 401.
      const cuerpo = JSON.stringify({ herramienta: HERRAMIENTA, prueba: true });
      const r2 = await fetch(`${String(c.url).replace(/\/+$/, '')}/api/integracion/solicitudes`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Siguelo-Herramienta': HERRAMIENTA, 'X-Siguelo-Firma': firmar(c.secreto, cuerpo) }, body: cuerpo, signal: AbortSignal.timeout(15000) });
      if (r2.status === 400) { ok = true; mensaje = 'El CRM acepta la firma de On Rent'; }
      else if (r2.status === 401) throw new Error('El CRM rechazó la firma: revisa el secreto');
      else if (r2.status === 503) throw new Error('El CRM todavía no tiene secreto para On Rent');
      else throw new Error(`El CRM respondió ${r2.status}`);
    }
  } catch (x) { mensaje = x.message; }
  await registrarPruebaGeneral(tipo, `${ok ? 'ok' : 'error'}: ${mensaje}`);
  res.json({ ok, mensaje });
});

// ── Bitácora global ──
r.get('/backoffice/bitacora', ...base, async (req, res) => {
  const pagina = Math.max(1, Number(req.query.pagina) || 1);
  const empresaId = req.query.empresa_id ? Number(req.query.empresa_id) : null;
  const soloEquipo = req.query.equipo === '1';
  const filas = await q(`SELECT b.id, b.accion, b.entidad, b.entidad_id, b.detalle, b.creado_en, b.empresa_id, e.nombre AS empresa, u.nombre AS usuario, u.rol
    FROM bitacora b LEFT JOIN usuarios u ON u.id = b.usuario_id LEFT JOIN empresas e ON e.id = b.empresa_id
    WHERE ($1::bigint IS NULL OR b.empresa_id = $1) AND (NOT $2 OR u.rol IN ('superadmin','soporte'))
    ORDER BY b.id DESC LIMIT 100 OFFSET ${(pagina - 1) * 100}`, [empresaId, soloEquipo]);
  res.json({ filas, pagina });
});

// Tareas: reintento de tickets al CRM y anonimización de bajas vencidas.
registrarTarea('solicitudes_crm', 10 * 60e3, reintentarCrm);
registrarTarea('bajas', 6 * 3600e3, procesarBajasVencidas);

export default r;
