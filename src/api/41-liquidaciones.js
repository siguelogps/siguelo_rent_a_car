// Liquidación al cierre: listado (pendientes e historial), cálculo automático, edición de cargos con motivo, aprobación y PDF.
import express from 'express';
import { requiere } from '../auth.js';
import { listar, obtener, calcular, editarLinea, agregarCargo, quitarCargo, aprobar, pdfDe } from '../liquidacion/index.js';

const r = express.Router();
const id = (req) => Number(req.params.reservaId);

r.get('/liquidaciones', requiere('liquidaciones', 'ver'), async (req, res) => {
  res.json(await listar(req.empresaId, { vista: req.query.vista === 'historial' ? 'historial' : 'pendientes', q: req.query.q || '' }));
});

r.get('/liquidaciones/:reservaId/pdf', requiere('liquidaciones', 'ver'), async (req, res) => {
  const { pdf, nombre } = await pdfDe(req.empresaId, id(req));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(nombre)}"`);
  res.end(pdf);
});

r.get('/liquidaciones/:reservaId', requiere('liquidaciones', 'ver'), async (req, res) => {
  res.json(await obtener(req.empresaId, id(req), { usuarioId: req.usuario.id }));
});

r.post('/liquidaciones/:reservaId/calcular', requiere('liquidaciones', 'editar'), async (req, res) => {
  await calcular(req.empresaId, id(req), req.usuario.id);
  res.json(await obtener(req.empresaId, id(req)));
});

r.patch('/liquidaciones/:reservaId/lineas/:codigo', requiere('liquidaciones', 'editar'), async (req, res) => {
  await editarLinea(req.empresaId, id(req), req.params.codigo, req.body || {}, req.usuario.id);
  res.json(await obtener(req.empresaId, id(req)));
});

r.post('/liquidaciones/:reservaId/lineas', requiere('liquidaciones', 'editar'), async (req, res) => {
  await agregarCargo(req.empresaId, id(req), req.body || {}, req.usuario.id);
  res.json(await obtener(req.empresaId, id(req)));
});

r.delete('/liquidaciones/:reservaId/lineas/:codigo', requiere('liquidaciones', 'editar'), async (req, res) => {
  await quitarCargo(req.empresaId, id(req), req.params.codigo, req.usuario.id);
  res.json(await obtener(req.empresaId, id(req)));
});

r.post('/liquidaciones/:reservaId/aprobar', requiere('liquidaciones', 'editar'), async (req, res) => {
  const resultado = await aprobar(req.empresaId, id(req), req.body || {}, req.usuario.id);
  res.json({ ...resultado, vista: await obtener(req.empresaId, id(req)) });
});

export default r;
