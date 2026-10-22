// Configuración › Conexiones (vista del cliente). 22-oct (Pablo, espec. Backoffice Síguelo):
//   · Las conexiones gestionadas por Síguelo (plataforma GPS, Síguelo OS, facturación, WhatsApp, correo, avisos) se ven en
//     tarjetas de solo lectura, sin secretos, con «Solicitar a Síguelo». Se configuran solo en el backoffice.
//   · 22-oct, más tarde (Pablo): la plataforma GPS la conecta el propio cliente aquí, con el ingreso con usuario y clave
//     (Síguelo Pro / Síguelo Lite). Puede su administrador y el equipo Síguelo con «Operar»; «Ver como» y los demás roles,
//     no. Desconectarla y pegar un token a mano siguen siendo solo de Síguelo, en el backoffice.
//   · Excepción: los cobros en línea (Transbank y Mercado Pago) los sigue configurando el administrador del cliente, porque
//     el dinero va a su cuenta. Síguelo lo ayuda entrando con «Operar».
import express from 'express';
import { q } from '../db.js';
import { requiere, ErrorHttp } from '../auth.js';
import { TIPOS, leerPublica, guardar, activar, leer, registrarPrueba, marchaBlanca, tiposDe } from '../integraciones/index.js';
import { probador } from '../integraciones/probadores.js';
import { procesar } from '../salidas.js';
import { registrar } from '../bitacora.js';
import { tarjetasCliente } from '../siguelo/tarjetas.js';
import { puede } from '../permisos.js';
import { incluye } from '../planes.js';
import { crearIngreso, consumirIngreso, tokenValido } from '../gps/ingreso.js';

const r = express.Router();

// Solo los tipos que administra el cliente pasan por estas rutas.
function tipoDelCliente(tipo) {
  if (!TIPOS[tipo] || TIPOS[tipo].administra === 'general') throw new ErrorHttp(404, 'Integración desconocida');
  if (TIPOS[tipo].administra !== 'cliente') throw new ErrorHttp(403, `«${TIPOS[tipo].nombreCliente || TIPOS[tipo].nombre}» la configura el equipo Síguelo GPS. Pídela o pide un cambio con «Solicitar a Síguelo».`, { gestionado: true });
  return tipo;
}

r.get('/integraciones', requiere('integraciones', 'ver'), async (req, res) => {
  const pagos = [];
  for (const tipo of tiposDe('cliente')) pagos.push(await leerPublica(req.empresaId, tipo));
  const pendientes = await q(`SELECT tipo, id, estado, creado_en FROM solicitudes_siguelo WHERE empresa_id = $1 AND estado IN ('pendiente','en_curso') ORDER BY id DESC`, [req.empresaId]);
  res.json({ marcha_blanca: await marchaBlanca(req.empresaId), gestionadas: await tarjetasCliente(req.empresaId, { puedeConectar: puedeConectarGps(req) }), integraciones: pagos, solicitudes: pendientes });
});

// ── Plataforma GPS: la conecta el cliente ──
// Quién: «integraciones: editar» (administrador del cliente; el equipo Síguelo también lo tiene) y nunca en «Ver como».
// La empresa es siempre la de la sesión.
const puedeConectarGps = (req) => puede(req.usuario.rol, 'integraciones', 'editar') && !req.verComo && !req.soloLectura;
async function exigirConectarGps(req) {
  if (req.verComo) throw new ErrorHttp(403, 'Estás en «Ver como» (solo lectura): no se puede conectar la plataforma GPS. Para hacerlo junto con el cliente, vuelve al backoffice y usa «Operar» con un motivo.', { soloLectura: true });
  if (!puedeConectarGps(req)) throw new ErrorHttp(403, 'Solo un administrador de tu empresa puede conectar la plataforma GPS.');
  if (!(await incluye(req.empresaId, 'gps'))) throw new ErrorHttp(403, 'El plan contratado no incluye la plataforma GPS. Pídela con «Solicitar a Síguelo».');
  if ((await leer(req.empresaId, 'gps')).apagada_por_siguelo) throw new ErrorHttp(403, 'Síguelo GPS dejó la plataforma GPS apagada para tu empresa. Pide encenderla con «Solicitar a Síguelo».');
}

r.get('/integraciones/gps/ingreso', requiere('integraciones', 'editar'), async (req, res) => {
  await exigirConectarGps(req);
  res.json(await crearIngreso({ empresaId: req.empresaId, usuarioId: req.usuario.id, cuenta: req.query.cuenta, origen: 'cliente' }));
});

