// PDF con pdfkit (Helvetica): utilidades comunes y representación impresa del documento tributario.
import PDFDocument from 'pdfkit';
import { leerArchivo } from '../almacenamiento/index.js';
import { clp, fecha } from '../util/formato.js';
import { formatearRut } from '../util/rut.js';
import { TIPOS_DTE, ESTADOS_DTE } from './calculo.js';

// Helvetica (WinAnsi) no trae algunos signos: se reemplazan por equivalentes.
export const txt = (s) => String(s ?? '').replace(/[−–—]/g, '-').replace(/≈/g, '~').replace(/→/g, '->').replace(/[·•]/g, '·').replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '');

export function nuevoPdf() {
  const doc = new PDFDocument({ size: 'LETTER', margin: 42, info: { Producer: 'Síguelo Rentacar' } });
  const partes = [];
  doc.on('data', (c) => partes.push(c));
  const listo = new Promise((ok) => doc.on('end', () => ok(Buffer.concat(partes))));
  return { doc, terminar: () => { doc.end(); return listo; } };
}

export async function logoEmpresa(empresa) {
  if (!empresa?.logo_clave) return null;
  try { const a = await leerArchivo(empresa.id, Number(empresa.logo_clave)); return a && /png|jpe?g/.test(a.fila.mime || '') ? a.datos : null; } catch { return null; }
}

// Encabezado: logo / nombre de la empresa a la izquierda, recuadro con título a la derecha.
export async function encabezado(doc, empresa, { titulo, subtitulo = '', rojo = false }) {
  const logo = await logoEmpresa(empresa);
  const x0 = doc.page.margins.left, ancho = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  if (logo) { try { doc.image(logo, x0, 40, { fit: [120, 50] }); } catch { /* imagen no soportada */ } }
  const xt = logo ? x0 + 130 : x0;
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#14181E').text(txt(empresa.razon_social || empresa.nombre), xt, 42, { width: 250 });
  doc.font('Helvetica').fontSize(8.5).fillColor('#5B6472')
    .text(txt([empresa.giro, [empresa.direccion, empresa.comuna].filter(Boolean).join(', '), empresa.telefono, empresa.correo].filter(Boolean).join('\n')), xt, doc.y + 2, { width: 250 });
  const bx = x0 + ancho - 190;
  doc.lineWidth(1.5).strokeColor(rojo ? '#C8102E' : '#14181E').rect(bx, 40, 190, 70).stroke();
  doc.fillColor(rojo ? '#C8102E' : '#14181E').font('Helvetica-Bold').fontSize(10).text(empresa.rut ? `R.U.T.: ${formatearRut(empresa.rut)}` : '', bx, 50, { width: 190, align: 'center' });
  doc.fontSize(11).text(txt(titulo), bx, 66, { width: 190, align: 'center' });
  doc.fontSize(10).text(txt(subtitulo), bx, 86, { width: 190, align: 'center' });
  doc.fillColor('#14181E');
  doc.y = 125;
}

// Tabla simple: columnas [{titulo, ancho, alinear}] y filas de textos.
export function tabla(doc, columnas, filas, { negritaUltima = false } = {}) {
  const x0 = doc.page.margins.left;
  let y = doc.y;
  const dibujarCab = () => {
    doc.rect(x0, y, columnas.reduce((s, c) => s + c.ancho, 0), 18).fill('#F1F2F4');
    let x = x0;
    doc.fillColor('#5B6472').font('Helvetica-Bold').fontSize(8);
    for (const c of columnas) { doc.text(txt(c.titulo), x + 5, y + 5, { width: c.ancho - 10, align: c.alinear || 'left' }); x += c.ancho; }
    y += 20;
  };
  dibujarCab();
  filas.forEach((f, i) => {
    const neg = negritaUltima && i === filas.length - 1;
    doc.font(neg ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#14181E');
    const alto = Math.max(...columnas.map((c, k) => doc.heightOfString(txt(f[k]), { width: c.ancho - 10 }))) + 8;
    if (y + alto > doc.page.height - 70) { doc.addPage(); y = doc.page.margins.top; dibujarCab(); doc.font(neg ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#14181E'); }
    let x = x0;
    columnas.forEach((c, k) => { doc.fillColor(f.color?.[k] || '#14181E').text(txt(f[k]), x + 5, y + 4, { width: c.ancho - 10, align: c.alinear || 'left' }); x += c.ancho; });
    y += alto;
    doc.moveTo(x0, y).lineTo(x0 + columnas.reduce((s, c) => s + c.ancho, 0), y).lineWidth(0.5).strokeColor('#E3E6EA').stroke();
  });
  doc.y = y + 8;
  doc.x = x0;
}

export async function pdfDte(empresa, d) {
  const { doc, terminar } = nuevoPdf();
  const valido = ['emitido', 'aceptado', 'reparos'].includes(d.estado);
  await encabezado(doc, empresa, { titulo: (TIPOS_DTE[d.tipo] || 'Documento').toUpperCase(), subtitulo: d.folio ? `N° ${d.folio}` : 'Sin folio', rojo: true });
  const r = d.receptor || {};
  doc.font('Helvetica').fontSize(9.5).fillColor('#14181E');
  const filasRec = [['Señor(es)', r.razonSocial], ['R.U.T.', r.rut ? formatearRut(r.rut) : ''], ['Giro', r.giro], ['Dirección', [r.direccion, r.comuna].filter(Boolean).join(', ')], ['Fecha', fecha(d.emitido_en || d.creado_en)]].filter(([, v]) => v);
  for (const [k, v] of filasRec) { doc.font('Helvetica-Bold').text(`${k}: `, { continued: true }).font('Helvetica').text(txt(v)); }
  doc.moveDown(0.8);
  const boleta = d.tipo === 39;
  tabla(doc, [{ titulo: 'Detalle', ancho: 360 }, { titulo: 'Cant.', ancho: 50, alinear: 'right' }, { titulo: boleta ? 'Monto (IVA incl.)' : 'Monto neto', ancho: 118, alinear: 'right' }],
    (d.lineas || []).map((l) => [`${l.nombre}${l.descripcion ? `\n${l.descripcion}` : ''}`, String(l.cantidad || 1), clp(l.monto)]));
  const x = doc.page.width - doc.page.margins.right - 220;
  const tot = [['Monto neto', clp(d.neto)], ['IVA (19 %)', clp(d.iva)], ['Total', clp(d.total)]];
  for (const [k, v] of tot) { doc.font(k === 'Total' ? 'Helvetica-Bold' : 'Helvetica').fontSize(k === 'Total' ? 11 : 9.5).text(k, x, doc.y, { width: 110, continued: false }); doc.moveUp().text(v, x + 110, doc.y, { width: 110, align: 'right' }); }
  doc.moveDown(2);
  doc.x = doc.page.margins.left;
  doc.font('Helvetica').fontSize(8.5).fillColor(valido ? '#5B6472' : '#C8102E')
    .text(txt(valido ? `Documento enviado al SII · TrackID ${d.track_id || '-'}${d.respuesta?.simulado ? ' · datos de prueba' : ''}. Verifique en www.sii.cl` : `Representación sin validez tributaria · estado: ${ESTADOS_DTE[d.estado] || d.estado}${d.mensaje ? ` · ${d.mensaje}` : ''}`), { width: 528 });
  return terminar();
}
