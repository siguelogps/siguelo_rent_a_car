// Importación y exportación de la flota en Excel (columnas en español). La misma planilla exportada sirve para importar.
import ExcelJS from 'exceljs';
import { q, uno } from '../db.js';
import { formatearPatente, normalizarPatente } from '../util/patente.js';
import { validarPatente, limpiar, esDuplicado } from './comun.js';

// [campo, encabezado, ancho, tipo, alias]
export const COLUMNAS = [
  ['patente', 'Patente', 11, 'texto'],
  ['marca', 'Marca', 14, 'texto'],
  ['modelo', 'Modelo', 16, 'texto'],
  ['anio', 'Año', 7, 'entero', ['ano', 'anio']],
  ['categoria', 'Categoría', 16, 'texto'],
  ['color', 'Color', 12, 'texto'],
  ['estado', 'Estado', 16, 'texto'],
  ['sucursal', 'Sucursal', 18, 'texto'],
  ['propietario', 'Propietario', 22, 'texto', ['inversionista']],
  ['km', 'Km', 10, 'entero', ['kilometraje']],
  ['combustible_tipo', 'Combustible', 12, 'texto'],
  ['transmision', 'Transmisión', 13, 'texto'],
  ['capacidad_estanque', 'Estanque (litros)', 10, 'entero', ['estanque']],
  ['vin', 'VIN (chasis)', 22, 'texto', ['vin', 'chasis', 'numero de chasis']],
  ['motor', 'N° motor', 16, 'texto', ['motor', 'numero de motor']],
  ['tag_numero', 'TAG', 18, 'texto'],
  ['venc_revision_tecnica', 'Revisión técnica (vence)', 14, 'fecha', ['revision tecnica']],
  ['venc_permiso_circulacion', 'Permiso de circulación (vence)', 14, 'fecha', ['permiso de circulacion', 'permiso circulacion']],
  ['venc_soap', 'SOAP (vence)', 14, 'fecha', ['soap']],
  ['venc_seguro', 'Seguro (vence)', 14, 'fecha', ['seguro']],
  ['seguro_compania', 'Compañía de seguro', 18, 'texto'],
  ['seguro_poliza', 'Póliza', 14, 'texto'],
  ['mant_cada_km', 'Mantención cada (km)', 12, 'entero'],
  ['mant_ultima_km', 'Última mantención (km)', 12, 'entero'],
  ['mant_cada_meses', 'Mantención cada (meses)', 12, 'entero'],
  ['mant_ultima_fecha', 'Última mantención (fecha)', 14, 'fecha'],
  ['gps_unidad_id', 'ID unidad GPS', 14, 'texto', ['unidad gps', 'gps']],
  ['notas', 'Notas', 30, 'texto']
];
const ESTADOS = { disponible: 'Disponible', arrendado: 'Arrendado', reservado: 'Reservado', mantencion: 'En mantención', fuera_servicio: 'Fuera de servicio' };
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[°º().]/g, '').replace(/\s+/g, ' ').trim();

export async function exportarFlota(empresaId) {
  const filas = await q(`SELECT v.*, c.nombre AS categoria, s.nombre AS sucursal, p.nombre AS propietario FROM vehiculos v
      LEFT JOIN categorias c ON c.id = v.categoria_id LEFT JOIN sucursales s ON s.id = v.sucursal_id LEFT JOIN propietarios p ON p.id = v.propietario_id
      WHERE v.empresa_id = $1 AND v.activo ORDER BY c.orden NULLS LAST, v.patente`, [empresaId]);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Síguelo Rentacar';
  const h = wb.addWorksheet('Flota', { views: [{ state: 'frozen', ySplit: 1 }] });
  h.columns = COLUMNAS.map(([key, header, width, tipo]) => ({ key, header, width, style: tipo === 'fecha' ? { numFmt: 'dd-mm-yyyy' } : tipo === 'entero' ? { numFmt: '#,##0' } : {} }));
  h.getRow(1).font = { bold: true };
  h.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD500' } };
  for (const v of filas) {
    const fila = {};
    for (const [k, , , tipo] of COLUMNAS) {
      let val = v[k];
      if (k === 'patente') val = formatearPatente(val);
      else if (k === 'estado') val = ESTADOS[val] || val;
      else if (tipo === 'fecha' && val) { const [a, m, d] = val.split('-').map(Number); val = new Date(Date.UTC(a, m - 1, d, 12)); }
      fila[k] = val ?? null;
    }
    h.addRow(fila);
  }
  h.getColumn('anio').numFmt = '0';
  return wb.xlsx.writeBuffer();
}

function valorCelda(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return valorCelda(v.result);
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;
    return null;
  }
  return v;
}