// Vuelta del ingreso (/integracion-gps?desde=cliente): solo con el «estado» de un solo uso que creó esta misma persona en
// esta misma empresa. Sin estado no se guarda nada: pegar un token a mano es solo de soporte Síguelo, en el backoffice.
r.post('/integraciones/gps/token', requiere('integraciones', 'editar'), async (req, res) => {
  await exigirConectarGps(req);
  const b = req.body || {};
  if (!b.estado) throw new ErrorHttp(400, 'Conecta la plataforma GPS con «Ingresar con usuario y clave». Si necesitas usar un token, pídeselo a Síguelo GPS.');
  const token = tokenValido(b.token);
  const ing = await consumirIngreso({ estado: b.estado, usuarioId: req.usuario.id, origen: 'cliente', empresaId: req.empresaId });
  const usuario = String(b.usuario || '').slice(0, 120);
  await guardar(req.empresaId, 'gps', { token, cuenta: ing.cuenta, usuario }, req.usuario.id);
  // Conectada por el cliente = encendida (Síguelo no la apagó: lo revisó exigirConectarGps). Si no, quedaría «en preparación».
  if (!(await leer(req.empresaId, 'gps')).activa) await activar(req.empresaId, 'gps', true, req.usuario.id);
  await registrar(req, 'integracion_gps_conectada', 'integracion', null, { tipo: 'gps', cuenta: ing.cuenta, usuario: usuario || null, por: req.usuario.nombre });
  let prueba = null;
  const fn = probador('gps');
  if (fn) {
    try { prueba = { ok: true, mensaje: await fn((await leer(req.empresaId, 'gps')).config, req.empresaId) }; await registrarPrueba(req.empresaId, 'gps', `ok: ${prueba.mensaje}`); }
    catch (e) { prueba = { ok: false, mensaje: e.message }; await registrarPrueba(req.empresaId, 'gps', `error: ${e.message}`); }
  }
  const tarjeta = (await tarjetasCliente(req.empresaId, { puedeConectar: true })).find((t) => t.tipo === 'gps');
  res.json({ tarjeta, prueba });
});

r.put('/integraciones/:tipo', requiere('integraciones', 'editar'), async (req, res) => {
  const tipo = tipoDelCliente(req.params.tipo);
  await guardar(req.empresaId, tipo, req.body || {}, req.usuario.id);
  await registrar(req, 'integracion_configurada', 'integracion', null, { tipo });
  res.json(await leerPublica(req.empresaId, tipo));
});

r.post('/integraciones/:tipo/activar', requiere('integraciones', 'editar'), async (req, res) => {
  const tipo = tipoDelCliente(req.params.tipo);
  await activar(req.empresaId, tipo, !!req.body.activa, req.usuario.id);
  await registrar(req, req.body.activa ? 'integracion_activada' : 'integracion_desactivada', 'integracion', null, { tipo });
  res.json(await leerPublica(req.empresaId, tipo));
});

r.post('/integraciones/:tipo/probar', requiere('integraciones', 'ver'), async (req, res) => {
  const tipo = tipoDelCliente(req.params.tipo);
  const fn = probador(tipo);
  if (!fn) throw new ErrorHttp(400, 'Esta integración no tiene prueba de conexión');
  const { config } = await leer(req.empresaId, tipo);
  try {
    const mensaje = await fn(config, req.empresaId);
    await registrarPrueba(req.empresaId, tipo, `ok: ${mensaje}`);
    res.json({ ok: true, mensaje });
  } catch (e) {
    await registrarPrueba(req.empresaId, tipo, `error: ${e.message}`);
    res.json({ ok: false, mensaje: e.message });
  }
});

// Bandeja de salida (correos y WhatsApp, incluidos los retenidos por marcha blanca)
r.get('/salidas', requiere('configuracion', 'ver'), async (req, res) => {
  const estado = req.query.estado || null;
  res.json(await q(`SELECT id, canal, destino, asunto, left(cuerpo, 300) AS cuerpo, estado, error, entidad, entidad_id, creado_en, enviado_en
                      FROM salidas WHERE empresa_id = $1 AND ($2::text IS NULL OR estado = $2) ORDER BY id DESC LIMIT 300`, [req.empresaId, estado]));
});

r.post('/salidas/:id/reenviar', requiere('configuracion', 'editar'), async (req, res) => {
  const [s] = await q('SELECT * FROM salidas WHERE id = $1 AND empresa_id = $2', [req.params.id, req.empresaId]);
  if (!s) throw new ErrorHttp(404, 'Mensaje no encontrado');
  res.json(await procesar(req.empresaId, s));
});

r.post('/salidas/:id/descartar', requiere('configuracion', 'editar'), async (req, res) => {
  const [s] = await q(`UPDATE salidas SET estado = 'descartada' WHERE id = $1 AND empresa_id = $2 RETURNING id, estado`, [req.params.id, req.empresaId]);
  res.json(s);
});

export default r;
