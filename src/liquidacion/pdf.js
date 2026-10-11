// PDF de la liquidación (se adjunta al correo del cliente y se descarga desde la pantalla).
import { nuevoPdf, encabezado, tabla, txt } from '../facturacion/pdf.js';
import { clp, fecha, fechaHora } from '../util/formato.js';
import { formatearRut } from '../util/rut.js';

export async function pdfLiquidacion(v) {
  const { doc, terminar } = nuevoPdf();
  const { empresa, reserva, cliente, vehiculo, liquidacion: lq, resumen } = v;
  const estado = { borrador: 'Borrador', aprobada: 'Aprobada', cobrada: 'Cobrada', anulada: 'Anulada' }[lq.estado] || lq.estado;
  await encabezado(doc, empresa, { titulo: 'LIQUIDACIÓN DE ARRIENDO', subtitulo: `${lq.folio} · ${estado}` });
  const nombre = [cliente?.nombre, cliente?.apellidos].filter(Boolean).join(' ');
  const datos = [
    ['Cliente', `${nombre}${cliente?.documento ? ` · ${cliente.documento_tipo === 'rut' ? formatearRut(cliente.documento) : cliente.documento}` : ''}`],
    ['Reserva', `${reserva.folio}${v.contrato?.folio ? ` · contrato ${v.contrato.folio}` : ''}`],
    ['Vehículo', vehiculo ? `${vehiculo.patente} · ${vehiculo.marca || ''} ${vehiculo.modelo || ''}` : '-'],
    ['Período', `${fechaHora(reserva.inicio)} al ${fechaHora(reserva.fin)}${reserva.devolucion_real ? ` · devuelto ${fechaHora(reserva.devolucion_real)}` : ''}`]
  ];
  doc.fontSize(9.5);
  for (const [k, val] of datos) doc.font('Helvetica-Bold').text(`${k}: `, { continued: true }).font('Helvetica').text(txt(val));
  doc.moveDown(0.8);

  const incluidas = lq.lineas.filter((l) => l.incluir && l.monto > 0);
  const filas = incluidas.map((l) => [l.concepto + (l.sub ? `\n${l.sub}` : ''), l.calculo, l.origen, clp(l.monto)]);
  filas.push(['Total cargos adicionales (IVA incluido)', '', '', clp(resumen.total_cargos)]);
  tabla(doc, [{ titulo: 'Concepto', ancho: 140 }, { titulo: 'Cálculo', ancho: 228 }, { titulo: 'Origen', ancho: 85 }, { titulo: 'Monto', ancho: 75, alinear: 'right' }], filas, { negritaUltima: true });

  const condonadas = lq.lineas.filter((l) => !l.incluir && l.monto_calculado > 0);
  if (condonadas.length) {
    doc.font('Helvetica-Bold').fontSize(9).text('Cargos condonados');
    doc.font('Helvetica').fontSize(8.5).fillColor('#5B6472');
    for (const l of condonadas) doc.text(txt(`${l.concepto}: ${clp(l.monto_calculado)}${l.motivo ? ` · motivo: ${l.motivo}` : ''}`));
    doc.fillColor('#14181E').moveDown(0.6);
  }

  doc.font('Helvetica-Bold').fontSize(11).text('Garantía');
  doc.font('Helvetica').fontSize(9.5);
  if (resumen.garantia) {
    doc.text(txt(`Garantía retenida: ${clp(resumen.garantia)}${v.garantia?.tarjeta ? ` · tarjeta terminada en ${v.garantia.tarjeta}` : ''}`));
    doc.text(txt(`Se captura por cargos: ${clp(resumen.captura)}`));
    doc.font('Helvetica-Bold').text(txt(`Se libera al cliente: ${clp(resumen.libera)}`)).font('Helvetica');
  } else doc.text('Sin garantía retenida.');
  if (resumen.saldo > 0) doc.moveDown(0.4).font('Helvetica-Bold').fillColor('#C8102E').text(txt(`Saldo por pagar: ${clp(resumen.saldo)}${v.link_saldo ? ` · ${v.link_saldo}` : ''}`)).fillColor('#14181E').font('Helvetica');
  if (v.arriendo?.pagado) doc.moveDown(0.4).text(txt(`Arriendo pagado: ${clp(v.arriendo.pagado)}`));
  doc.moveDown(1.5).fontSize(8).fillColor('#5B6472')
    .text(txt(`Emitido el ${fecha(new Date())}${lq.aprobado_en ? ` · aprobado el ${fechaHora(lq.aprobado_en)}` : ''}. Los cargos de TAG y multas notificados con posterioridad podrán cobrarse según la cláusula sexta del contrato.`), { width: 528 });
  return terminar();
}
