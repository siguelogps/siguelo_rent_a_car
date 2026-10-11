// Cliente de SimpleAPI (api.simpleapi.cl) para emitir DTE ante el SII — portado del CRM Síguelo Gestión.
// Flujo: generar el DTE (firma + timbre con el CAF) → armar el sobre EnvioDTE/EnvioBOLETA → enviarlo al SII → consultar el TrackID.
// Todas las llamadas son multipart: un campo «input» con el JSON y los archivos (certificado .pfx, CAF, XML).
// Límite de SimpleAPI: 3 por segundo y 40 por minuto; se respeta con una cola simple.
import { textoSII } from './calculo.js';

export const RUT_SII = '60803000-K';
const BASE = 'https://api.simpleapi.cl';
const fechaTxt = (d) => (typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10));

// Documento en el formato de SimpleAPI (PascalCase, como en su colección de Postman).
export function armarDocumento({ tipo, folio, fecha, formaPago = 1, emisor, receptor, lineas, totales, referencias = [], indicadorServicio = null }) {
  tipo = Number(tipo);
  const boleta = tipo === 39;
  const id = { TipoDTE: tipo, Folio: Number(folio), FechaEmision: fechaTxt(fecha) };
  if (!boleta) id.FormaPago = formaPago;
  if (boleta) id.IndicadorServicio = indicadorServicio ?? 3;
  const em = {
    Rut: emisor.rut, RazonSocial: textoSII(emisor.razonSocial, 100), Giro: textoSII(emisor.giro, 80),
    ActividadEconomica: emisor.acteco ? [Number(emisor.acteco)] : [], DireccionOrigen: textoSII(emisor.direccion, 70), ComunaOrigen: textoSII(emisor.comuna, 20),
    CiudadOrigen: textoSII(emisor.ciudad || emisor.comuna, 20), Telefono: emisor.telefono ? [emisor.telefono] : []
  };
  if (emisor.correo) em.CorreoElectronico = emisor.correo;
  if (boleta) { em.RazonSocialBoleta = em.RazonSocial; em.GiroBoleta = em.Giro; delete em.RazonSocial; delete em.Giro; delete em.ActividadEconomica; }
  const rec = { Rut: receptor.rut, RazonSocial: textoSII(receptor.razonSocial, 100) };
  if (receptor.giro) rec.Giro = textoSII(receptor.giro, 40);
  if (receptor.direccion) rec.Direccion = textoSII(receptor.direccion, 70);
  if (receptor.comuna) rec.Comuna = textoSII(receptor.comuna, 20);
  if (receptor.ciudad) rec.Ciudad = textoSII(receptor.ciudad, 20);
  if (receptor.correo) rec.CorreoElectronico = receptor.correo;
  const tot = boleta ? { MontoNeto: totales.neto, IVA: totales.iva, MontoTotal: totales.total } : { MontoNeto: totales.neto, TasaIVA: 19, IVA: totales.iva, MontoTotal: totales.total };
  if (totales.exento) tot.MontoExento = totales.exento;
  const detalles = lineas.map((l, i) => {
    const d = { NumeroLinea: i + 1, Nombre: textoSII(l.nombre, 80), Cantidad: Number(l.cantidad) || 1, Precio: Number(l.precio) || 0, MontoItem: Math.round(Number(l.monto) || 0) };
    if (l.descripcion) d.Descripcion = textoSII(l.descripcion, 1000);
    return d;
  });
  const refs = referencias.map((r, i) => ({
    Numero: i + 1, TipoDocumento: String(r.tipo), FolioReferencia: String(r.folio), FechaDocumentoReferencia: fechaTxt(r.fecha),
    ...(r.codigo ? { CodigoReferencia: String(r.codigo) } : {}), ...(r.razon ? { RazonReferencia: textoSII(r.razon, 90) } : {})
  }));
  return { Documento: { Encabezado: { IdentificacionDTE: id, Emisor: em, Receptor: rec, Totales: tot }, Detalles: detalles, Referencias: refs } };
}

