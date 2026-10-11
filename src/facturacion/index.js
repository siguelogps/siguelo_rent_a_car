// Facturación electrónica (módulo 8): boleta (39), factura (33) y nota de crédito (61) vía SimpleAPI, igual que en el CRM.
// Folios: rango del CAF (archivo en Integraciones › SimpleAPI) y siguiente folio por tipo en la tabla dte_folios.
// Sin permiso para actuar (marcha blanca o integración apagada) el documento queda «retenido» con el motivo, y se puede
// emitir después desde Facturación sin volver a armarlo.
import { q, uno, transaccion } from '../db.js';
import { puedeActuar, leer, marchaBlanca } from '../integraciones/index.js';
import { registrarProbador } from '../integraciones/probadores.js';
import { leerArchivo, guardarArchivo } from '../almacenamiento/index.js';
import { registrar } from '../bitacora.js';
import { ErrorHttp } from '../auth.js';
import { validarRut, normalizarRut } from '../util/rut.js';
import { armarLineas, leerCaf, TIPOS_DTE, TIPOS_DTE_CORTO, RUT_CONSUMIDOR_FINAL, CODIGOS_REFERENCIA } from './calculo.js';
import { crearSimpleApi, armarDocumento } from './simpleapi.js';

let fetchDte = (...a) => globalThis.fetch(...a);
export const usarFetch = (f) => { fetchDte = f || ((...a) => globalThis.fetch(...a)); };

const bit = (empresaId, usuarioId, accion, id, detalle = {}) => registrar({ empresaId, usuario: usuarioId ? { id: usuarioId } : null }, accion, 'dte', id, detalle);
const hoyChile = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
const CAMPO_CAF = { 39: 'caf_boleta_archivo_id', 33: 'caf_factura_archivo_id', 61: 'caf_nota_credito_archivo_id' };

// Receptor a partir del cliente. Boleta sin RUT chileno → consumidor final 66.666.666-6.
export function receptorDeCliente(c, tipo = 39) {
  if (!c) return { rut: RUT_CONSUMIDOR_FINAL, razonSocial: 'Consumidor final' };
  const nombre = c.razon_social || [c.nombre, c.apellidos].filter(Boolean).join(' ');
  const rutOk = c.documento_tipo === 'rut' && validarRut(c.documento);
  return {
    rut: rutOk ? normalizarRut(c.documento) : RUT_CONSUMIDOR_FINAL,
    razonSocial: rutOk || Number(tipo) === 33 ? nombre : `${nombre}`.trim() || 'Consumidor final',
    giro: c.giro || (Number(tipo) === 33 ? '' : null), direccion: c.direccion || '', comuna: c.comuna || '', ciudad: c.ciudad || c.comuna || '', correo: c.correo || ''
  };
}

export function validarReceptor(rec, tipo) {
  if (!rec?.rut) throw new ErrorHttp(400, 'Falta el RUT del receptor', { campo: 'rut' });
  if (rec.rut !== RUT_CONSUMIDOR_FINAL && !validarRut(rec.rut)) throw new ErrorHttp(400, 'El RUT del receptor no es válido', { campo: 'rut' });
  if (Number(tipo) === 33) {
    if (rec.rut === RUT_CONSUMIDOR_FINAL) throw new ErrorHttp(400, 'La factura requiere el RUT de una empresa o persona con giro (no consumidor final)', { campo: 'rut' });
    if (!rec.razonSocial) throw new ErrorHttp(400, 'Falta la razón social del receptor', { campo: 'razonSocial' });
    if (!rec.giro) throw new ErrorHttp(400, 'Falta el giro del receptor (requerido en la factura)', { campo: 'giro' });
    if (!rec.direccion || !rec.comuna) throw new ErrorHttp(400, 'Falta la dirección o la comuna del receptor', { campo: 'direccion' });
  }
}

