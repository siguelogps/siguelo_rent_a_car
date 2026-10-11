// Archivos: descarga autenticada (nunca URLs públicas del bucket) y subida genérica (data URL).
import express from 'express';
import { requiere, ErrorHttp } from '../auth.js';
import { guardarArchivo, leerArchivo, desdeDataUrl } from '../almacenamiento/index.js';
import { uno } from '../db.js';

const r = express.Router();

r.get('/archivos/:id', requiere(), async (req, res) => {
  const a = await leerArchivo(req.empresaId, Number(req.params.id));
  if (!a) throw new ErrorHttp(404, 'Archivo no encontrado');
  res.setHeader('Content-Type', a.fila.mime || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  if (req.query.descargar) res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(a.fila.nombre || 'archivo')}"`);
  res.end(a.datos);
});

r.post('/archivos', requiere(), async (req, res) => {
  const { entidad, entidad_id, tipo, nombre, dataUrl, meta } = req.body;
  if (!entidad || !dataUrl) throw new ErrorHttp(400, 'Faltan datos del archivo');
  const { mime, datos } = desdeDataUrl(dataUrl);
  const a = await guardarArchivo({ empresaId: req.empresaId, entidad, entidadId: entidad_id || null, tipo, nombre, mime, datos, meta: meta || {}, usuarioId: req.usuario.id });
  res.json(a);
});

// Logo de la empresa para documentos y el portal (público: solo el logo)
r.get('/logo/:slug', async (req, res) => {
  const e = await uno('SELECT id, logo_clave FROM empresas WHERE slug = $1', [req.params.slug]);
  if (!e?.logo_clave) throw new ErrorHttp(404, 'Sin logo');
  const a = await leerArchivo(e.id, Number(e.logo_clave));
  if (!a) throw new ErrorHttp(404, 'Sin logo');
  res.setHeader('Content-Type', a.fila.mime);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.end(a.datos);
});

export default r;
