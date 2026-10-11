// Lectura de archivos de concesionarias y de multas: CSV (separador ; , o tabulación; UTF-8 o Latin-1) o Excel .xlsx.
// Detecta la fila de encabezados y sugiere qué columna corresponde a cada campo; el usuario confirma o ajusta
// el mapeo en pantalla antes de importar. También interpreta fechas, horas y montos chilenos.
import ExcelJS from 'exceljs';
import { desdeLocal } from '../util/formato.js';

// ── Campos por tipo de importación (orden = prioridad al detectar) ──
export const CAMPOS = {
  tag: [
    { clave: 'patente', etiqueta: 'Patente', requerido: true, claves: ['patente', 'placa', 'ppu', 'placa patente', 'matricula', 'vehiculo'] },
    { clave: 'fecha_hora', etiqueta: 'Fecha y hora (en una columna)', claves: ['fecha hora', 'fecha y hora', 'fechahora', 'fecha_hora', 'fecha/hora', 'fecha de transito', 'fecha transito', 'timestamp', 'fecha pasada', 'momento'] },
    { clave: 'fecha', etiqueta: 'Fecha', claves: ['fecha', 'dia', 'fecha paso'] },
    { clave: 'hora', etiqueta: 'Hora', claves: ['hora', 'hora paso', 'hora transito'] },
    { clave: 'portico', etiqueta: 'Pórtico / punto de cobro', claves: ['portico', 'punto de cobro', 'punto cobro', 'pto cobro', 'pto. cobro', 'plaza', 'peaje', 'punto', 'ubicacion', 'nombre portico', 'codigo portico'] },
    { clave: 'autopista', etiqueta: 'Autopista / concesionaria', claves: ['autopista', 'concesionaria', 'concesion', 'via', 'ruta', 'empresa'] },
    { clave: 'monto', etiqueta: 'Monto', requerido: true, claves: ['monto', 'valor', 'importe', 'total', 'tarifa', 'cobro', 'monto total', 'valor transito', 'precio', '$'] }
  ],
  multas: [
    { clave: 'patente', etiqueta: 'Patente', requerido: true, claves: ['patente', 'placa', 'ppu', 'matricula', 'vehiculo'] },
    { clave: 'fecha_hora', etiqueta: 'Fecha y hora (en una columna)', claves: ['fecha hora', 'fecha y hora', 'fechahora', 'fecha_hora', 'fecha/hora', 'fecha de la infraccion y hora'] },
    { clave: 'fecha', etiqueta: 'Fecha', requerido: true, claves: ['fecha', 'fecha infraccion', 'fecha de infraccion', 'fecha de la infraccion', 'dia'] },
    { clave: 'hora', etiqueta: 'Hora (si viene)', claves: ['hora', 'hora infraccion', 'hora de infraccion'] },
    { clave: 'motivo', etiqueta: 'Motivo / infracción', claves: ['motivo', 'infraccion', 'descripcion', 'detalle', 'tipo infraccion', 'causa infraccion', 'glosa'] },
    { clave: 'lugar', etiqueta: 'Lugar', claves: ['lugar', 'direccion', 'ubicacion', 'comuna', 'sitio'] },
    { clave: 'juzgado', etiqueta: 'Juzgado', claves: ['juzgado', 'jpl', 'tribunal', 'juzgado de policia local'] },
    { clave: 'rol_causa', etiqueta: 'Rol / causa', claves: ['rol', 'causa', 'rol causa', 'rol/causa', 'n causa', 'numero causa', 'n° causa', 'nro causa', 'expediente'] },
    { clave: 'monto', etiqueta: 'Monto', claves: ['monto', 'valor', 'importe', 'total', 'multa', 'monto multa', 'utm'] }
  ]
};

const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_.\-:°º#]+/g, ' ').replace(/\s+/g, ' ').trim();

// ── CSV ──
export function decodificar(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const sinBom = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? b.subarray(3) : b;
  try { return { texto: new TextDecoder('utf-8', { fatal: true }).decode(sinBom), codificacion: 'utf-8' }; }
  catch { return { texto: new TextDecoder('latin1').decode(sinBom), codificacion: 'latin-1' }; }
}