// Crea el documento y lo procesa (emite o queda retenido).
export async function emitirDocumento({ empresaId, tipo, reservaId = null, liquidacionId = null, receptor, lineas, usuarioId = null, referencias = [], dteRefId = null }) {
  tipo = Number(tipo);
  if (!TIPOS_DTE[tipo]) throw new ErrorHttp(400, 'Tipo de documento no válido (39, 33 o 61)');
  const rec = { ...receptor, rut: receptor?.rut === RUT_CONSUMIDOR_FINAL ? receptor.rut : normalizarRut(receptor?.rut) };
  validarReceptor(rec, tipo);
  const a = armarLineas(lineas || [], tipo);
  if (!a.lineas.length || a.total <= 0) throw new ErrorHttp(400, 'El documento no tiene montos a emitir');
  if (reservaId && !(await uno('SELECT 1 FROM reservas WHERE id = $1 AND empresa_id = $2', [reservaId, empresaId]))) throw new ErrorHttp(404, 'Reserva no encontrada');
  const [d] = await q(`INSERT INTO documentos_tributarios (empresa_id, reserva_id, liquidacion_id, tipo, estado, receptor, lineas, neto, iva, exento, total, creado_por, dte_ref_id, respuesta)
                       VALUES ($1,$2,$3,$4,'pendiente',$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [empresaId, reservaId, liquidacionId, tipo, JSON.stringify(rec), JSON.stringify(a.lineas), a.neto, a.iva, a.exento, a.total, usuarioId, dteRefId, JSON.stringify({ referencias })]);
  await bit(empresaId, usuarioId, 'dte_creado', d.id, { tipo, total: a.total, reserva_id: reservaId });
  return procesarDocumento(empresaId, d.id, usuarioId);
}

async function tomarFolio(empresaId, tipo, caf) {
  return transaccion(async (tx) => {
    await tx.query(`INSERT INTO dte_folios (empresa_id, tipo, siguiente, desde, hasta) VALUES ($1,$2,$3,$3,$4) ON CONFLICT (empresa_id, tipo) DO NOTHING`, [empresaId, tipo, caf?.desde || 1, caf?.hasta || null]);
    const [f] = await tx.query('SELECT * FROM dte_folios WHERE empresa_id = $1 AND tipo = $2 FOR UPDATE', [empresaId, tipo]);
    let siguiente = Number(f.siguiente);
    let desde = f.desde, hasta = f.hasta;
    if (caf) { desde = caf.desde; hasta = caf.hasta; if (siguiente < caf.desde) siguiente = caf.desde; }
    if (hasta && siguiente > hasta) throw new ErrorHttp(409, `No quedan folios de ${TIPOS_DTE[tipo]}: pide un CAF nuevo en el SII y súbelo en Configuración › Integraciones › SimpleAPI`);
    await tx.query('UPDATE dte_folios SET siguiente = $3, desde = $4, hasta = $5, actualizado_en = now() WHERE empresa_id = $1 AND tipo = $2', [empresaId, tipo, siguiente + 1, desde, hasta]);
    return siguiente;
  });
}
async function devolverFolio(empresaId, tipo, folio) {
  await q('UPDATE dte_folios SET siguiente = $3 WHERE empresa_id = $1 AND tipo = $2 AND siguiente = $3 + 1', [empresaId, tipo, folio]);
}

async function textoArchivo(empresaId, id) { const a = id ? await leerArchivo(empresaId, Number(id)) : null; return a ? a.datos : null; }

// Configuración lista para SimpleAPI (certificado y CAF desde el almacenamiento)
async function confSimpleApi(empresaId, conf, tipo) {
  const e = await uno('SELECT rut, razon_social, nombre, giro, acteco, direccion, comuna, ciudad, telefono, correo FROM empresas WHERE id = $1', [empresaId]);
  const certificado = await textoArchivo(empresaId, conf.certificado_archivo_id);
  const cafBuf = tipo ? await textoArchivo(empresaId, conf[CAMPO_CAF[tipo]]) : null;
  return {
    sapi: { ...conf, certificado, emisor: { rut: e.rut, razonSocial: e.razon_social || e.nombre, giro: e.giro, acteco: e.acteco, direccion: e.direccion, comuna: e.comuna, ciudad: e.ciudad, telefono: e.telefono, correo: e.correo } },
    cafXml: cafBuf ? cafBuf.toString('latin1') : null
  };
}

export async function procesarDocumento(empresaId, id, usuarioId = null) {
  const d = await uno('SELECT * FROM documentos_tributarios WHERE id = $1 AND empresa_id = $2', [id, empresaId]);
  if (!d) throw new ErrorHttp(404, 'Documento no encontrado');
  if (!['pendiente', 'retenido', 'error'].includes(d.estado)) throw new ErrorHttp(409, 'El documento ya fue enviado al SII');
  const p = await puedeActuar(empresaId, 'simpleapi');
  if (!p.ok) {
    const mensaje = p.marchaBlanca || await marchaBlanca(empresaId) ? 'Retenido por marcha blanca: se emitirá al desactivarla (Configuración › Integraciones).' : `Retenido: ${p.motivo}.`;
    const [r] = await q(`UPDATE documentos_tributarios SET estado = 'retenido', mensaje = $3 WHERE id = $1 AND empresa_id = $2 RETURNING *`, [id, empresaId, mensaje]);
    await bit(empresaId, usuarioId, 'dte_retenido', id, { motivo: p.motivo });
    return r;
  }
  let folio = d.folio;
  try {
    const { sapi, cafXml } = await confSimpleApi(empresaId, p.config, d.tipo);
    if (!cafXml) throw new ErrorHttp(409, `Falta el CAF de ${TIPOS_DTE_CORTO[d.tipo].toLowerCase()}s en Configuración › Integraciones › SimpleAPI`);
    const caf = leerCaf(cafXml);
    if (caf.tipo !== d.tipo) throw new ErrorHttp(409, `El CAF cargado es de tipo ${caf.tipo}, no de ${TIPOS_DTE[d.tipo]}`);
    if (!folio) folio = await tomarFolio(empresaId, d.tipo, caf);
    const cliente = crearSimpleApi(sapi, { fetch: fetchDte });
    const doc = armarDocumento({ tipo: d.tipo, folio, fecha: hoyChile(), emisor: sapi.emisor, receptor: d.receptor, lineas: d.lineas, totales: { neto: d.neto, iva: d.iva, exento: d.exento, total: d.total }, referencias: d.respuesta?.referencias || [] });
    const xml = await cliente.generar(doc, cafXml);
    const boleta = d.tipo === 39;
    const sobreXml = await cliente.sobre([xml], { boleta });
    const envio = await cliente.enviar(sobreXml, { boleta });
    const arch = await guardarArchivo({ empresaId, entidad: 'dte', entidadId: id, tipo: 'xml', nombre: `${TIPOS_DTE_CORTO[d.tipo]}-${folio}.xml`, mime: 'application/xml', datos: Buffer.from(xml, 'latin1'), usuarioId });
    const [r] = await q(`UPDATE documentos_tributarios SET estado = 'emitido', folio = $3, track_id = $4, ambiente = $5, xml_archivo_id = $6, mensaje = NULL, emitido_en = now(),
                          respuesta = respuesta || $7::jsonb WHERE id = $1 AND empresa_id = $2 RETURNING *`,
      [id, empresaId, folio, envio.trackId, cliente.ambiente, arch.id, JSON.stringify({ envio: envio.respuesta })]);
    await bit(empresaId, usuarioId, 'dte_emitido', id, { tipo: d.tipo, folio, track_id: envio.trackId });
    return r;
  } catch (e) {
    if (folio && !d.folio) await devolverFolio(empresaId, d.tipo, folio);
    const [r] = await q(`UPDATE documentos_tributarios SET estado = 'error', folio = $5, mensaje = $3, respuesta = respuesta || $4::jsonb WHERE id = $1 AND empresa_id = $2 RETURNING *`,
      [id, empresaId, String(e.message).slice(0, 500), JSON.stringify({ error: e.respuesta || e.message }), d.folio || null]);
    await bit(empresaId, usuarioId, 'dte_error', id, { error: e.message });
    return r;
  }
}

// Consulta el estado del envío en el SII (con el TrackID).
export async function consultarEstado(empresaId, id, usuarioId = null) {
  const d = await uno('SELECT * FROM documentos_tributarios WHERE id = $1 AND empresa_id = $2', [id, empresaId]);
  if (!d) throw new ErrorHttp(404, 'Documento no encontrado');
  if (!d.track_id) throw new ErrorHttp(409, 'El documento aún no tiene TrackID del SII');
  if (d.respuesta?.simulado) return d;
  const p = await puedeActuar(empresaId, 'simpleapi');
  if (!p.ok) throw new ErrorHttp(409, `No se puede consultar al SII: ${p.motivo}`);
  const { sapi } = await confSimpleApi(empresaId, p.config, null);
  const r = await crearSimpleApi(sapi, { fetch: fetchDte }).consultarEnvio(d.track_id, { boleta: d.tipo === 39 });
  const estado = r.estado === 'en_proceso' ? 'emitido' : r.estado;
  const [x] = await q(`UPDATE documentos_tributarios SET estado = $3, mensaje = $4, respuesta = respuesta || $5::jsonb WHERE id = $1 AND empresa_id = $2 RETURNING *`,
    [id, empresaId, estado, r.estado === 'en_proceso' ? 'El SII aún está procesando el envío' : r.detalle, JSON.stringify({ consulta: { codigo: r.codigo, detalle: r.detalle } })]);
  await bit(empresaId, usuarioId, 'dte_consultado', id, { estado, codigo: r.codigo });
  return x;
}

// Nota de crédito que anula (código 1) una boleta o factura. En la boleta los montos traen IVA; la nota se emite neta.
export async function notaCredito({ empresaId, dteId, motivo = '', usuarioId = null }) {
  const d = await uno('SELECT * FROM documentos_tributarios WHERE id = $1 AND empresa_id = $2', [dteId, empresaId]);
  if (!d) throw new ErrorHttp(404, 'Documento no encontrado');
  if (![33, 39].includes(d.tipo)) throw new ErrorHttp(400, 'Solo se anulan boletas o facturas');
  if (d.anulado_por) throw new ErrorHttp(409, 'El documento ya tiene una nota de crédito que lo anula');
  if (d.estado === 'retenido' || d.estado === 'pendiente' || d.estado === 'error') {
    // Nunca llegó al SII: se descarta sin nota de crédito.
    const [r] = await q(`UPDATE documentos_tributarios SET estado = 'rechazado', mensaje = $3 WHERE id = $1 AND empresa_id = $2 RETURNING *`, [dteId, empresaId, `Descartado antes de emitir: ${motivo || 'sin motivo'}`]);
    await bit(empresaId, usuarioId, 'dte_descartado', dteId, { motivo });
    return r;
  }
  const lineas = d.lineas.map((l) => ({ nombre: l.nombre, descripcion: l.descripcion, monto: d.tipo === 33 ? Math.round(l.monto * 1.19) : l.monto }));
  // Ajuste: que el total de la nota sea exactamente el del documento
  const suma = lineas.reduce((s, l) => s + l.monto, 0);
  if (suma !== d.total && lineas.length) lineas[0].monto += d.total - suma;
  const nc = await emitirDocumento({ empresaId, tipo: 61, reservaId: d.reserva_id, liquidacionId: d.liquidacion_id, receptor: { ...d.receptor, giro: d.receptor.giro || 'Particular', direccion: d.receptor.direccion || 'Sin dirección', comuna: d.receptor.comuna || 'Santiago' }, lineas, usuarioId, dteRefId: d.id,
    referencias: [{ tipo: d.tipo, folio: d.folio, fecha: (d.emitido_en ? new Date(d.emitido_en) : new Date()).toISOString().slice(0, 10), codigo: 1, razon: motivo || CODIGOS_REFERENCIA[1] }] });
  await q('UPDATE documentos_tributarios SET anulado_por = $3 WHERE id = $1 AND empresa_id = $2', [dteId, empresaId, nc.id]);
  await bit(empresaId, usuarioId, 'nota_credito', dteId, { nota_credito: nc.id, motivo, estado: nc.estado });
  return nc;
}

export async function resumenFolios(empresaId) {
  const { config: conf, activa } = await leer(empresaId, 'simpleapi');
  const filas = await q('SELECT * FROM dte_folios WHERE empresa_id = $1', [empresaId]);
  const out = [];
  for (const tipo of [39, 33, 61]) {
    const f = filas.find((x) => x.tipo === tipo);
    let caf = null, error = null;
    try { const b = await textoArchivo(empresaId, conf[CAMPO_CAF[tipo]]); if (b) caf = leerCaf(b.toString('latin1')); } catch (e) { error = e.message; }
    const hasta = caf?.hasta ?? f?.hasta ?? null;
    const siguiente = Math.max(Number(f?.siguiente || 0), caf?.desde || 0) || null;
    out.push({ tipo, nombre: TIPOS_DTE[tipo], caf: !!caf, desde: caf?.desde ?? f?.desde ?? null, hasta, siguiente, quedan: hasta && siguiente ? Math.max(0, hasta - siguiente + 1) : null, error });
  }
  return { activa, ambiente: conf.ambiente || 'certificacion', folios: out, certificado: !!conf.certificado_archivo_id };
}

// Prueba de conexión: certificado y CAF legibles, y SimpleAPI responde con la API key.
registrarProbador('simpleapi', async (conf, empresaId) => {
  if (!conf.api_key) throw new Error('Falta la API key de SimpleAPI');
  const partes = [];
  if (empresaId) {
    const cert = await textoArchivo(empresaId, conf.certificado_archivo_id);
    if (!cert) throw new Error('Falta subir el certificado digital (.pfx)');
    partes.push(`certificado de ${(cert.length / 1024).toFixed(1)} KB`);
    for (const tipo of [39, 33]) {
      const b = await textoArchivo(empresaId, conf[CAMPO_CAF[tipo]]);
      if (b) { const c = leerCaf(b.toString('latin1')); partes.push(`CAF ${TIPOS_DTE_CORTO[tipo].toLowerCase()} folios ${c.desde}–${c.hasta} (${c.ambiente === 'certificacion' ? 'certificación' : 'producción'})`); }
    }
  }
  let r;
  try { r = await fetchDte('https://api.simpleapi.cl/api/v1/dte/generar', { method: 'POST', headers: { Authorization: conf.api_key }, body: new FormData(), signal: AbortSignal.timeout(20000) }); }
  catch (e) { throw new Error(`No se pudo conectar con SimpleAPI: ${e.message}`); }
  if (r.status === 401 || r.status === 403) throw new Error('SimpleAPI rechazó la API key (o la cuenta no tiene saldo)');
  return `SimpleAPI responde (${conf.ambiente === 'produccion' ? 'producción' : 'certificación'})${partes.length ? ` · ${partes.join(' · ')}` : ''}`;
});
