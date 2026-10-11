// Módulo 8 · Facturación electrónica: documentos tributarios (boleta 39, factura 33, nota de crédito 61) vía SimpleAPI.
import express from 'express';
import { q, uno } from '../db.js';
import { requiere, ErrorHttp } from '../auth.js';
import { emitirDocumento, procesarDocumento, consultarEstado, notaCredito, receptorDeCliente, resumenFolios } from '../facturacion/index.js';
import { TIPOS_DTE, ESTADOS_DTE, desglosar } from '../facturacion/calculo.js';
import { pdfDte } from '../facturacion/pdf.js';
import { leerArchivo } from '../almacenamiento/index.js';

const r = express.Router();

r.get('/facturacion', requiere('facturacion', 'ver'), async (req, res) => {
  const f = req.query;
  const cond = ['d.empresa_id = $1'], vals = [req.empresaId];
  const add = (sql, v) => { vals.push(v); cond.push(sql.replaceAll('?', `$${vals.length}`)); };
  if (f.tipo) add('d.tipo = ?', Number(f.tipo));
  if (f.estado) add('d.estado = ?', f.estado);
  if (f.desde) add(`d.creado_en >= (?::date)::timestamp AT TIME ZONE 'America/Santiago'`, f.desde);
  if (f.hasta) add(`d.creado_en < ((?::date + 1)::timestamp AT TIME ZONE 'America/Santiago')`, f.hasta);
  if (f.q) add(`(d.receptor->>'razonSocial' ILIKE ? OR d.receptor->>'rut' ILIKE ? OR r.folio ILIKE ? OR d.folio::text ILIKE ?)`, `%${String(f.q).trim()}%`);
  const docs = await q(`SELECT d.*, r.folio AS reserva_folio, l.folio AS liquidacion_folio, ref.folio AS ref_folio, ref.tipo AS ref_tipo, nc.folio AS nc_folio, nc.estado AS nc_estado
                          FROM documentos_tributarios d LEFT JOIN reservas r ON r.id = d.reserva_id LEFT JOIN liquidaciones l ON l.id = d.liquidacion_id
                          LEFT JOIN documentos_tributarios ref ON ref.id = d.dte_ref_id LEFT JOIN documentos_tributarios nc ON nc.id = d.anulado_por
                         WHERE ${cond.join(' AND ')} ORDER BY d.creado_en DESC, d.id DESC LIMIT 500`, vals);
  const validos = docs.filter((d) => ['emitido', 'aceptado', 'reparos'].includes(d.estado));
  const totales = {
    emitido: validos.filter((d) => d.tipo !== 61).reduce((s, d) => s + d.total, 0) - validos.filter((d) => d.tipo === 61).reduce((s, d) => s + d.total, 0),
    boletas: validos.filter((d) => d.tipo === 39).length, facturas: validos.filter((d) => d.tipo === 33).length, notas: validos.filter((d) => d.tipo === 61).length,
    retenidos: docs.filter((d) => d.estado === 'retenido').length, retenido_monto: docs.filter((d) => d.estado === 'retenido').reduce((s, d) => s + d.total, 0),
    errores: docs.filter((d) => ['error', 'rechazado'].includes(d.estado)).length
  };
  res.json({ documentos: docs, totales, tipos: TIPOS_DTE, estados: ESTADOS_DTE });
});

// Buscador de reservas para emitir (folio, cliente, RUT, patente)
r.get('/facturacion/reservas', requiere('facturacion', 'ver'), async (req, res) => {
  const t = `%${String(req.query.q || '').trim().replace(/[-\s]/g, '%')}%`;
  res.json(await q(`SELECT r.id, r.folio, r.estado, r.total, r.inicio, r.fin, v.patente, trim(coalesce(c.nombre,'') || ' ' || coalesce(c.apellidos,'')) AS cliente,
        coalesce((SELECT sum(d.total) FROM documentos_tributarios d WHERE d.reserva_id = r.id AND d.tipo IN (33,39) AND d.anulado_por IS NULL AND d.estado NOT IN ('rechazado')), 0) AS pagado
      FROM reservas r LEFT JOIN clientes c ON c.id = r.cliente_id LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
     WHERE r.empresa_id = $1 AND r.estado IN ('confirmada','en_curso','devuelta','cerrada')
       AND ($2 = '%%' OR r.folio ILIKE $2 OR (c.nombre || ' ' || coalesce(c.apellidos,'')) ILIKE $2 OR v.patente ILIKE $2 OR c.documento ILIKE $2)
     ORDER BY r.inicio DESC LIMIT 20`, [req.empresaId, t]));
});

r.get('/facturacion/folios',requiere('facturacion', 'ver'), async (req, res) => res.json(await resumenFolios(req.empresaId)));

