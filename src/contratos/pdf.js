// PDF del contrato con pdfkit (Helvetica: las fuentes IBM Plex del proyecto vienen solo en woff2).
// Encabezado con el logo de la empresa (o su nombre), texto del contrato, bloque de firma, QR de verificación
// y pie pequeño «Documento generado con Síguelo Rent a Car».
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { fechaHora } from '../util/formato.js';
import { formatearRut } from '../util/rut.js';

// Helvetica estándar usa WinAnsi: se reemplazan los caracteres que no tiene.
const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export const limpiarTexto = (s) => String(s ?? '')
  .replace(/[−‐‑]/g, '-').replace(/→/g, '->').replace(/[✓✔]/g, 'OK').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/ /g, ' ')
  .replace(/[^\n\x20-\xFF]/g, (c) => (WINANSI_EXTRA.includes(c) ? c : ''));

const TINTA = '#15181D', GRIS = '#5B6370', LINEA = '#E2E5EA';

/**
 * construirPdf({ contrato, empresa, logo, firma, urlVerificacion }) → Buffer
 * contrato: fila de contratos (folio, contenido, estado, firmante_nombre, firmante_documento, firmado_en, firmado_ip, codigo_verificacion)
 * logo / firma: Buffer PNG/JPEG o null. Sin firma se marca como «VISTA PREVIA · pendiente de firma».
 */
