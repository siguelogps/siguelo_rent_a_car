// Configuración › Conexiones (vista del cliente). 22-oct (Pablo, espec. Backoffice Síguelo):
//   · Las conexiones gestionadas por Síguelo (plataforma GPS, Síguelo OS, facturación, WhatsApp, correo, avisos) se ven en
//     tarjetas de solo lectura, sin secretos, con «Solicitar a Síguelo». Se configuran solo en el backoffice.
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
  res.json({ marcha_blanca: await marchaBlanca(req.empresaId), gestionadas: await tarjetasCliente(req.empresaId), integraciones: pagos, solicitudes: pendientes });
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
