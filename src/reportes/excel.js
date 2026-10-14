// Exportación de los reportes a Excel (exceljs): encabezados en español, montos CLP, fechas dd-mm-aaaa.
import ExcelJS from 'exceljs';
import { formatearPatente } from '../util/patente.js';
import { formatearRut } from '../util/rut.js';

const CLP = '"$"#,##0';
const PCT = '0.0%';
const DEC = '#,##0.0';
const FECHA = 'dd-mm-yyyy';
const FECHA_HORA = 'dd-mm-yyyy hh:mm';

// Excel no tiene zona horaria: las fechas se escriben como hora local de Chile.
const local = (v) => {
  if (!v) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(v)).map((x) => [x.type, x.value]));
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute));
};
const dia = (s) => new Date(`${s}T00:00:00Z`);
const doc = (tipo, d) => (tipo === 'rut' ? formatearRut(d) : `${tipo === 'pasaporte' ? 'Pasaporte' : 'DNI'} ${d}`);
const CLASES = { a_tiempo: 'A tiempo', atraso_leve: 'Atraso < 3 h', atraso_grave: 'Atraso ≥ 3 h' };

// Definición de cada tabla exportable: nombre de archivo → { hoja, columnas: [{ titulo, clave, ancho, formato }], filas(rep) }
export const TABLAS = {
  'ingreso-diario': {
    hoja: 'Ingreso por día',
    columnas: [{ titulo: 'Fecha', clave: 'fecha', ancho: 14, formato: FECHA }, { titulo: 'Ingreso', clave: 'ingreso', ancho: 16, formato: CLP }, { titulo: 'Ocupación', clave: 'ocupacion', ancho: 12, formato: PCT }],
    filas: (r) => r.ingreso_diario.map((d) => ({ fecha: dia(d.dia), ingreso: d.ingreso, ocupacion: d.ocupacion }))
  },
  'ocupacion-categoria': {
    hoja: 'Ocupación por categoría',
    columnas: [
      { titulo: 'Categoría', clave: 'categoria', ancho: 22 }, { titulo: 'Vehículos', clave: 'vehiculos', ancho: 11 }, { titulo: 'Días-vehículo', clave: 'dias_vehiculo', ancho: 14, formato: '#,##0' },
      { titulo: 'Días arrendado', clave: 'dias_arrendado', ancho: 15, formato: DEC }, { titulo: 'Días en mantención', clave: 'dias_mantencion', ancho: 18, formato: DEC },
      { titulo: 'Días ociosos', clave: 'dias_ociosos', ancho: 13, formato: DEC }, { titulo: 'Ocupación', clave: 'ocupacion', ancho: 12, formato: PCT }
    ],
    filas: (r) => r.por_categoria
  },
  'ocupacion-vehiculos': {
    hoja: 'Ocupación por vehículo y día',
    columnas: (r) => [{ titulo: 'Patente', clave: 'patente', ancho: 12 }, ...r.calor.columnas.map((c, i) => ({ titulo: r.calor.unidad === 'dia' ? c.desde.slice(8, 10) + '-' + c.desde.slice(5, 7) : `Sem. ${c.desde.slice(8, 10)}-${c.desde.slice(5, 7)}`, clave: `c${i}`, ancho: 7, formato: '0%' }))],
    filas: (r) => r.calor.filas.map((f) => ({ patente: formatearPatente(f.patente), ...Object.fromEntries(f.celdas.map((c, i) => [`c${i}`, c.man >= 0.5 ? 'Mant.' : c.arr])) }))
  },
  'ingreso-vehiculo': {
    hoja: 'Ingreso por vehículo',
    columnas: [
      { titulo: 'Patente', clave: 'patente', ancho: 12 }, { titulo: 'Vehículo', clave: 'vehiculo', ancho: 24 }, { titulo: 'Categoría', clave: 'categoria', ancho: 16 }, { titulo: 'Sucursal', clave: 'sucursal', ancho: 18 },
      { titulo: 'Días arrendado', clave: 'dias_arrendado', ancho: 15, formato: DEC }, { titulo: 'Días ociosos', clave: 'dias_ociosos', ancho: 13, formato: DEC },
      { titulo: 'Días en mantención', clave: 'dias_mantencion', ancho: 18, formato: DEC }, { titulo: 'Ocupación', clave: 'ocupacion', ancho: 12, formato: PCT },
      { titulo: 'Ingreso', clave: 'ingreso', ancho: 15, formato: CLP }, { titulo: 'Ingreso por día disponible', clave: 'por_dia_disponible', ancho: 24, formato: CLP },
      { titulo: 'Costo de mantención', clave: 'mantencion_costo', ancho: 19, formato: CLP }
    ],
    filas: (r) => r.por_vehiculo.map((v) => ({ ...v, patente: formatearPatente(v.patente), vehiculo: `${v.marca || ''} ${v.modelo || ''}`.trim() }))
  },
  'danos-cliente': {
    hoja: 'Daños por cliente',
    columnas: [
      { titulo: 'Cliente', clave: 'cliente', ancho: 30 }, { titulo: 'Documento', clave: 'documento', ancho: 20 }, { titulo: 'Arriendos (12 meses)', clave: 'arriendos', ancho: 20 },
      { titulo: 'Incidentes', clave: 'incidentes', ancho: 12 }, { titulo: 'Monto a cobrar', clave: 'por_cobrar', ancho: 16, formato: CLP }, { titulo: 'Cobrado', clave: 'cobrado', ancho: 15, formato: CLP }
    ],
    filas: (r) => r.danos_por_cliente.map((d) => ({ ...d, documento: doc(d.documento_tipo, d.documento) }))
  },
  devoluciones: {
    hoja: 'Devoluciones',
    columnas: [
      { titulo: 'Folio', clave: 'folio', ancho: 12 }, { titulo: 'Patente', clave: 'patente', ancho: 12 }, { titulo: 'Cliente', clave: 'cliente', ancho: 28 },
      { titulo: 'Devolución pactada', clave: 'fin', ancho: 19, formato: FECHA_HORA }, { titulo: 'Devolución real', clave: 'devolucion_real', ancho: 19, formato: FECHA_HORA },
      { titulo: 'Atraso (min)', clave: 'atraso_min', ancho: 13, formato: '#,##0' }, { titulo: 'Resultado', clave: 'resultado', ancho: 22 }
    ],
    filas: (r) => [
      ...r.devoluciones.detalle.map((d) => ({ ...d, patente: d.patente ? formatearPatente(d.patente) : '', fin: local(d.fin), devolucion_real: local(d.devolucion_real), resultado: CLASES[d.clase] + (d.pendiente ? ' (aún no devuelve)' : '') })),
      ...r.devoluciones.no_shows.map((d) => ({ folio: d.folio, patente: d.patente ? formatearPatente(d.patente) : '', cliente: d.cliente, fin: local(d.inicio), devolucion_real: null, atraso_min: null, resultado: 'No se presentó' }))
    ]
  }
};

