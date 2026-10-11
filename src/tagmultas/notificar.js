// Aviso al cliente de los TAG y multas de una reserva (plantilla 'cargo_tag_multa', por correo y WhatsApp).
// Agrupa lo que aún no se avisó: TAG «asignado» sin notificado_en y multas «asignada». En marcha blanca los mensajes
// quedan «retenida» en la bandeja de salida, pero el registro igual se marca como avisado (notificada / notificado_en).
import { q, uno } from '../db.js';
import { avisar } from '../salidas.js';
import { clp, fechaHora, fecha } from '../util/formato.js';
import { formatearPatente } from '../util/patente.js';

export async function pendientesDeReserva(empresaId, reservaId) {
  const [tag, multas] = await Promise.all([
    q(`SELECT * FROM tag_transitos WHERE empresa_id = $1 AND reserva_id = $2 AND estado = 'asignado' AND notificado_en IS NULL ORDER BY fecha_hora`, [empresaId, reservaId]),
    q(`SELECT * FROM multas WHERE empresa_id = $1 AND reserva_id = $2 AND estado = 'asignada' ORDER BY fecha_infraccion`, [empresaId, reservaId])
  ]);
  return { tag, multas };
}

export function lineasDetalle({ tag, multas }) {
  const l = [
    ...tag.map((t) => `• ${fechaHora(t.fecha_hora)} · TAG ${[t.autopista, t.portico].filter(Boolean).join(' – ') || 'pórtico'} · ${clp(t.monto)}`),
    ...multas.map((m) => `• ${m.hora_conocida ? fechaHora(m.fecha_infraccion) : fecha(m.fecha_infraccion)} · Multa: ${m.motivo || 'infracción'}${m.lugar ? ` (${m.lugar})` : ''}${m.rol_causa ? ` · rol ${m.rol_causa}` : ''} · ${clp(m.monto)}`)
  ];
  const total = tag.reduce((s, t) => s + Number(t.monto), 0) + multas.reduce((s, m) => s + Number(m.monto), 0);
  return { lineas: l, total };
}

export async function notificarReserva(empresaId, reservaId) {
  const r = await uno(`SELECT r.id, r.folio, r.inicio, r.fin, r.retiro_real, r.devolucion_real, r.cliente_id, c.nombre, c.apellidos, c.correo, c.telefono, v.patente, v.marca, v.modelo
      FROM reservas r LEFT JOIN clientes c ON c.id = r.cliente_id LEFT JOIN vehiculos v ON v.id = r.vehiculo_id WHERE r.id = $1 AND r.empresa_id = $2`, [reservaId, empresaId]);
  if (!r) return { error: 'Reserva no encontrada', estado: 404 };
  const p = await pendientesDeReserva(empresaId, reservaId);
  if (!p.tag.length && !p.multas.length) return { error: 'No hay TAG ni multas pendientes de aviso en esta reserva', estado: 409 };
  if (!r.correo && !r.telefono) return { error: 'El cliente no tiene correo ni teléfono registrado', estado: 400 };
  const empresa = await uno('SELECT nombre, telefono, correo FROM empresas WHERE id = $1', [empresaId]);
  const { lineas, total } = lineasDetalle(p);
  const datos = {
    empresa, cliente: { nombre: r.nombre, apellidos: r.apellidos, correo: r.correo, telefono: r.telefono },
    reserva: { folio: r.folio, inicio: fechaHora(r.retiro_real || r.inicio), fin: fechaHora(r.devolucion_real || r.fin) },
    vehiculo: { patente: formatearPatente(r.patente), marca: r.marca, modelo: r.modelo },
    detalle: lineas.join('\n'), total: clp(total)
  };
  const salidas = await avisar({ empresaId, clave: 'cargo_tag_multa', datos, correo: r.correo, telefono: r.telefono, entidad: 'reserva', entidadId: r.id });
  if (p.tag.length) await q(`UPDATE tag_transitos SET notificado_en = now() WHERE empresa_id = $1 AND id = ANY($2::bigint[])`, [empresaId, p.tag.map((t) => t.id)]);
  if (p.multas.length) await q(`UPDATE multas SET estado = 'notificada', notificada_en = now() WHERE empresa_id = $1 AND id = ANY($2::bigint[])`, [empresaId, p.multas.map((m) => m.id)]);
  return { reserva_id: r.id, folio: r.folio, tag: p.tag.length, multas: p.multas.length, total, salidas: salidas.filter(Boolean).map((s) => ({ id: s.id, canal: s.canal, destino: s.destino, estado: s.estado, error: s.error })) };
}
