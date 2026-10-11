// Incidentes: creación (desde la devolución o manual) y eventos de trazabilidad. Usar dentro de transacciones (tx).
import { siguienteFolio } from '../db.js';

export async function contratoDeReserva(cx, empresaId, reservaId) {
  if (!reservaId) return null;
  const [c] = await cx.query(`SELECT id, folio FROM contratos WHERE empresa_id = $1 AND reserva_id = $2 AND estado <> 'anulado' ORDER BY id DESC LIMIT 1`, [empresaId, reservaId]);
  return c || null;
}

export async function evento(cx, { empresaId, incidenteId, tipo, detalle = null, monto = null, usuarioId = null }) {
  await cx.query('INSERT INTO incidente_eventos (empresa_id, incidente_id, tipo, detalle, monto, usuario_id) VALUES ($1,$2,$3,$4,$5,$6)',
    [empresaId, incidenteId, tipo, detalle, monto, usuarioId]);
}

// → fila de incidentes. Si viene reservaId, completa cliente, contrato y deducible desde la reserva.
export async function crearIncidente(tx, { empresaId, tipo = 'dano', reservaId = null, vehiculoId, clienteId = null, descripcion = null, deducible = null, usuarioId = null, detalleReporte = null, creadoEn = null }) {
  let contratoId = null;
  if (reservaId) {
    const [r] = await tx.query('SELECT cliente_id, vehiculo_id, deducible FROM reservas WHERE id = $1 AND empresa_id = $2', [reservaId, empresaId]);
    if (r) {
      clienteId = clienteId ?? r.cliente_id;
      vehiculoId = vehiculoId ?? r.vehiculo_id;
      deducible = deducible ?? r.deducible;
    }
    contratoId = (await contratoDeReserva(tx, empresaId, reservaId))?.id ?? null;
  }
  const folio = await siguienteFolio(empresaId, 'INC', tx);
  const [inc] = await tx.query(
    `INSERT INTO incidentes (empresa_id, folio, reserva_id, contrato_id, vehiculo_id, cliente_id, tipo, estado, descripcion, deducible, creado_por, creado_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'reportado',$8,$9,$10, COALESCE($11, now())) RETURNING *`,
    [empresaId, folio, reservaId, contratoId, vehiculoId, clienteId, tipo, descripcion, deducible, usuarioId, creadoEn]);
  await tx.query('INSERT INTO incidente_eventos (empresa_id, incidente_id, tipo, detalle, usuario_id, creado_en) VALUES ($1,$2,$3,$4,$5, COALESCE($6, now()))',
    [empresaId, inc.id, 'reporte', detalleReporte || descripcion || 'Incidente reportado', usuarioId, creadoEn]);
  return inc;
}
