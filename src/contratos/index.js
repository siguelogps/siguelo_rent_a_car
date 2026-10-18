// Contrato digital: generación desde la plantilla «contrato_estandar» de la empresa, firma (tablet del counter o celular
// del cliente), PDF con QR de verificación guardado en el almacenamiento externo, huella SHA-256 y envío al cliente.
import crypto from 'node:crypto';
import { q, uno, transaccion, siguienteFolio } from '../db.js';
import { config } from '../config.js';
import { ErrorHttp } from '../auth.js';
import { guardarArchivo, leerArchivo, desdeDataUrl } from '../almacenamiento/index.js';
import { renderizar, avisar } from '../salidas.js';
import { CONTRATO_ESTANDAR } from '../plantillas-defecto.js';
import { clp, miles, fechaHora } from '../util/formato.js';
import { formatearPatente } from '../util/patente.js';
import { formatearRut } from '../util/rut.js';
import { tokenAleatorio, hashSha256 } from '../cifrado.js';
import { contexto, nombreCompleto, nombreDocumento, documentoTxt, urlPortal } from '../reservas/datos.js';
import { construirPdf } from './pdf.js';

const DIAS_ENLACE = 7;
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const urlVerificacion = (codigo) => `${config.urlBase}/verificar/${codigo}`;
export const urlFirma = (token) => `${config.urlBase}/firmar/${token}`;