function contarFuera(linea, c) { let n = 0, comillas = false; for (const ch of linea) { if (ch === '"') comillas = !comillas; else if (ch === c && !comillas) n++; } return n; }
export function detectarSeparador(texto) {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim()).slice(0, 15);
  let mejor = ';', puntaje = -1;
  for (const c of [';', ',', '\t', '|']) {
    const cuentas = lineas.map((l) => contarFuera(l, c));
    const max = Math.max(0, ...cuentas);
    // el separador correcto aparece en casi todas las líneas con la misma cantidad
    const p = max ? cuentas.filter((x) => x === max).length * 100 + max : 0;
    if (p > puntaje) { puntaje = p; mejor = c; }
  }
  return mejor;
}

export function parsearCsv(texto, sep = detectarSeparador(texto)) {
  const filas = [];
  let fila = [], campo = '', comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (comillas) {
      if (ch === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false; }
      else campo += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) { fila.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else campo += ch;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.map((f) => f.map((c) => c.trim())).filter((f) => f.some((c) => c !== ''));
}

// ── Excel ──
function valorCelda(v) {
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.result !== undefined) return valorCelda(v.result);
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text !== undefined) return String(v.text);
    if (v.hyperlink) return String(v.text || v.hyperlink);
    return String(v);
  }
  return v;
}
export async function leerExcel(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
  const hoja = wb.worksheets.find((h) => h.actualRowCount > 0) || wb.worksheets[0];
  if (!hoja) return [];
  const filas = [];
  hoja.eachRow({ includeEmpty: false }, (row) => {
    const f = [];
    for (let c = 1; c <= row.cellCount; c++) f.push(valorCelda(row.getCell(c).value));
    if (f.some((x) => x !== '' && x != null)) filas.push(f.map((x) => (typeof x === 'string' ? x.trim() : x)));
  });
  return filas;
}

// Archivo (Buffer) + nombre → { filas: [[...]], formato, codificacion, separador }
export async function leerArchivo(buf, nombre = '') {
  const esXlsx = /\.xlsx$/i.test(nombre) || (buf[0] === 0x50 && buf[1] === 0x4b); // «PK» = zip
  if (esXlsx) return { filas: await leerExcel(buf), formato: 'excel' };
  if (/\.xls$/i.test(nombre)) throw new Error('El formato .xls antiguo no se puede leer: guárdalo como .xlsx o .csv');
  const { texto, codificacion } = decodificar(buf);
  const separador = detectarSeparador(texto);
  return { filas: parsearCsv(texto, separador), formato: 'csv', codificacion, separador };
}

// ── Detección de columnas ──
function puntaje(enc, claves) {
  const e = normalizar(enc);
  if (!e) return 0;
  let mejor = 0;
  for (const k of claves) {
    const n = normalizar(k);
    if (!n) continue;
    if (e === n) mejor = Math.max(mejor, 3);
    else if (n.length >= 3 && (e.startsWith(`${n} `) || e.endsWith(` ${n}`) || e.split(' ').includes(n))) mejor = Math.max(mejor, 2);
    else if (n.length >= 4 && e.includes(n)) mejor = Math.max(mejor, 1);
  }
  return mejor;
}

export function detectarColumnas(encabezados, tipo) {
  const campos = CAMPOS[tipo];
  const mapeo = Object.fromEntries(campos.map((c) => [c.clave, null]));
  const usadas = new Set();
  // fecha y hora juntas: el encabezado nombra ambas
  encabezados.forEach((h, i) => { const n = normalizar(h); if (mapeo.fecha_hora == null && /fecha/.test(n) && /hora/.test(n)) { mapeo.fecha_hora = i; usadas.add(i); } });
  for (const c of campos) {
    if (mapeo[c.clave] != null) continue;
    let mejor = null, mp = 0;
    encabezados.forEach((h, i) => { if (usadas.has(i)) return; const p = puntaje(h, c.claves); if (p > mp) { mp = p; mejor = i; } });
    if (mejor != null && (mp >= 2 || (mp === 1 && c.clave !== 'fecha_hora'))) { mapeo[c.clave] = mejor; usadas.add(mejor); }
  }
  return mapeo;
}

