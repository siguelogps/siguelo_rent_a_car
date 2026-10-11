// Configuración › Integraciones: un apartado único para conectar y activar/desactivar cada integración.
// Ver y probar: quien tenga «integraciones: ver». Cambiar datos o activar: solo «integraciones: editar» (administradores).
import express from 'express';
import { q } from '../db.js';
import { requiere, ErrorHttp } from '../auth.js';
import { TIPOS, leerPublica, guardar, activar, leer, registrarPrueba, marchaBlanca } from '../integraciones/index.js';
import { probador } from '../integraciones/probadores.js';
import { procesar } from '../salidas.js';
import { registrar } from '../bitacora.js';

const r = express.Router();

r.get('/integraciones', requiere('integraciones', 'ver'), async (req, res) => {
  const lista = [];
  for (const tipo of Object.keys(TIPOS)) lista.push(await leerPublica(req.empresaId, tipo));
  res.json({ marcha_blanca: await marchaBlanca(req.empresaId), integraciones: lista });
});

r.put('/integraciones/:tipo', requiere('integraciones', 'editar'), async (req, res) => {
  if (!TIPOS[req.params.tipo]) throw new ErrorHttp(404, 'Integración desconocida');
  await guardar(req.empresaId, req.params.tipo, req.body || {}, req.usuario.id);
  await registrar(req, 'integracion_configurada', 'integracion', null, { tipo: req.params.tipo });
  res.json(await leerPublica(req.empresaId, req.params.tipo));
});

r.post('/integraciones/:tipo/activar', requiere('integraciones', 'editar'), async (req, res) => {
  if (!TIPOS[req.params.tipo]) throw new ErrorHttp(404, 'Integración desconocida');
  await activar(req.empresaId, req.params.tipo, !!req.body.activa, req.usuario.id);
  await registrar(req, req.body.activa ? 'integracion_activada' : 'integracion_desactivada', 'integracion', null, { tipo: req.params.tipo });
  res.json(await leerPublica(req.empresaId, req.params.tipo));
});

r.post('/integraciones/:tipo/probar', requiere('integraciones', 'ver'), async (req, res) => {
  const fn = probador(req.params.tipo);
  if (!fn) throw new ErrorHttp(400, 'Esta integración no tiene prueba de conexión');
  const { config } = await leer(req.empresaId, req.params.tipo);
  try {
    const mensaje = await fn(config, req.empresaId);
    await registrarPrueba(req.empresaId, req.params.tipo, `ok: ${mensaje}`);
    res.json({ ok: true, mensaje });
  } catch (e) {
    await registrarPrueba(req.empresaId, req.params.tipo, `error: ${e.message}`);
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