// TrackID de la respuesta de envío (JSON o XML, según la versión de SimpleAPI).
export function leerTrackId(texto) {
  const s = String(texto || '');
  try {
    const j = JSON.parse(s);
    const v = j?.trackId ?? j?.TrackId ?? j?.trackID ?? j?.TRACKID ?? j?.data?.trackId ?? (typeof j === 'number' ? j : null);
    if (v) return String(v);
  } catch { /* no es JSON */ }
  return s.match(/<TRACKID>\s*(\d+)\s*<\/TRACKID>/i)?.[1] || s.match(/track\s*id\D{0,6}(\d{5,})/i)?.[1] || (/^\s*\d{5,}\s*$/.test(s) ? s.trim() : null);
}

// Estado del envío: { estado: 'aceptado'|'reparos'|'rechazado'|'en_proceso', codigo, detalle }.
export function leerEstadoEnvio(texto) {
  const s = String(texto || '');
  let j = null; try { j = JSON.parse(s); } catch { /* XML o texto */ }
  const buscar = (...claves) => { for (const k of claves) { const v = j?.[k] ?? j?.data?.[k] ?? j?.resultado?.[k]; if (v != null) return v; } return null; };
  const num = (v) => (v == null ? null : Number(v));
  const codigo = String(buscar('estado', 'Estado', 'ESTADO', 'estadoEnvio') ?? s.match(/<ESTADO>\s*([A-Z0-9-]+)\s*<\/ESTADO>/)?.[1] ?? s.match(/\b(EPR|RPR|RLV|RCH|RCT|RFR|RSC|RCS|REC|SOK|CRT|FOK|PRD|DOK|DNK|RPT|LOK|-11)\b/)?.[1] ?? '').trim();
  const aceptados = num(buscar('aceptados', 'Aceptados', 'ACEPTADOS', 'informados') ?? s.match(/<ACEPTADOS>(\d+)</)?.[1]);
  const rechazados = num(buscar('rechazados', 'Rechazados', 'RECHAZADOS') ?? s.match(/<RECHAZADOS>(\d+)</)?.[1]);
  const reparos = num(buscar('reparos', 'Reparos', 'REPAROS') ?? s.match(/<REPAROS>(\d+)</)?.[1]);
  const glosa = String(buscar('glosa', 'Glosa', 'GLOSA', 'descripcion', 'mensaje') ?? s.match(/<GLOSA>([^<]*)</)?.[1] ?? '').trim();
  let estado = 'en_proceso';
  if (rechazados > 0 || /^(RCH|RCT|RFR|RSC|RCS|RPT|DNK|-11)$/.test(codigo)) estado = 'rechazado';
  else if (reparos > 0 || codigo === 'RLV' || codigo === 'RPR') estado = 'reparos';
  else if (codigo === 'EPR' || codigo === 'DOK' || codigo === 'LOK' || aceptados > 0) estado = 'aceptado';
  return { estado, codigo: codigo || null, aceptados, rechazados, reparos, detalle: glosa || null };
}

