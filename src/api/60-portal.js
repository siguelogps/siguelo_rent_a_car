// Portal web de reservas (público, sin sesión): /reservar/:slug, /embed/:slug y el área del cliente /portal/:token.
// Rutas bajo /api/portal. Nunca se expone información de otros clientes: el área del cliente se abre solo con su token.
import express from 'express';
import { ErrorHttp } from '../auth.js';
import { q } from '../db.js';
import { guardarArchivo, leerArchivo, desdeDataUrl } from '../almacenamiento/index.js';
import { limitar } from '../portal/limite.js';
import {
  empresaPorSlug, infoPublica, leerBusqueda, buscar, cotizarPortal, crearReservaPortal,
  reservaPorToken, resumenParaCliente, pagarPendiente, TIPOS_DOCUMENTO
} from '../portal/index.js';

const r = express.Router();
const general = limitar({ nombre: 'portal', max: 240, ventanaMs: 60e3 });
const reservas = limitar({ nombre: 'portal-reservar', max: 20, ventanaMs: 10 * 60e3 });
const subidas = limitar({ nombre: 'portal-docs', max: 30, ventanaMs: 10 * 60e3, clave: (req) => `${req.ip}|${req.params.token}` });

r.use('/portal', general, (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

r.get('/portal/empresa/:slug', async (req, res) => {
  res.json(await infoPublica(await empresaPorSlug(req.params.slug)));
});

r.post('/portal/empresa/:slug/buscar', async (req, res) => {
  const e = await empresaPorSlug(req.params.slug);
  res.json(await buscar(e, await leerBusqueda(e, req.body || {})));
});

r.post('/portal/empresa/:slug/cotizar', async (req, res) => {
  const e = await empresaPorSlug(req.params.slug);
  const b = req.body || {};
  res.json(await cotizarPortal(e, await leerBusqueda(e, b.busqueda || {}), { categoriaId: Number(b.categoria_id), extras: b.extras, fechaNacimiento: b.fecha_nacimiento }));
});

r.post('/portal/empresa/:slug/reservar', reservas, async (req, res) => {
  const e = await empresaPorSlug(req.params.slug);
  const b = req.body || {};
  if (!b.acepta) throw new ErrorHttp(400, 'Debes aceptar las condiciones del arriendo.', { campo: 'acepta' });
  const { reserva, cobro, mensaje } = await crearReservaPortal(e, { busqueda: b.busqueda || {}, categoriaId: b.categoria_id, extras: b.extras, cliente: b.cliente || {}, pago: b.pago, proveedor: b.proveedor });
  res.json({ folio: reserva.folio, estado: reserva.estado, total: reserva.total, token: reserva.token_portal, url_portal: `/portal/${reserva.token_portal}`,
    redirigir: cobro?.redirigir || null, simulado: !!cobro?.simulado, mensaje });
});

// El cliente ubica su reserva con el folio y su RUT o pasaporte para subir sus documentos antes del retiro.
// Respuesta genérica si no calza (no revela si el folio existe) y límite de intentos por IP.
const busquedasReserva = limitar({ nombre: 'portal-mi-reserva', max: 10, ventanaMs: 10 * 60e3 });
r.post('/portal/empresa/:slug/mi-reserva', busquedasReserva, async (req, res) => {
  const e = await empresaPorSlug(req.params.slug);
  const folio = String(req.body?.folio || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const doc = String(req.body?.documento || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!folio || doc.length < 5) throw new ErrorHttp(400, 'Ingresa el número de reserva y tu RUT o pasaporte.');
  const [r0] = await q(`SELECT r.token_portal FROM reservas r JOIN clientes c ON c.id = r.cliente_id
      WHERE r.empresa_id = $1 AND upper(regexp_replace(r.folio, '[^A-Za-z0-9]', '', 'g')) = $2
        AND upper(regexp_replace(c.documento, '[^0-9A-Za-z]', '', 'g')) = $3
        AND r.estado IN ('cotizacion','confirmada','en_curso') AND r.token_portal IS NOT NULL`, [e.id, folio, doc]);
  if (!r0) throw new ErrorHttp(404, 'No encontramos una reserva vigente con esos datos. Revisa el número de reserva (está en tu correo de confirmación) y tu RUT o pasaporte.');
  res.json({ url_portal: `/portal/${r0.token_portal}#documentos` });
});

// ── Área del cliente ──
r.get('/portal/r/:token', async (req, res) => {
  res.json(await resumenParaCliente(await reservaPorToken(req.params.token)));
});

r.post('/portal/r/:token/documentos', subidas, async (req, res) => {
  const rv = await reservaPorToken(req.params.token);
  if (!['cotizacion', 'confirmada', 'en_curso'].includes(rv.estado)) throw new ErrorHttp(400, 'Esta reserva ya no admite documentos.');
  if (!rv.cliente_id) throw new ErrorHttp(400, 'La reserva no tiene cliente asociado.');
  const tipo = String(req.body?.tipo || '');
  if (!TIPOS_DOCUMENTO[tipo]) throw new ErrorHttp(400, 'Tipo de documento no válido.');
  let archivo;
  try { archivo = desdeDataUrl(req.body?.dataUrl); } catch { throw new ErrorHttp(400, 'El archivo no es válido. Sube una foto (JPG o PNG) o un PDF.'); }
  if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(archivo.mime)) throw new ErrorHttp(400, 'Sube una foto (JPG o PNG) o un PDF.');
  if (archivo.datos.length > 8 * 1024 * 1024) throw new ErrorHttp(400, 'El archivo supera los 8 MB.');
  const a = await guardarArchivo({ empresaId: rv.empresa_id, entidad: 'cliente', entidadId: rv.cliente_id, tipo, nombre: `${tipo}.${archivo.mime === 'application/pdf' ? 'pdf' : 'jpg'}`,
    mime: archivo.mime, datos: archivo.datos, meta: { origen: 'portal', reserva_id: rv.id, ip: req.ip } });
  await q(`INSERT INTO bitacora (empresa_id, accion, entidad, entidad_id, detalle, ip) VALUES ($1,'documento_portal','cliente',$2,$3,$4)`,
    [rv.empresa_id, rv.cliente_id, JSON.stringify({ tipo, reserva: rv.folio, archivo_id: a.id }), req.ip]);
  res.json({ ok: true, tipo, subido_en: a.creado_en });
});

// Contrato firmado: solo con el token de la reserva (nunca por la descarga genérica autenticada).
r.get('/portal/r/:token/contrato.pdf', async (req, res) => {
  const rv = await reservaPorToken(req.params.token);
  const [c] = await q(`SELECT folio, pdf_archivo_id FROM contratos WHERE reserva_id = $1 AND empresa_id = $2 AND estado = 'firmado' AND pdf_archivo_id IS NOT NULL ORDER BY id DESC LIMIT 1`, [rv.id, rv.empresa_id]);
  if (!c) throw new ErrorHttp(404, 'El contrato aún no está firmado.');
  const a = await leerArchivo(rv.empresa_id, c.pdf_archivo_id);
  if (!a) throw new ErrorHttp(404, 'No encontramos el PDF del contrato.');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `${req.query.descargar ? 'attachment' : 'inline'}; filename="contrato-${c.folio}.pdf"`);
  res.end(a.datos);
});

r.post('/portal/r/:token/pagar', reservas, async (req, res) => {
  const rv = await reservaPorToken(req.params.token);
  const cobro = await pagarPendiente(rv, req.body?.proveedor);
  res.json({ redirigir: cobro.redirigir || null, simulado: !!cobro.simulado });
});

export default r;
