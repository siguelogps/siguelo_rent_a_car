// Módulo 5 · Contrato digital: lista, ficha, generación desde la reserva, enlace de firma, PDF, anulación,
// y las rutas públicas (sin sesión) de firma (/api/firmar/:token) y verificación por QR (/api/verificar/:codigo).
import express from 'express';
import { q, uno } from '../db.js';
import { requiere, ErrorHttp } from '../auth.js';
import { registrar } from '../bitacora.js';
import { leerArchivo } from '../almacenamiento/index.js';
import { encolar } from '../salidas.js';
import { formatearPatente } from '../util/patente.js';
import { fechaHora } from '../util/formato.js';
import { generarContrato, renovarEnlace, firmarContrato, anularContrato, pdfContrato, enviarFirmado, urlFirma, urlVerificacion } from '../contratos/index.js';

const r = express.Router();
const ver = requiere('contratos', 'ver'), editar = requiere('contratos', 'editar');
const idDe = (v) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new ErrorHttp(404, 'Contrato no encontrado'); return n; };
const enlace = (c) => (c.estado === 'pendiente_firma' && c.token_firma ? { url_firma: urlFirma(c.token_firma), vence: c.token_firma_vence } : null);

r.get('/contratos', ver, async (req, res) => {
  const E = req.empresaId, w = ['ct.empresa_id = $1'], p = [E];
  if (['pendiente_firma', 'firmado', 'anulado'].includes(req.query.estado)) { p.push(req.query.estado); w.push(`ct.estado = $${p.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.desde || '')) { p.push(req.query.desde); w.push(`(ct.creado_en AT TIME ZONE 'America/Santiago')::date >= $${p.length}::date`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.hasta || '')) { p.push(req.query.hasta); w.push(`(ct.creado_en AT TIME ZONE 'America/Santiago')::date <= $${p.length}::date`); }
  if (req.query.reserva_id) { p.push(Number(req.query.reserva_id)); w.push(`ct.reserva_id = $${p.length}`); }
  const t = String(req.query.q || '').trim();
  if (t) { p.push(`%${t}%`); const i = p.length; p.push(`%${t.toUpperCase().replace(/[^A-Z0-9]/g, '') || '__'}%`);
    w.push(`(ct.folio ILIKE $${i} OR r.folio ILIKE $${i} OR (c.nombre || ' ' || coalesce(c.apellidos,'')) ILIKE $${i} OR v.patente ILIKE $${p.length} OR ct.codigo_verificacion ILIKE $${i})`); }
  const filas = await q(`SELECT ct.id, ct.folio, ct.estado, ct.creado_en, ct.firmado_en, ct.firmante_nombre, ct.pdf_archivo_id, ct.codigo_verificacion, ct.reserva_id,
      r.folio AS reserva_folio, r.estado AS reserva_estado, r.inicio, r.fin, trim(c.nombre || ' ' || coalesce(c.apellidos,'')) AS cliente, v.patente, v.marca, v.modelo
    FROM contratos ct JOIN reservas r ON r.id = ct.reserva_id LEFT JOIN clientes c ON c.id = r.cliente_id LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
    WHERE ${w.join(' AND ')} ORDER BY ct.creado_en DESC LIMIT 500`, p);
  const totales = await uno(`SELECT count(*)::int AS total, count(*) FILTER (WHERE estado = 'pendiente_firma')::int AS pendiente_firma,
      count(*) FILTER (WHERE estado = 'firmado')::int AS firmado, count(*) FILTER (WHERE estado = 'anulado')::int AS anulado FROM contratos WHERE empresa_id = $1`, [E]);
  res.json({ contratos: filas, totales });
});

r.get('/contratos/:id', ver, async (req, res) => {
  const E = req.empresaId, id = idDe(req.params.id);
  const c = await uno(`SELECT ct.*, u.nombre AS creado_por_nombre, ua.nombre AS anulado_por_nombre FROM contratos ct LEFT JOIN usuarios u ON u.id = ct.creado_por LEFT JOIN usuarios ua ON ua.id = ct.anulado_por
      WHERE ct.id = $1 AND ct.empresa_id = $2`, [id, E]);
  if (!c) throw new ErrorHttp(404, 'Contrato no encontrado');
  const reserva = await uno(`SELECT r.id, r.folio, r.estado, r.inicio, r.fin, r.total, trim(cl.nombre || ' ' || coalesce(cl.apellidos,'')) AS cliente, cl.id AS cliente_id, cl.correo, cl.telefono,
      v.patente, v.marca, v.modelo, v.anio FROM reservas r LEFT JOIN clientes cl ON cl.id = r.cliente_id LEFT JOIN vehiculos v ON v.id = r.vehiculo_id WHERE r.id = $1 AND r.empresa_id = $2`, [c.reserva_id, E]);
  const [historial, salidas] = await Promise.all([
    q(`SELECT b.accion, b.detalle, b.creado_en, u.nombre AS usuario FROM bitacora b LEFT JOIN usuarios u ON u.id = b.usuario_id WHERE b.empresa_id = $1 AND b.entidad = 'contrato' AND b.entidad_id = $2 ORDER BY b.creado_en DESC`, [E, id]),
    q(`SELECT canal, destino, estado, error, creado_en, enviado_en FROM salidas WHERE empresa_id = $1 AND entidad = 'contrato' AND entidad_id = $2 ORDER BY creado_en DESC`, [E, id])
  ]);
  delete c.token_firma;
  res.json({ contrato: { ...c, url_verificacion: urlVerificacion(c.codigo_verificacion) }, enlace: enlace(await uno('SELECT estado, token_firma, token_firma_vence FROM contratos WHERE id = $1', [id])), reserva, historial, salidas });
});

r.get('/contratos/:id/pdf', ver, async (req, res) => {
  const E = req.empresaId, id = idDe(req.params.id);
  const c = await uno('SELECT * FROM contratos WHERE id = $1 AND empresa_id = $2', [id, E]);
  if (!c) throw new ErrorHttp(404, 'Contrato no encontrado');
  let pdf;
  if (c.pdf_archivo_id && c.estado === 'firmado') pdf = (await leerArchivo(E, c.pdf_archivo_id))?.datos;
  if (!pdf) pdf = await pdfContrato(E, c);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.descargar ? 'attachment' : 'inline'}; filename="Contrato-${c.folio}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(pdf);
});

r.post('/reservas/:id/contrato', editar, async (req, res) => {
  const E = req.empresaId, id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new ErrorHttp(404, 'Reserva no encontrada');
  const c = await generarContrato(E, id, req.usuario.id, { ip: req.ip });
  res.status(201).json({ id: c.id, folio: c.folio, estado: c.estado, codigo_verificacion: c.codigo_verificacion, ...enlace(c) });
});

r.post('/contratos/:id/enlace', editar, async (req, res) => {
  const c = await renovarEnlace(req.empresaId, idDe(req.params.id));
  await registrar(req, 'contrato_enlace_renovado', 'contrato', c.id);
  res.json(enlace(c));
});

// Envía el enlace de firma al cliente (correo y/o WhatsApp; en marcha blanca queda retenido)
r.post('/contratos/:id/enviar-enlace', editar, async (req, res) => {
  const E = req.empresaId, id = idDe(req.params.id);
  const c = await uno(`SELECT ct.*, cl.nombre, cl.correo, cl.telefono, e.nombre AS empresa FROM contratos ct JOIN reservas r ON r.id = ct.reserva_id
      LEFT JOIN clientes cl ON cl.id = r.cliente_id JOIN empresas e ON e.id = ct.empresa_id WHERE ct.id = $1 AND ct.empresa_id = $2`, [id, E]);
  if (!c) throw new ErrorHttp(404, 'Contrato no encontrado');
  if (c.estado !== 'pendiente_firma' || !c.token_firma) throw new ErrorHttp(409, 'El contrato no está pendiente de firma');
  const url = urlFirma(c.token_firma), canal = req.body.canal || 'ambos', out = [];
  const texto = `Hola ${c.nombre}: para firmar tu contrato de arriendo ${c.folio} con ${c.empresa}, ábrelo aquí: ${url}\nEl enlace vence el ${fechaHora(c.token_firma_vence)}.`;
  if (canal !== 'whatsapp' && c.correo) out.push(await encolar({ empresaId: E, canal: 'correo', destino: c.correo, asunto: `Firma tu contrato ${c.folio} · ${c.empresa}`, cuerpo: texto, entidad: 'contrato', entidadId: id }));
  if (canal !== 'correo' && c.telefono) out.push(await encolar({ empresaId: E, canal: 'whatsapp', destino: c.telefono, cuerpo: texto, entidad: 'contrato', entidadId: id }));
  if (!out.length) throw new ErrorHttp(400, 'El cliente no tiene correo ni teléfono registrados');
  await registrar(req, 'contrato_enlace_enviado', 'contrato', id, { canales: out.map((s) => s.canal) });
  res.json({ salidas: out.map((s) => ({ canal: s.canal, estado: s.estado, destino: s.destino })) });
});

r.post('/contratos/:id/reenviar', editar, async (req, res) => {
  const E = req.empresaId, id = idDe(req.params.id);
  const c = await uno('SELECT * FROM contratos WHERE id = $1 AND empresa_id = $2', [id, E]);
  if (!c) throw new ErrorHttp(404, 'Contrato no encontrado');
  if (c.estado !== 'firmado') throw new ErrorHttp(409, 'Solo se reenvían contratos firmados');
  const out = await enviarFirmado(E, c);
  await registrar(req, 'contrato_reenviado', 'contrato', id);
  res.json({ salidas: out.filter(Boolean).map((s) => ({ canal: s.canal, estado: s.estado, destino: s.destino })) });
});

r.post('/contratos/:id/anular', editar, async (req, res) => {
  const c = await anularContrato(req.empresaId, idDe(req.params.id), req.body.motivo, req.usuario.id, req.ip);
  res.json({ id: c.id, estado: c.estado });
});

// ── Públicas (sin sesión): la empresa se resuelve solo desde el token o el código ──
async function porToken(token) {
  if (!/^[\w-]{20,64}$/.test(String(token || ''))) throw new ErrorHttp(404, 'El enlace de firma no es válido');
  const c = await uno('SELECT * FROM contratos WHERE token_firma = $1', [token]);
  if (!c) throw new ErrorHttp(404, 'El enlace de firma no es válido o el contrato fue anulado');
  return c;
}

r.get('/firmar/:token', async (req, res) => {
  const c = await porToken(req.params.token);
  if (c.estado === 'pendiente_firma' && c.token_firma_vence && new Date(c.token_firma_vence) < new Date()) throw new ErrorHttp(410, 'El enlace de firma venció. Pide uno nuevo en el mesón.');
  const e = await uno('SELECT nombre, slug, logo_clave, color, telefono FROM empresas WHERE id = $1', [c.empresa_id]);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ folio: c.folio, estado: c.estado, contenido: c.contenido, empresa: { nombre: e.nombre, logo: e.logo_clave ? `/api/logo/${e.slug}` : null, color: e.color, telefono: e.telefono },
    cliente: c.datos?.cliente || '', documento: c.datos?.documento?.replace(/^(RUT|Pasaporte|DNI)\s+/, '') || '', patente: c.datos?.patente || '', vehiculo: c.datos?.vehiculo || '',
    inicio: c.datos?.inicio, fin: c.datos?.fin, firmado_en: c.firmado_en, firmante_nombre: c.firmante_nombre, codigo_verificacion: c.estado === 'firmado' ? c.codigo_verificacion : null,
    url_verificacion: c.estado === 'firmado' ? urlVerificacion(c.codigo_verificacion) : null });
});

r.post('/firmar/:token', async (req, res) => {
  const c = await porToken(req.params.token);
  if (c.estado !== 'pendiente_firma') throw new ErrorHttp(409, 'Este contrato ya fue firmado');
  if (c.token_firma_vence && new Date(c.token_firma_vence) < new Date()) throw new ErrorHttp(410, 'El enlace de firma venció. Pide uno nuevo en el mesón.');
  if (!req.body.acepta) throw new ErrorHttp(400, 'Debes aceptar las condiciones del contrato', { campo: 'acepta' });
  const f = await firmarContrato({ empresaId: c.empresa_id, contratoId: c.id, firmaDataUrl: req.body.firma, nombre: req.body.nombre, documento: req.body.documento,
    ip: req.ip, agente: req.headers['user-agent'], usuarioId: req.usuario?.empresa_id === c.empresa_id ? req.usuario.id : null });
  res.json({ folio: f.folio, estado: f.estado, codigo_verificacion: f.codigo_verificacion, url_verificacion: urlVerificacion(f.codigo_verificacion), firmado_en: f.firmado_en, hash_sha256: f.hash_sha256 });
});

// Copia del PDF firmado para quien firmó (mismo enlace)
r.get('/firmar/:token/pdf', async (req, res) => {
  const c = await porToken(req.params.token);
  if (c.estado !== 'firmado' || !c.pdf_archivo_id) throw new ErrorHttp(409, 'El contrato aún no está firmado');
  const a = await leerArchivo(c.empresa_id, c.pdf_archivo_id);
  if (!a) throw new ErrorHttp(404, 'PDF no encontrado');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Contrato-${c.folio}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(a.datos);
});

const enmascarar = (doc) => {
  const s = String(doc || '');
  if (s.length <= 5) return s;
  return s.slice(0, -5).replace(/[0-9A-Za-z]/g, '•') + s.slice(-5); // 16.482.903-0 → ••.•••.903-0
};

r.get('/verificar/:codigo', async (req, res) => {
  const cod = String(req.params.codigo || '').toUpperCase().trim();
  if (!/^[A-Z0-9-]{6,20}$/.test(cod)) throw new ErrorHttp(404, 'Código no encontrado');
  const c = await uno(`SELECT ct.folio, ct.estado, ct.firmado_en, ct.firmante_nombre, ct.firmante_documento, ct.hash_sha256, ct.anulado_en, ct.anulado_motivo, ct.creado_en, ct.datos,
      e.nombre AS empresa, e.razon_social, e.rut AS empresa_rut, e.slug, e.logo_clave, r.inicio, r.fin, v.patente, v.marca, v.modelo
    FROM contratos ct JOIN empresas e ON e.id = ct.empresa_id JOIN reservas r ON r.id = ct.reserva_id LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
    WHERE ct.codigo_verificacion = $1`, [cod]);
  if (!c) throw new ErrorHttp(404, 'No existe un contrato con ese código');
  res.setHeader('Cache-Control', 'no-store');
  res.json({ codigo: cod, folio: c.folio, estado: c.estado === 'anulado' ? 'anulado' : c.estado === 'firmado' ? 'vigente' : 'pendiente_firma',
    empresa: { nombre: c.empresa, razon_social: c.razon_social, rut: c.empresa_rut, logo: c.logo_clave ? `/api/logo/${c.slug}` : null },
    patente: c.patente ? formatearPatente(c.patente) : c.datos?.patente, vehiculo: c.marca ? `${c.marca} ${c.modelo}` : c.datos?.vehiculo, inicio: c.inicio, fin: c.fin,
    firmante: c.firmante_nombre, firmante_documento: enmascarar(c.firmante_documento), firmado_en: c.firmado_en, hash_sha256: c.hash_sha256,
    anulado_en: c.anulado_en, anulado_motivo: c.anulado_motivo, emitido_en: c.creado_en });
});

export default r;