// Busca la fila de encabezados entre las primeras 15 (los archivos de concesionarias traen títulos arriba).
export function analizar(filas, tipo) {
  let mejor = { indice: 0, n: -1, mapeo: null };
  for (let i = 0; i < Math.min(filas.length, 15); i++) {
    const enc = filas[i].map((x) => (x instanceof Date ? '' : String(x ?? '')));
    const m = detectarColumnas(enc, tipo);
    const n = Object.values(m).filter((x) => x != null).length;
    if (n > mejor.n) mejor = { indice: i, n, mapeo: m };
  }
  const encabezados = (filas[mejor.indice] || []).map((x, i) => String(x ?? '').trim() || `Columna ${i + 1}`);
  return { fila_encabezados: mejor.indice, encabezados, mapeo: mejor.mapeo || detectarColumnas([], tipo), datos: filas.slice(mejor.indice + 1) };
}

// ── Valores ──
const pad = (n) => String(n).padStart(2, '0');
// Fecha (texto, Date de Excel o número de serie) → { fecha: 'aaaa-mm-dd', hora: 'HH:MM:SS' | null }
export function parsearFecha(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // exceljs entrega la hora «de pared» de la celda como si fuera UTC
    const h = v.getUTCHours(), mi = v.getUTCMinutes(), s = v.getUTCSeconds();
    return { fecha: `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`, hora: h || mi || s ? `${pad(h)}:${pad(mi)}:${pad(s)}` : null };
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) return parsearFecha(new Date(Math.round((v - 25569) * 864e5)));
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  let a, mo, d, h = null, mi, se;
  if (m) [, a, mo, d, h, mi, se] = m;
  else {
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return null;
    [, d, mo, a, h, mi, se] = m;
    if (a.length === 2) a = `20${a}`;
  }
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
  return { fecha: `${a}-${pad(mo)}-${pad(d)}`, hora: h != null ? `${pad(h)}:${mi}:${pad(se || 0)}` : null };
}

export function parsearHora(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`;
  if (typeof v === 'number' && v >= 0 && v < 1) { const t = Math.round(v * 86400); return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`; }
  const m = String(v).trim().match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i);
  if (!m) return null;
  let h = Number(m[1]);
  if (m[4]) { const pm = /p/i.test(m[4]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  if (h > 23 || Number(m[2]) > 59) return null;
  return `${pad(h)}:${m[2]}:${pad(m[3] || 0)}`;
}

// «$1.234», «1.234,50», «1234», 1234.4 → entero CLP
export function parsearMonto(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  let s = String(v).replace(/[$\s]|CLP/gi, '');
  if (!s) return null;
  const neg = /^-|^\(.*\)$/.test(s);
  s = s.replace(/[()-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(neg ? -n : n) : null;
}

// Fecha + hora locales de Chile → Date. Sin hora: 00:00 (hora_conocida = false).
export function aInstante(fechaIso, hora) { return desdeLocal(fechaIso, hora || '00:00:00'); }

// Fila + mapeo → registro normalizado para importar (o { error })
export function filaARegistro(fila, mapeo, tipo) {
  const val = (k) => (mapeo[k] != null && mapeo[k] !== '' ? fila[Number(mapeo[k])] : undefined);
  const patente = String(val('patente') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!patente) return { error: 'Sin patente' };
  let f = parsearFecha(val('fecha_hora') ?? val('fecha'));
  if (!f) return { error: `Fecha no reconocida: «${String(val('fecha_hora') ?? val('fecha') ?? '')}»` };
  const hora = parsearHora(val('hora')) || f.hora;
  const monto = parsearMonto(val('monto'));
  if (tipo === 'tag') {
    if (monto == null) return { error: `Monto no reconocido: «${String(val('monto') ?? '')}»` };
    if (!hora) return { error: 'El tránsito TAG no trae hora' };
    return { patente, fecha_hora: aInstante(f.fecha, hora), portico: String(val('portico') ?? '').trim() || null, autopista: String(val('autopista') ?? '').trim() || null, monto };
  }
  return {
    patente, fecha_infraccion: aInstante(f.fecha, hora), hora_conocida: !!hora,
    motivo: String(val('motivo') ?? '').trim() || null, lugar: String(val('lugar') ?? '').trim() || null,
    juzgado: String(val('juzgado') ?? '').trim() || null, rol_causa: String(val('rol_causa') ?? '').trim() || null, monto: monto ?? 0
  };
}