function agregarHoja(libro, def, rep) {
  const ws = libro.addWorksheet(def.hoja.slice(0, 31));
  const columnas = typeof def.columnas === 'function' ? def.columnas(rep) : def.columnas;
  ws.columns = columnas.map((c) => ({ header: c.titulo, key: c.clave, width: c.ancho || 14, style: c.formato ? { numFmt: c.formato } : {} }));
  for (const f of def.filas(rep)) ws.addRow(f);
  const cab = ws.getRow(1);
  cab.font = { bold: true, color: { argb: 'FF15181D' } };
  cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD500' } };
  cab.alignment = { vertical: 'middle' };
  cab.height = 20;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return ws;
}

function hojaResumen(libro, rep, empresa) {
  const ws = libro.addWorksheet('Resumen');
  ws.columns = [{ width: 34 }, { width: 22 }];
  const k = rep.kpis;
  ws.addRow([`Reportes · ${empresa}`]).font = { bold: true, size: 14 };
  ws.addRow([`Período: ${rep.periodo.etiqueta}`]);
  ws.addRow([`Vehículos: ${rep.vehiculos} · Días del período: ${rep.dias}`]);
  ws.addRow([]);
  const filas = [
    ['Ocupación', k.ocupacion, PCT], ['Ingreso del período', k.ingreso, CLP], ['  de ello, cargos de liquidaciones', k.ingreso_cargos, CLP],
    ['Días disponibles', k.dias_disponibles, '#,##0'], ['Ingreso por día disponible', k.ingreso_por_dia_disponible, CLP], ['Días ociosos', k.dias_ociosos, '#,##0'],
    ['Costo de mantención', k.costo_mantencion, CLP], ['Órdenes de trabajo terminadas', k.ordenes_trabajo, '#,##0'],
    ['Devoluciones a tiempo', k.devoluciones_a_tiempo ?? '—', PCT], ['Devoluciones del período', k.devoluciones_total, '#,##0'], ['No se presentó', k.no_show, '#,##0']
  ];
  const cab = ws.addRow(['Indicador', 'Valor']);
  cab.font = { bold: true }; cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD500' } };
  for (const [t, v, fmt] of filas) { const row = ws.addRow([t, v]); row.getCell(2).numFmt = fmt; }
  return ws;
}

export async function libroDe(rep, nombre, empresa = '') {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Síguelo On Rent';
  libro.created = new Date();
  if (nombre === 'completo') {
    hojaResumen(libro, rep, empresa);
    for (const def of Object.values(TABLAS)) agregarHoja(libro, def, rep);
  } else {
    agregarHoja(libro, TABLAS[nombre], rep);
  }
  return libro.xlsx.writeBuffer();
}
