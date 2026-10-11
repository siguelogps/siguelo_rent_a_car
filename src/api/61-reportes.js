// Reportes (/reportes): indicadores, gráficos y tablas del período; cada tabla se exporta a Excel.
// GET /api/reportes?periodo=mes&ref=2026-09-01&sucursal_id=   ·   GET /api/reportes/<tabla>.xlsx (mismos parámetros)
import express from 'express';
import { requiere, ErrorHttp } from '../auth.js';
import { uno } from '../db.js';
import { calcularReporte } from '../reportes/calculo.js';
import { libroDe, TABLAS } from '../reportes/excel.js';

const r = express.Router();

r.get('/reportes', requiere('reportes', 'ver'), async (req, res) => {
  res.json(await calcularReporte(req.empresaId, req.query));
});

r.get('/reportes/:nombre.xlsx', requiere('reportes', 'ver'), async (req, res) => {
  const nombre = req.params.nombre;
  if (nombre !== 'completo' && !TABLAS[nombre]) throw new ErrorHttp(404, 'Reporte no encontrado');
  const rep = await calcularReporte(req.empresaId, req.query);
  const e = await uno('SELECT nombre FROM empresas WHERE id = $1', [req.empresaId]);
  const buf = await libroDe(rep, nombre, e?.nombre || '');
  const archivo = `${nombre === 'completo' ? 'reportes' : nombre}-${rep.periodo.desde}-al-${rep.periodo.hasta}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${archivo}"`);
  res.end(Buffer.from(buf));
});

export default r;