function codigoVerificacion() {
  const b = crypto.randomBytes(12);
  const s = [...b].map((x) => ALFABETO[x % ALFABETO.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

const hoyLargo = (d = new Date()) => new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'long', year: 'numeric' }).format(d);

/** Variables de la plantilla de contrato (ver src/plantillas-defecto.js). */
export function variablesContrato(ctx, { folio, codigo, fecha = new Date() }) {
  const { reserva: r, cliente: c, vehiculo: v, empresa: e, sr, sd, conductores } = ctx;
  const aj = e.ajustes || {};
  const lineas = r.cotizacion?.lineas || [];
  return {
    contrato: { folio },
    empresa: { ...e, rut: e.rut ? formatearRut(e.rut) : '', razon_social: e.razon_social || e.nombre },
    cliente: {
      ...(c || {}), nombre: c?.nombre || '', nombre_completo: nombreCompleto(c) || '', documento_tipo: nombreDocumento(c?.documento_tipo), documento: documentoTxt(c?.documento_tipo, c?.documento),
      direccion: [c?.direccion, c?.comuna, c?.ciudad].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(', ') || 'sin dirección registrada'
    },
    vehiculo: v ? { ...v, patente: formatearPatente(v.patente), km: miles(v.gps_km ?? v.km), combustible: `${v.gps_combustible ?? v.combustible_nivel}/8` } : { patente: 'por asignar' },
    reserva: {
      folio: r.folio, inicio: fechaHora(r.inicio), fin: fechaHora(r.fin), total: clp(r.total),
      detalle: lineas.length ? lineas.map((l) => `${l.concepto}${l.detalle ? ` (${l.detalle})` : ''} ${clp(l.monto)}`).join('; ') : clp(r.total),
      km_incluidos: r.km_incluidos ? `${miles(r.km_incluidos)} km` : 'kilometraje libre',
      precio_km_extra: r.km_incluidos ? clp(r.precio_km_extra || 0) : '$0 (kilometraje libre)',
      garantia: clp(r.garantia), deducible: clp(r.deducible)
    },
    sucursal_retiro: sr, sucursal_devolucion: sd,
    ajustes: { ...aj, tolerancia_min: aj.tolerancia_min ?? 59 },
    conductores: conductores.length
      ? conductores.map((x) => `${x.nombre}${x.documento ? ` (${nombreDocumento(x.documento_tipo)} ${documentoTxt(x.documento_tipo, x.documento)}${x.licencia_clase ? `, licencia clase ${x.licencia_clase}` : ''})` : ''}`).join('; ')
      : 'no hay conductores adicionales autorizados',
    condiciones_adicionales: aj.condiciones_contrato || 'No hay condiciones adicionales.',
    url_verificacion: urlVerificacion(codigo),
    hoy: hoyLargo(fecha)
  };
}

/**
 * Genera (o regenera, si está pendiente de firma) el contrato de una reserva confirmada o en curso.
 * → fila de contratos con token_firma vigente.
 */
// `fecha` (opcional) solo la usan los datos de prueba, para fechar el contrato antes del retiro de la reserva.
export async function generarContrato(empresaId, reservaId, usuarioId = null, { ip = null, fecha = new Date() } = {}) {
  return transaccion(async (tx) => {
    const [res] = await tx.query('SELECT id, estado FROM reservas WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [reservaId, empresaId]);
    if (!res) throw new ErrorHttp(404, 'Reserva no encontrada');
    if (!['confirmada', 'en_curso'].includes(res.estado)) throw new ErrorHttp(409, res.estado === 'cotizacion' ? 'Confirma la reserva antes de generar el contrato.' : 'Esta reserva ya no admite un contrato nuevo.');
    const ctx = await contexto(empresaId, reservaId, tx);
    if (!ctx.cliente) throw new ErrorHttp(400, 'La reserva no tiene cliente');
    if (!ctx.vehiculo) throw new ErrorHttp(400, 'Asigna un vehículo antes de generar el contrato');
    const [firmado] = await tx.query(`SELECT folio FROM contratos WHERE empresa_id = $1 AND reserva_id = $2 AND estado = 'firmado'`, [empresaId, reservaId]);
    if (firmado) throw new ErrorHttp(409, `La reserva ya tiene el contrato firmado ${firmado.folio}. Anúlalo para generar uno nuevo.`);
    const [plant] = await tx.query(`SELECT id, cuerpo FROM plantillas WHERE empresa_id = $1 AND tipo = 'contrato' AND clave = 'contrato_estandar' AND activa`, [empresaId]);
    const [pend] = await tx.query(`SELECT * FROM contratos WHERE empresa_id = $1 AND reserva_id = $2 AND estado = 'pendiente_firma' ORDER BY id DESC LIMIT 1`, [empresaId, reservaId]);
    const folio = pend?.folio || await siguienteFolio(empresaId, 'CT', tx);
    const codigo = pend?.codigo_verificacion || codigoVerificacion();
    const vars = variablesContrato(ctx, { folio, codigo, fecha });
    const contenido = renderizar(plant?.cuerpo || CONTRATO_ESTANDAR, vars);
    const datos = { cliente: vars.cliente.nombre_completo, documento: `${vars.cliente.documento_tipo} ${vars.cliente.documento}`, patente: vars.vehiculo.patente,
      vehiculo: `${ctx.vehiculo.marca || ''} ${ctx.vehiculo.modelo || ''} ${ctx.vehiculo.anio || ''}`.trim(), reserva_folio: ctx.reserva.folio, inicio: ctx.reserva.inicio, fin: ctx.reserva.fin,
      total: ctx.reserva.total, garantia: ctx.reserva.garantia, deducible: ctx.reserva.deducible, sucursal_retiro: ctx.sr.nombre, sucursal_devolucion: ctx.sd.nombre,
      correo: ctx.cliente.correo, telefono: ctx.cliente.telefono };
    const token = tokenAleatorio(24), vence = new Date(Date.now() + DIAS_ENLACE * 864e5);
    let c;
    if (pend) {
      [c] = await tx.query(`UPDATE contratos SET contenido = $3, datos = $4, plantilla_id = $5, token_firma = $6, token_firma_vence = $7 WHERE id = $1 AND empresa_id = $2 RETURNING *`,
        [pend.id, empresaId, contenido, JSON.stringify(datos), plant?.id || null, token, vence]);
    } else {
      [c] = await tx.query(`INSERT INTO contratos (empresa_id, reserva_id, folio, plantilla_id, contenido, datos, codigo_verificacion, token_firma, token_firma_vence, creado_por)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [empresaId, reservaId, folio, plant?.id || null, contenido, JSON.stringify(datos), codigo, token, vence, usuarioId]);
    }
    await tx.query('INSERT INTO bitacora (empresa_id, usuario_id, accion, entidad, entidad_id, detalle, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [empresaId, usuarioId, pend ? 'contrato_regenerado' : 'contrato_generado', 'contrato', c.id, JSON.stringify({ folio, reserva_id: reservaId }), ip]);
    return c;
  });
}

/** Nuevo enlace de firma (vence en 7 días). */
export async function renovarEnlace(empresaId, contratoId) {
  const [c] = await q(`UPDATE contratos SET token_firma = $3, token_firma_vence = $4 WHERE id = $1 AND empresa_id = $2 AND estado = 'pendiente_firma' RETURNING *`,
    [contratoId, empresaId, tokenAleatorio(24), new Date(Date.now() + DIAS_ENLACE * 864e5)]);
  if (!c) throw new ErrorHttp(409, 'El contrato no está pendiente de firma');
  return c;
}

async function logoEmpresa(empresa) {
  if (!empresa.logo_clave || !/^\d+$/.test(String(empresa.logo_clave))) return null;
  const a = await leerArchivo(empresa.id, Number(empresa.logo_clave)).catch(() => null);
  return a && /image\/(png|jpeg)/.test(a.fila.mime) ? a.datos : null;
}

/** PDF del contrato tal como está (vista previa si no está firmado). */
export async function pdfContrato(empresaId, contrato) {
  const empresa = await uno('SELECT * FROM empresas WHERE id = $1', [empresaId]);
  let firma = null;
  if (contrato.firma_archivo_id) firma = (await leerArchivo(empresaId, contrato.firma_archivo_id))?.datos || null;
  return construirPdf({ contrato, empresa, logo: await logoEmpresa(empresa), firma, urlVerificacion: urlVerificacion(contrato.codigo_verificacion) });
}

/**
 * Firma el contrato: guarda la imagen de la firma, construye el PDF con QR, lo guarda, calcula la huella SHA-256 y
 * envía «contrato_firmado» por correo (con el PDF adjunto) y WhatsApp (retenidos en marcha blanca).
 */
// `firmadoEn` (opcional) solo la usan los datos de prueba; en la operación real la firma queda con la hora del servidor.
export async function firmarContrato({ empresaId, contratoId, firmaDataUrl, nombre, documento, ip = null, agente = null, usuarioId = null, firmadoEn = null }) {
  const nom = String(nombre || '').trim().slice(0, 120), docu = String(documento || '').trim().slice(0, 30);
  if (nom.length < 3) throw new ErrorHttp(400, 'Escribe tu nombre completo', { campo: 'nombre' });
  if (docu.length < 5) throw new ErrorHttp(400, 'Escribe tu RUT, pasaporte o DNI', { campo: 'documento' });
  let img;
  try { img = desdeDataUrl(firmaDataUrl); } catch { throw new ErrorHttp(400, 'Falta la firma', { campo: 'firma' }); }
  if (!/^image\/(png|jpeg)$/.test(img.mime) || img.datos.length < 200) throw new ErrorHttp(400, 'Falta la firma', { campo: 'firma' });
  if (img.datos.length > 3 * 1024 * 1024) throw new ErrorHttp(400, 'La imagen de la firma es demasiado grande');

  // Se «toma» el contrato de forma atómica para que no se firme dos veces
  const [c] = await q(`UPDATE contratos SET estado = 'firmado', firmante_nombre = $3, firmante_documento = $4, firmado_en = COALESCE($7::timestamptz, now()), firmado_ip = $5, firmado_agente = $6
      WHERE id = $1 AND empresa_id = $2 AND estado = 'pendiente_firma' RETURNING *`, [contratoId, empresaId, nom, docu, ip, String(agente || '').slice(0, 300), firmadoEn]);
  if (!c) throw new ErrorHttp(409, 'Este contrato ya fue firmado o anulado');
  try {
    const fa = await guardarArchivo({ empresaId, entidad: 'contrato', entidadId: c.id, tipo: 'firma', nombre: `firma-${c.folio}.png`, mime: img.mime, datos: img.datos, meta: { ip, firmante: nom }, usuarioId });
    const empresa = await uno('SELECT * FROM empresas WHERE id = $1', [empresaId]);
    const pdf = await construirPdf({ contrato: c, empresa, logo: await logoEmpresa(empresa), firma: img.datos, urlVerificacion: urlVerificacion(c.codigo_verificacion) });
    const hash = hashSha256(pdf);
    const pa = await guardarArchivo({ empresaId, entidad: 'contrato', entidadId: c.id, tipo: 'pdf', nombre: `Contrato ${c.folio}.pdf`, mime: 'application/pdf', datos: pdf, meta: { sha256: hash }, usuarioId });
    const [fin] = await q('UPDATE contratos SET firma_archivo_id = $3, pdf_archivo_id = $4, hash_sha256 = $5 WHERE id = $1 AND empresa_id = $2 RETURNING *', [c.id, empresaId, fa.id, pa.id, hash]);
    await q('INSERT INTO bitacora (empresa_id, usuario_id, accion, entidad, entidad_id, detalle, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [empresaId, usuarioId, 'contrato_firmado', 'contrato', c.id, JSON.stringify({ folio: c.folio, firmante: nom, documento: docu, sha256: hash, reserva_id: c.reserva_id }), ip]);
    await enviarFirmado(empresaId, fin).catch((e) => console.error('aviso contrato_firmado', e.message));
    return fin;
  } catch (e) {
    await q(`UPDATE contratos SET estado = 'pendiente_firma', firmante_nombre = NULL, firmante_documento = NULL, firmado_en = NULL, firmado_ip = NULL, firmado_agente = NULL WHERE id = $1 AND empresa_id = $2`, [c.id, empresaId]);
    throw e;
  }
}

/** Correo (PDF adjunto) y WhatsApp «contrato_firmado» al cliente. */
export async function enviarFirmado(empresaId, contrato) {
  const ctx = await contexto(empresaId, contrato.reserva_id);
  if (!ctx?.cliente) return [];
  const datos = { ...variablesContrato(ctx, { folio: contrato.folio, codigo: contrato.codigo_verificacion }), url_contrato: urlPortal(ctx.reserva.token_portal) || urlVerificacion(contrato.codigo_verificacion) };
  const out = await avisar({ empresaId, clave: 'contrato_firmado', datos, correo: ctx.cliente.correo, telefono: ctx.cliente.telefono,
    adjuntos: contrato.pdf_archivo_id ? [{ archivo_id: contrato.pdf_archivo_id, nombre: `Contrato ${contrato.folio}.pdf` }] : [], entidad: 'contrato', entidadId: contrato.id });
  for (const s of out.filter(Boolean)) {
    if (s.estado === 'enviada') await q(`UPDATE contratos SET ${s.canal === 'correo' ? 'enviado_correo_en' : 'enviado_whatsapp_en'} = now() WHERE id = $1`, [contrato.id]);
  }
  return out;
}

export async function anularContrato(empresaId, contratoId, motivo, usuarioId = null, ip = null) {
  const m = String(motivo || '').trim();
  if (m.length < 3) throw new ErrorHttp(400, 'Indica el motivo de la anulación', { campo: 'motivo' });
  const [c] = await q(`UPDATE contratos SET estado = 'anulado', anulado_motivo = $3, anulado_en = now(), anulado_por = $4, token_firma = NULL WHERE id = $1 AND empresa_id = $2 AND estado <> 'anulado' RETURNING *`,
    [contratoId, empresaId, m.slice(0, 1000), usuarioId]);
  if (!c) throw new ErrorHttp(409, 'El contrato no existe o ya está anulado');
  await q('INSERT INTO bitacora (empresa_id, usuario_id, accion, entidad, entidad_id, detalle, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [empresaId, usuarioId, 'contrato_anulado', 'contrato', c.id, JSON.stringify({ folio: c.folio, motivo: m }), ip]);
  return c;
}
