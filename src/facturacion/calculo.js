// Cálculos de documentos tributarios sin efectos (igual que en el CRM Síguelo Gestión, adaptado al rentacar):
// los montos del rentacar vienen con IVA incluido; la boleta (39) lleva precios con IVA y la factura (33) precios netos.
export const IVA = 0.19;
export const TIPOS_DTE = { 39: 'Boleta electrónica', 33: 'Factura electrónica', 61: 'Nota de crédito electrónica' };
export const TIPOS_DTE_CORTO = { 39: 'Boleta', 33: 'Factura', 61: 'Nota de crédito' };
export const ESTADOS_DTE = { pendiente: 'Pendiente', retenido: 'Retenido', emitido: 'Enviado al SII', aceptado: 'Aceptado', reparos: 'Aceptado con reparos', rechazado: 'Rechazado', error: 'Error' };
export const RUT_CONSUMIDOR_FINAL = '66666666-6';
// Código de referencia de una nota de crédito (SII): 1 anula, 2 corrige texto, 3 corrige montos.
export const CODIGOS_REFERENCIA = { 1: 'Anula el documento', 2: 'Corrige texto', 3: 'Corrige montos' };

// Total con IVA incluido → { neto, iva, total }
export function desglosar(total) {
  const t = Math.round(Number(total) || 0);
  const neto = Math.round(t / (1 + IVA));
  return { neto, iva: t - neto, exento: 0, total: t };
}

// Líneas con IVA incluido → líneas del documento y totales.
// Boleta: se mantienen con IVA. Factura y nota de crédito: precios netos; el último ajuste de redondeo va en la línea mayor
// para que neto + IVA = total exacto del rentacar.
export function armarLineas(lineas, tipo) {
  const ls = lineas.filter((l) => Math.round(Number(l.monto) || 0) > 0).map((l) => ({ nombre: l.nombre || l.concepto, descripcion: l.descripcion || l.calculo || '', cantidad: 1, monto: Math.round(Number(l.monto)) }));
  const total = ls.reduce((s, l) => s + l.monto, 0);
  const tot = desglosar(total);
  if (Number(tipo) === 39) return { lineas: ls.map((l) => ({ ...l, precio: l.monto })), ...tot };
  const netas = ls.map((l) => ({ ...l, monto: Math.round(l.monto / (1 + IVA)) }));
  const dif = tot.neto - netas.reduce((s, l) => s + l.monto, 0);
  if (dif && netas.length) { const i = netas.reduce((m, l, k) => (l.monto > netas[m].monto ? k : m), 0); netas[i].monto += dif; }
  return { lineas: netas.map((l) => ({ ...l, precio: l.monto })), ...tot };
}

// Texto apto para el SII: sin emojis ni caracteres de control, largo máximo.
export const textoSII = (s, max = 80) => String(s ?? '').normalize('NFC').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/[^\p{L}\p{N}\p{P}\p{Zs}$+<=>^`|~°ºª]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max);

// CAF del SII: tipo, rango de folios y RUT emisor.
const valor = (xml, etiqueta) => xml.match(new RegExp(`<${etiqueta}>\\s*([^<]*?)\\s*</${etiqueta}>`))?.[1] ?? null;
export function leerCaf(texto) {
  const xml = String(texto || '');
  if (!/<AUTORIZACION[\s>]/.test(xml) || !/<CAF[\s>]/.test(xml)) throw Object.assign(new Error('El archivo no es un CAF del SII (falta <AUTORIZACION> / <CAF>)'), { estado: 400 });
  const tipo = Number(valor(xml, 'TD'));
  const desde = Number(xml.match(/<RNG>\s*<D>\s*(\d+)\s*<\/D>/)?.[1]);
  const hasta = Number(xml.match(/<H>\s*(\d+)\s*<\/H>\s*<\/RNG>/)?.[1]);
  const rut = valor(xml, 'RE');
  if (!tipo || !desde || !hasta || hasta < desde || !rut) throw Object.assign(new Error('El CAF no trae tipo de documento, RUT o rango de folios legibles'), { estado: 400 });
  const idk = valor(xml, 'IDK');
  return { tipo, desde, hasta, rut: rut.toUpperCase(), fechaAutorizacion: valor(xml, 'FA'), ambiente: idk === '100' ? 'certificacion' : 'produccion' };
}