// Datos para emitir desde una reserva: receptor sugerido y montos (liquidación o arriendo)
r.get('/facturacion/desde-reserva/:reservaId', requiere('facturacion', 'ver'), async (req, res) => {
  const rv = await uno(`SELECT r.id, r.folio, r.total, r.cotizacion, row_to_json(c.*) AS cliente FROM reservas r LEFT JOIN clientes c ON c.id = r.cliente_id WHERE r.id = $1 AND r.empresa_id = $2`, [req.params.reservaId, req.empresaId]);
  if (!rv) throw new ErrorHttp(404, 'Reserva no encontrada');
  const lq = await uno('SELECT id, folio, estado, lineas, total_cargos FROM liquidaciones WHERE reserva_id = $1 AND empresa_id = $2', [rv.id, req.empresaId]);
  const arriendo = (rv.cotizacion?.lineas || []).map((l) => ({ nombre: l.concepto, descripcion: l.detalle || '', monto: l.monto }));
  const descuento = arriendo.filter((l) => l.monto < 0).reduce((s, l) => s + l.monto, 0);
  const lineasArriendo = arriendo.filter((l) => l.monto > 0);
  if (descuento && lineasArriendo.length) lineasArriendo[0] = { ...lineasArriendo[0], monto: lineasArriendo[0].monto + descuento, descripcion: `${lineasArriendo[0].descripcion} · con descuento` };
  const emitidos = await q(`SELECT id, tipo, folio, estado, total, liquidacion_id FROM documentos_tributarios WHERE reserva_id = $1 AND empresa_id = $2 AND estado NOT IN ('rechazado') AND anulado_por IS NULL ORDER BY id`, [rv.id, req.empresaId]);
  res.json({
    reserva: { id: rv.id, folio: rv.folio, total: rv.total },
    receptor_boleta: receptorDeCliente(rv.cliente, 39), receptor_factura: receptorDeCliente(rv.cliente, 33), cliente_tipo: rv.cliente?.tipo,
    lineas_arriendo: lineasArriendo,
    lineas_liquidacion: lq ? lq.lineas.filter((l) => l.incluir && l.monto > 0).map((l) => ({ nombre: l.concepto, descripcion: l.calculo, monto: l.monto })) : [],
    liquidacion: lq ? { id: lq.id, folio: lq.folio, estado: lq.estado, total: lq.total_cargos } : null,
    emitidos
  });
});

r.post('/facturacion/calcular', requiere('facturacion', 'ver'), (req, res) => res.json(desglosar(req.body?.total)));

r.post('/facturacion', requiere('facturacion', 'editar'), async (req, res) => {
  const b = req.body || {};
  const tipo = Number(b.tipo);
  if (![33, 39].includes(tipo)) throw new ErrorHttp(400, 'Elige boleta o factura (la nota de crédito se emite desde el documento)');
  let liquidacionId = null;
  if (b.liquidacion_id) {
    const l = await uno('SELECT id FROM liquidaciones WHERE id = $1 AND empresa_id = $2', [b.liquidacion_id, req.empresaId]);
    if (!l) throw new ErrorHttp(404, 'Liquidación no encontrada');
    liquidacionId = l.id;
  }
  const d = await emitirDocumento({ empresaId: req.empresaId, tipo, reservaId: b.reserva_id ? Number(b.reserva_id) : null, liquidacionId, receptor: b.receptor || {}, lineas: b.lineas || [], usuarioId: req.usuario.id });
  res.json(d);
});

const doc = async (req) => {
  const d = await uno('SELECT * FROM documentos_tributarios WHERE id = $1 AND empresa_id = $2', [req.params.id, req.empresaId]);
  if (!d) throw new ErrorHttp(404, 'Documento no encontrado');
  return d;
};

r.get('/facturacion/:id/pdf', requiere('facturacion', 'ver'), async (req, res) => {
  const d = await doc(req);
  if (d.pdf_archivo_id) {
    const a = await leerArchivo(req.empresaId, d.pdf_archivo_id);
    if (a) { res.setHeader('Content-Type', 'application/pdf'); return res.end(a.datos); }
  }
  const empresa = await uno('SELECT id, nombre, rut, razon_social, giro, direccion, comuna, ciudad, telefono, correo, logo_clave FROM empresas WHERE id = $1', [req.empresaId]);
  const pdf = await pdfDte(empresa, d);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${{ 39: 'Boleta', 33: 'Factura', 61: 'NotaCredito' }[d.tipo]}-${d.folio || `borrador-${d.id}`}.pdf"`);
  res.end(pdf);
});

r.get('/facturacion/:id/xml', requiere('facturacion', 'ver'), async (req, res) => {
  const d = await doc(req);
  const a = d.xml_archivo_id ? await leerArchivo(req.empresaId, d.xml_archivo_id) : null;
  if (!a) throw new ErrorHttp(404, 'El documento no tiene XML (aún no se emite)');
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Content-Disposition', `attachment; filename="${a.fila.nombre || 'dte.xml'}"`);
  res.end(a.datos);
});

// Emitir un documento retenido o con error (al terminar la marcha blanca)
r.post('/facturacion/:id/emitir', requiere('facturacion', 'editar'), async (req, res) => {
  const d = await doc(req);
  res.json(await procesarDocumento(req.empresaId, d.id, req.usuario.id));
});

r.post('/facturacion/:id/consultar', requiere('facturacion', 'ver'), async (req, res) => {
  const d = await doc(req);
  res.json(await consultarEstado(req.empresaId, d.id, req.usuario.id));
});

r.post('/facturacion/:id/nota-credito', requiere('facturacion', 'editar'), async (req, res) => {
  const d = await doc(req);
  const motivo = String(req.body?.motivo || '').trim();
  if (!motivo) throw new ErrorHttp(400, 'Indica el motivo de la anulación', { campo: 'motivo' });
  res.json(await notaCredito({ empresaId: req.empresaId, dteId: d.id, motivo, usuarioId: req.usuario.id }));
});

r.get('/facturacion/:id', requiere('facturacion', 'ver'), async (req, res) => res.json(await doc(req)));

export default r;