export async function construirPdf({ contrato, empresa, logo = null, firma = null, urlVerificacion }) {
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 50, bottom: 60, left: 56, right: 56 }, bufferPages: true,
    info: { Title: `Contrato ${contrato.folio}`, Author: limpiarTexto(empresa.razon_social || empresa.nombre), Creator: 'Síguelo Rent a Car', Subject: 'Contrato de arriendo de vehículo' } });
  const partes = [];
  doc.on('data', (c) => partes.push(c));
  const fin = new Promise((ok) => doc.on('end', () => ok(Buffer.concat(partes))));
  const W = doc.page.width - doc.page.margins.left - doc.page.margins.right, X = doc.page.margins.left;

  // Encabezado
  const y0 = doc.y;
  let logoOk = false;
  if (logo) { try { doc.image(logo, X, y0, { fit: [150, 46] }); logoOk = true; } catch { logoOk = false; } }
  if (!logoOk) doc.font('Helvetica-Bold').fontSize(16).fillColor(TINTA).text(limpiarTexto(empresa.nombre), X, y0 + 8, { width: W / 2 });
  doc.font('Helvetica').fontSize(9).fillColor(GRIS).text('Contrato de arriendo', X + W / 2, y0 + 4, { width: W / 2, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(14).fillColor(TINTA).text(`N° ${contrato.folio}`, X + W / 2, y0 + 16, { width: W / 2, align: 'right' });
  const datosEmp = [empresa.razon_social || empresa.nombre, empresa.rut ? `RUT ${formatearRut(empresa.rut)}` : null, [empresa.direccion, empresa.comuna].filter(Boolean).join(', '), empresa.telefono].filter(Boolean).join(' · ');
  doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text(limpiarTexto(datosEmp), X, y0 + 54, { width: W });
  doc.moveTo(X, doc.y + 6).lineTo(X + W, doc.y + 6).lineWidth(1).strokeColor(LINEA).stroke();
  doc.y += 16;

  if (contrato.estado !== 'firmado') {
    doc.save().roundedRect(X, doc.y, W, 22, 4).fill('#FFF7CC').restore();
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#6B4A00').text('VISTA PREVIA · pendiente de firma del arrendatario', X + 10, doc.y + 7, { width: W - 20 });
    doc.y += 12;
  }
  if (contrato.estado === 'anulado') {
    doc.save().roundedRect(X, doc.y, W, 22, 4).fill('#FDECEA').restore();
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#8F1B12').text(`CONTRATO ANULADO${contrato.anulado_motivo ? ` · ${limpiarTexto(contrato.anulado_motivo)}` : ''}`, X + 10, doc.y + 7, { width: W - 20 });
    doc.y += 12;
  }

  // Texto del contrato: primera línea como título; «PRIMERO · VEHÍCULO.» en negrita
  const parrafos = limpiarTexto(contrato.contenido).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  parrafos.forEach((p, i) => {
    if (i === 0) {
      doc.font('Helvetica-Bold').fontSize(12).fillColor(TINTA).text(p, X, doc.y, { width: W, align: 'center' });
      doc.moveDown(0.8);
      return;
    }
    const m = p.match(/^([A-ZÁÉÍÓÚÑ]+ · [A-ZÁÉÍÓÚÑ ,Y]+\.)\s+([\s\S]*)$/);
    doc.fontSize(9.5).fillColor(TINTA);
    if (m) {
      doc.font('Helvetica-Bold').text(`${m[1]} `, X, doc.y, { width: W, align: 'justify', continued: true, lineGap: 1.5 });
      doc.font('Helvetica').text(m[2], { width: W, align: 'justify', lineGap: 1.5 });
    } else doc.font('Helvetica').text(p, X, doc.y, { width: W, align: 'justify', lineGap: 1.5 });
    doc.moveDown(0.6);
  });

  // Bloque de firma + QR
  const alto = 150;
  if (doc.y + alto > doc.page.height - doc.page.margins.bottom) doc.addPage();
  const yf = doc.y + 8;
  const anchoFirma = W - 150;
  doc.save().roundedRect(X, yf, anchoFirma, alto - 10, 6).lineWidth(1).strokeColor(LINEA).stroke().restore();
  doc.font('Helvetica').fontSize(8).fillColor(GRIS).text('Firma del arrendatario', X + 12, yf + 10);
  if (firma) { try { doc.image(firma, X + 12, yf + 22, { fit: [anchoFirma - 24, 62] }); } catch { /* firma ilegible */ } }
  else doc.font('Helvetica-Oblique').fontSize(10).fillColor('#9AA1AD').text('Pendiente de firma', X + 12, yf + 48);
  doc.moveTo(X + 12, yf + 88).lineTo(X + anchoFirma - 12, yf + 88).lineWidth(0.7).strokeColor('#9AA1AD').stroke();
  const firmante = contrato.firmante_nombre ? limpiarTexto(contrato.firmante_nombre) : '—';
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(TINTA).text(firmante, X + 12, yf + 94, { width: anchoFirma - 24 });
  const det = [contrato.firmante_documento ? `Documento ${limpiarTexto(contrato.firmante_documento)}` : null,
    contrato.firmado_en ? `Firmado electrónicamente el ${fechaHora(contrato.firmado_en)} (hora de Chile)` : null, contrato.firmado_ip ? `IP ${contrato.firmado_ip}` : null].filter(Boolean).join(' · ');
  doc.font('Helvetica').fontSize(8).fillColor(GRIS).text(limpiarTexto(det), X + 12, yf + 108, { width: anchoFirma - 24 });

  const qr = await QRCode.toBuffer(urlVerificacion, { type: 'png', margin: 1, width: 300, errorCorrectionLevel: 'M' });
  const xq = X + W - 130;
  doc.image(qr, xq + 10, yf, { width: 110 });
  doc.font('Helvetica').fontSize(7.5).fillColor(GRIS).text('Verifique este contrato', xq, yf + 112, { width: 130, align: 'center' });
  doc.font('Courier-Bold').fontSize(9).fillColor(TINTA).text(contrato.codigo_verificacion, xq, yf + 122, { width: 130, align: 'center' });
  doc.y = yf + alto;

  // Pie de cada página
  const rango = doc.bufferedPageRange();
  for (let i = rango.start; i < rango.start + rango.count; i++) {
    doc.switchToPage(i);
    const yp = doc.page.height - 40;
    const m = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    doc.moveTo(X, yp - 6).lineTo(X + W, yp - 6).lineWidth(0.5).strokeColor(LINEA).stroke();
    doc.font('Helvetica').fontSize(7).fillColor('#9AA1AD').text('Documento generado con Síguelo Rent a Car', X, yp, { width: W / 2, lineBreak: false });
    doc.text(limpiarTexto(`${contrato.folio} · página ${i - rango.start + 1} de ${rango.count}`), X + W / 2, yp, { width: W / 2, align: 'right', lineBreak: false });
    doc.page.margins.bottom = m;
  }
  doc.end();
  return fin;
}
