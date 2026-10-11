// Lectura de reservas con sus datos relacionados y avisos al cliente (plantillas reserva_confirmada).
import { q } from '../db.js';
import { config } from '../config.js';
import { avisar } from '../salidas.js';
import { clp, fechaHora, miles } from '../util/formato.js';
import { formatearPatente } from '../util/patente.js';
import { formatearRut } from '../util/rut.js';
import { tokenAleatorio } from '../cifrado.js';

// Columnas de la lista / calendario (una fila por reserva)
export const SQL_LISTA = `SELECT r.id, r.folio, r.estado, r.inicio, r.fin, r.total, r.vehiculo_id, r.categoria_id, r.cliente_id, r.origen,
    r.sucursal_retiro_id, r.sucursal_devolucion_id, r.codigo_descuento, r.creado_en,
    trim(c.nombre || ' ' || coalesce(c.apellidos, '')) AS cliente, c.documento_tipo, c.documento, c.telefono, c.correo, c.lista_negra,
    v.patente, v.marca, v.modelo, cat.nombre AS categoria, sr.nombre AS sucursal_retiro, sd.nombre AS sucursal_devolucion,
    (r.estado = 'en_curso' AND r.fin < now()) AS atrasada
  FROM reservas r
  LEFT JOIN clientes c ON c.id = r.cliente_id
  LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
  LEFT JOIN categorias cat ON cat.id = r.categoria_id
  LEFT JOIN sucursales sr ON sr.id = r.sucursal_retiro_id
  LEFT JOIN sucursales sd ON sd.id = r.sucursal_devolucion_id`;

export const nombreDocumento = (tipo) => ({ rut: 'RUT', pasaporte: 'Pasaporte', dni: 'DNI' }[tipo] || tipo || '');
export const documentoTxt = (tipo, doc) => (tipo === 'rut' ? formatearRut(doc) : String(doc || ''));
export const nombreCompleto = (c) => (c ? `${c.nombre || ''} ${c.apellidos || ''}`.trim() : '');
export const urlPortal = (token) => (token ? `${config.urlBase}/portal/${token}` : '');

/** Datos crudos de una reserva: { reserva, cliente, vehiculo, categoria, empresa, sr, sd, conductores } (cx opcional = transacción) */
export async function contexto(empresaId, reservaId, cx = null) {
  const ej = cx || { query: q };
  const [reserva] = await ej.query('SELECT * FROM reservas WHERE id = $1 AND empresa_id = $2', [reservaId, empresaId]);
  if (!reserva) return null;
  const uno1 = async (sql, p) => (await ej.query(sql, p))[0] || null;
  const [empresa, cliente, vehiculo, categoria, sr, sd] = [
    await uno1('SELECT * FROM empresas WHERE id = $1', [empresaId]),
    reserva.cliente_id ? await uno1('SELECT * FROM clientes WHERE id = $1 AND empresa_id = $2', [reserva.cliente_id, empresaId]) : null,
    reserva.vehiculo_id ? await uno1('SELECT * FROM vehiculos WHERE id = $1 AND empresa_id = $2', [reserva.vehiculo_id, empresaId]) : null,
    reserva.categoria_id ? await uno1('SELECT * FROM categorias WHERE id = $1 AND empresa_id = $2', [reserva.categoria_id, empresaId]) : null,
    reserva.sucursal_retiro_id ? await uno1('SELECT * FROM sucursales WHERE id = $1 AND empresa_id = $2', [reserva.sucursal_retiro_id, empresaId]) : null,
    reserva.sucursal_devolucion_id ? await uno1('SELECT * FROM sucursales WHERE id = $1 AND empresa_id = $2', [reserva.sucursal_devolucion_id, empresaId]) : null
  ];
  const ids = (Array.isArray(reserva.conductores) ? reserva.conductores : []).map(Number).filter(Boolean);
  const conductores = ids.length ? await ej.query('SELECT * FROM conductores WHERE empresa_id = $1 AND id = ANY($2::bigint[]) ORDER BY id', [empresaId, ids]) : [];
  return { reserva, cliente, vehiculo, categoria, empresa, sr: sr || {}, sd: sd || sr || {}, conductores };
}

/** Variables para las plantillas de correo/WhatsApp de una reserva (formato chileno). */
export function variablesAviso(ctx) {
  const { reserva: r, cliente: c, vehiculo: v, empresa: e, sr, sd } = ctx;
  return {
    empresa: e,
    cliente: { ...(c || {}), nombre: c?.nombre || '', nombre_completo: nombreCompleto(c) },
    vehiculo: v ? { ...v, patente: formatearPatente(v.patente), km: miles(v.gps_km ?? v.km) } : {},
    reserva: { folio: r.folio, inicio: fechaHora(r.inicio), fin: fechaHora(r.fin), total: clp(r.total), garantia: clp(r.garantia), deducible: clp(r.deducible) },
    sucursal_retiro: sr, sucursal_devolucion: sd,
    url_portal: urlPortal(r.token_portal)
  };
}

/** Correo y WhatsApp «reserva confirmada» (en marcha blanca quedan retenidos en la bandeja de salida). */
export async function avisarConfirmada(empresaId, reservaId) {
  const ctx = await contexto(empresaId, reservaId);
  if (!ctx?.cliente) return [];
  if (!ctx.reserva.token_portal) {
    const t = tokenAleatorio(18);
    await q('UPDATE reservas SET token_portal = $3 WHERE id = $1 AND empresa_id = $2 AND token_portal IS NULL', [reservaId, empresaId, t]);
    ctx.reserva.token_portal = t;
  }
  return avisar({ empresaId, clave: 'reserva_confirmada', datos: variablesAviso(ctx), correo: ctx.cliente.correo, telefono: ctx.cliente.telefono, entidad: 'reserva', entidadId: reservaId });
}