// conf: { api_key, ambiente, rut_certificado, clave_certificado, certificado (Buffer .pfx), emisor:{rut, razonSocial…}, resolucion_numero, resolucion_fecha }
export function crearSimpleApi(conf, { fetch: f = globalThis.fetch, esperar = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const ambiente = conf.ambiente === 'produccion' ? 1 : 0;
  const marcas = [];
  async function turno() {
    for (;;) {
      const t = Date.now();
      while (marcas.length && t - marcas[0] > 60000) marcas.shift();
      if (marcas.length < 40 && marcas.filter((m) => t - m < 1000).length < 3) { marcas.push(t); return; }
      await esperar(marcas.length >= 40 ? 60000 - (t - marcas[0]) + 50 : 350);
    }
  }
  function faltante() {
    if (!conf.api_key) return 'falta la API key de SimpleAPI';
    if (!conf.emisor?.rut) return 'faltan el RUT y los datos tributarios de la empresa';
    if (!conf.certificado || !conf.clave_certificado || !conf.rut_certificado) return 'falta el certificado digital, su clave o el RUT del titular';
    return null;
  }
  const certificado = () => ({ Rut: conf.rut_certificado, Password: conf.clave_certificado });
  const archivoCert = () => new Blob([conf.certificado], { type: 'application/x-pkcs12' });
  const archivoXml = (xml) => new Blob([typeof xml === 'string' ? Buffer.from(xml, 'latin1') : xml], { type: 'application/xml' });

  async function llamar(ruta, input, archivos = []) {
    const falta = faltante();
    if (falta) throw Object.assign(new Error(`Facturación: ${falta} (Configuración › Integraciones › SimpleAPI)`), { estado: 409 });
    await turno();
    const form = new FormData();
    form.append('input', JSON.stringify(input));
    for (const [campo, blob, nombre] of archivos) form.append(campo, blob, nombre);
    let r;
    try { r = await f(`${conf.api_base || BASE}${ruta}`, { method: 'POST', headers: { Authorization: conf.api_key }, body: form, signal: AbortSignal.timeout(90000) }); }
    catch (e) { throw new Error(`No se pudo conectar con SimpleAPI: ${e.message}`); }
    const buf = Buffer.from(await r.arrayBuffer());
    if (!r.ok) {
      const txt = buf.toString('utf8').slice(0, 800);
      const motivo = r.status === 401 || r.status === 403 ? 'API key rechazada o sin saldo' : r.status === 429 ? 'demasiadas consultas seguidas (límite 40 por minuto)' : `error ${r.status}`;
      throw Object.assign(new Error(`SimpleAPI: ${motivo}${txt ? ` · ${txt}` : ''}`), { estado: 502, respuesta: txt });
    }
    return buf.toString('latin1');
  }

  async function generar(doc, cafXml) {
    const xml = await llamar('/api/v1/dte/generar', { ...doc, Certificado: certificado(), Ambiente: ambiente }, [['files', archivoCert(), 'certificado.pfx'], ['files2', archivoXml(cafXml), 'caf.xml']]);
    if (!/<DTE[\s>]/.test(xml)) throw Object.assign(new Error(`SimpleAPI no devolvió un DTE: ${xml.slice(0, 300)}`), { respuesta: xml.slice(0, 2000) });
    return xml;
  }
  async function sobre(xmls, { boleta = false } = {}) {
    const caratula = { RutEmisor: conf.emisor.rut, RutReceptor: RUT_SII, FechaResolucion: conf.resolucion_fecha, NumeroResolucion: Number(conf.resolucion_numero) || 0 };
    const xml = await llamar('/api/v1/envio/generar', { Certificado: certificado(), Caratula: caratula, ...caratula, Ambiente: ambiente, Tipo: boleta ? 2 : 1 },
      [['files', archivoCert(), 'certificado.pfx'], ...xmls.map((x, i) => ['files2', archivoXml(x), `dte${i + 1}.xml`])]);
    if (!/<Envio(DTE|BOLETA)[\s>]/.test(xml)) throw Object.assign(new Error(`SimpleAPI no devolvió el sobre de envío: ${xml.slice(0, 300)}`), { respuesta: xml.slice(0, 2000) });
    return xml;
  }
  async function enviar(sobreXml, { boleta = false } = {}) {
    const res = await llamar('/api/v1/envio/enviar', { Certificado: certificado(), RutEmisor: conf.emisor.rut, RutReceptor: RUT_SII, Ambiente: ambiente, Tipo: boleta ? 2 : 1, ServidorBoletaREST: boleta },
      [['files', archivoCert(), 'certificado.pfx'], ['files2', archivoXml(sobreXml), 'envio.xml']]);
    const trackId = leerTrackId(res);
    if (!trackId) throw Object.assign(new Error(`El SII no entregó TrackID: ${res.slice(0, 300)}`), { respuesta: res.slice(0, 2000) });
    return { trackId, respuesta: res.slice(0, 2000) };
  }
  async function consultarEnvio(trackId, { boleta = false } = {}) {
    const res = await llamar('/api/v1/consulta/envio', { Certificado: certificado(), RutEmpresa: conf.emisor.rut, TrackId: Number(trackId), Ambiente: ambiente, ServidorBoletaREST: boleta }, [['files', archivoCert(), 'certificado.pfx']]);
    return { ...leerEstadoEnvio(res), respuesta: res.slice(0, 2000) };
  }
  return { faltante, generar, sobre, enviar, consultarEnvio, ambiente: conf.ambiente === 'produccion' ? 'produccion' : 'certificacion' };
}