// → { filas, nuevas, actualizadas, categorias_creadas:[], errores:[{fila, patente, error}], avisos:[] }
export async function importarFlota(empresaId, buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw Object.assign(new Error('El archivo no es una planilla Excel (.xlsx) válida.'), { estado: 400 }); }
  const h = wb.worksheets[0];
  if (!h) throw Object.assign(new Error('La planilla está vacía.'), { estado: 400 });
  // Encabezados → campo
  const mapa = {};
  h.getRow(1).eachCell((c, col) => {
    const t = norm(valorCelda(c.value));
    const def = COLUMNAS.find(([k, enc, , , alias = []]) => norm(enc) === t || norm(k) === t || alias.map(norm).includes(t) || norm(enc).replace(/ vence$/, '') === t);
    if (def) mapa[col] = def;
  });
  if (!Object.values(mapa).some(([k]) => k === 'patente')) throw Object.assign(new Error('La planilla debe tener una columna «Patente».'), { estado: 400 });

  const [cats, sucs, props] = await Promise.all([
    q('SELECT id, nombre FROM categorias WHERE empresa_id = $1', [empresaId]),
    q('SELECT id, nombre FROM sucursales WHERE empresa_id = $1', [empresaId]),
    q('SELECT id, nombre FROM propietarios WHERE empresa_id = $1', [empresaId])
  ]);
  const buscar = (lista, nombre) => lista.find((x) => norm(x.nombre) === norm(nombre));
  const res = { filas: 0, nuevas: 0, actualizadas: 0, categorias_creadas: [], errores: [], avisos: [] };
  const tipos = Object.fromEntries(COLUMNAS.filter(([k]) => !['categoria', 'sucursal', 'propietario', 'estado'].includes(k)).map(([k, , , t]) => [k, t]));

  for (let i = 2; i <= h.rowCount; i++) {
    const row = h.getRow(i);
    const crudo = {};
    for (const [col, [k]] of Object.entries(mapa)) crudo[k] = valorCelda(row.getCell(Number(col)).value);
    if (Object.values(crudo).every((x) => x == null || String(x).trim() === '')) continue;
    res.filas++;
    try {
      const patente = validarPatente(crudo.patente);
      const datos = limpiar(crudo, tipos);
      delete datos.patente;
      for (const k of Object.keys(datos)) if (datos[k] == null) delete datos[k]; // celdas vacías no borran datos existentes
      if (crudo.categoria) {
        let c = buscar(cats, crudo.categoria);
        if (!c) {
          c = await uno('INSERT INTO categorias (empresa_id, nombre, orden) VALUES ($1,$2,$3) RETURNING id, nombre', [empresaId, String(crudo.categoria).trim(), cats.length]);
          cats.push(c); res.categorias_creadas.push(c.nombre);
        }
        datos.categoria_id = c.id;
      }
      if (crudo.sucursal) { const s = buscar(sucs, crudo.sucursal); if (s) datos.sucursal_id = s.id; else res.avisos.push(`Fila ${i}: la sucursal «${crudo.sucursal}» no existe; se dejó sin sucursal.`); }
      if (crudo.propietario) { const p = buscar(props, crudo.propietario); if (p) datos.propietario_id = p.id; else res.avisos.push(`Fila ${i}: el propietario «${crudo.propietario}» no existe; créalo en la pestaña Propietarios.`); }
      if (crudo.estado) {
        const e = Object.entries(ESTADOS).find(([k, n]) => norm(n) === norm(crudo.estado) || k === norm(crudo.estado).replace(/ /g, '_'));
        if (e) datos.estado = e[0];
      }
      if (datos.combustible_nivel != null && (datos.combustible_nivel < 0 || datos.combustible_nivel > 8)) delete datos.combustible_nivel;
      const existe = await uno('SELECT id FROM vehiculos WHERE empresa_id = $1 AND patente = $2', [empresaId, patente]);
      const cols = Object.keys(datos);
      if (existe) {
        if (cols.length) await q(`UPDATE vehiculos SET ${cols.map((c, j) => `${c} = $${j + 1}`).join(', ')}, activo = true WHERE id = $${cols.length + 1}`, [...cols.map((c) => datos[c]), existe.id]);
        res.actualizadas++;
      } else {
        await q(`INSERT INTO vehiculos (empresa_id, patente${cols.map((c) => `, ${c}`).join('')}) VALUES ($1, $2${cols.map((_, j) => `, $${j + 3}`).join('')})`, [empresaId, patente, ...cols.map((c) => datos[c])]);
        res.nuevas++;
      }
    } catch (e) {
      res.errores.push({ fila: i, patente: crudo.patente ? formatearPatente(normalizarPatente(crudo.patente)) : '', error: esDuplicado(e) ? 'Patente repetida' : e.message });
    }
  }
  return res;
}
