// Inmovilización remota: SOLO con confirmación manual, DOBLE validación y SOLO con el vehículo detenido.
//  1. Solicitar (usuario con inmovilizar:editar) → estado «solicitada».
//  2. Confirmar: OTRA persona, con inmovilizar:editar y rol administrador (o superadmin), reescribiendo la patente.
//  3. Se vuelve a leer la posición en vivo: si está en movimiento, NO se envía (queda «confirmada», pendiente,
//     y se envía sola cuando la sincronización lo vea detenido; también se puede reintentar a mano).
//  4. Detenido + integración habilitada → unit/exec_cmd → «enviada» (vehiculos.gps_inmovilizado se actualiza).
//     En marcha blanca → «simulada» (no sale nada). Cada paso queda en inmovilizaciones.eventos y en la bitácora.
//  Liberar sigue exactamente el mismo flujo.
import { q, uno } from '../db.js';
import { ErrorHttp } from '../auth.js';
import { registrar } from '../bitacora.js';
import { puedeActuar, marchaBlanca } from '../integraciones/index.js';
import { normalizarPatente, formatearPatente } from '../util/patente.js';
import { lecturaActual } from './index.js';
import { enviarComando } from './wialon.js';

export const MENSAJE_MOVIMIENTO = 'El vehículo está en movimiento: se enviará solo detenido';
const VENCE_PENDIENTE_MS = 6 * 3600e3; // una confirmada que nunca se detuvo se rechaza a las 6 horas

const evento = (tipo, usuario, detalle = '') => ({ en: new Date().toISOString(), tipo, usuario_id: usuario?.id ?? null, usuario: usuario?.nombre ?? 'Sistema', detalle });
async function agregarEvento(id, ev, cambios = {}) {
  const sets = Object.keys(cambios).map((k, i) => `${k} = $${i + 3}`);
  const [f] = await q(`UPDATE inmovilizaciones SET eventos = eventos || $2::jsonb${sets.length ? `, ${sets.join(', ')}` : ''} WHERE id = $1 RETURNING *`, [id, JSON.stringify([ev]), ...Object.values(cambios)]);
  return f;
}
const puedeConfirmarRol = (rol) => rol === 'administrador' || rol === 'superadmin';

export async function obtener(empresaId, id) {
  return uno(`SELECT i.*, v.patente, v.gps_unidad_id, v.gps_inmovilizado, us.nombre AS solicitado_nombre, uc.nombre AS confirmado_nombre, r.folio
    FROM inmovilizaciones i JOIN vehiculos v ON v.id = i.vehiculo_id LEFT JOIN usuarios us ON us.id = i.solicitado_por
    LEFT JOIN usuarios uc ON uc.id = i.confirmado_por LEFT JOIN reservas r ON r.id = i.reserva_id
    WHERE i.id = $1 AND i.empresa_id = $2`, [id, empresaId]);
}

export async function listar(empresaId, { vehiculoId = null, limite = 100 } = {}) {
  return q(`SELECT i.*, v.patente, us.nombre AS solicitado_nombre, uc.nombre AS confirmado_nombre, r.folio
    FROM inmovilizaciones i JOIN vehiculos v ON v.id = i.vehiculo_id LEFT JOIN usuarios us ON us.id = i.solicitado_por
    LEFT JOIN usuarios uc ON uc.id = i.confirmado_por LEFT JOIN reservas r ON r.id = i.reserva_id
    WHERE i.empresa_id = $1 AND ($2::bigint IS NULL OR i.vehiculo_id = $2) ORDER BY i.creado_en DESC LIMIT $3`, [empresaId, vehiculoId, limite]);
}

export async function solicitar(req, { vehiculo_id: vehiculoId, accion, motivo }) {
  const E = req.empresaId;
  if (!['inmovilizar', 'liberar'].includes(accion)) throw new ErrorHttp(400, 'Acción no válida', { campo: 'accion' });
  if (!String(motivo || '').trim() || String(motivo).trim().length < 5) throw new ErrorHttp(400, 'Escribe el motivo (mínimo 5 caracteres)', { campo: 'motivo' });
  const v = await uno('SELECT id, patente, gps_unidad_id, gps_inmovilizado FROM vehiculos WHERE id = $1 AND empresa_id = $2', [vehiculoId, E]);
  if (!v) throw new ErrorHttp(404, 'Vehículo no encontrado');
  if (!v.gps_unidad_id) throw new ErrorHttp(400, 'El vehículo no tiene una unidad de la plataforma GPS asignada');
  const abierta = await uno(`SELECT id FROM inmovilizaciones WHERE empresa_id = $1 AND vehiculo_id = $2 AND estado IN ('solicitada','confirmada')`, [E, v.id]);
  if (abierta) throw new ErrorHttp(409, 'Ya hay una solicitud pendiente para este vehículo');
  const reserva = await uno(`SELECT id FROM reservas WHERE empresa_id = $1 AND vehiculo_id = $2 AND estado = 'en_curso' ORDER BY inicio DESC LIMIT 1`, [E, v.id]);
  const [f] = await q(`INSERT INTO inmovilizaciones (empresa_id, vehiculo_id, reserva_id, accion, motivo, estado, solicitado_por, eventos)
    VALUES ($1,$2,$3,$4,$5,'solicitada',$6,$7) RETURNING *`,
  [E, v.id, reserva?.id || null, accion, String(motivo).trim(), req.usuario.id, JSON.stringify([evento('solicitada', req.usuario, `Solicitó ${accion === 'inmovilizar' ? 'inmovilizar' : 'liberar'} ${formatearPatente(v.patente)}: ${String(motivo).trim()}`)])]);
  await registrar(req, `inmovilizacion_solicitada`, 'inmovilizacion', f.id, { vehiculo_id: v.id, patente: v.patente, accion, motivo });
  return obtener(E, f.id);
}

export async function confirmar(req, id, { patente }) {
  const E = req.empresaId;
  const f = await obtener(E, id);
  if (!f) throw new ErrorHttp(404, 'Solicitud no encontrada');
  if (f.estado !== 'solicitada') throw new ErrorHttp(409, `La solicitud ya está «${f.estado}»`);
  if (!puedeConfirmarRol(req.usuario.rol)) throw new ErrorHttp(403, 'Solo un administrador puede confirmar una inmovilización');
  if (Number(f.solicitado_por) === Number(req.usuario.id)) throw new ErrorHttp(403, 'La confirmación debe hacerla otra persona (doble validación)');
  if (normalizarPatente(patente) !== normalizarPatente(f.patente)) throw new ErrorHttp(400, 'La patente escrita no coincide con la del vehículo', { campo: 'patente' });
  await agregarEvento(f.id, evento('confirmada', req.usuario, 'Confirmó reescribiendo la patente'), { estado: 'confirmada', confirmado_por: req.usuario.id, confirmado_en: new Date() });
  await registrar(req, 'inmovilizacion_confirmada', 'inmovilizacion', f.id, { patente: f.patente, accion: f.accion });
  return ejecutar(req, f.id);
}

export async function reintentar(req, id) {
  const f = await obtener(req.empresaId, id);
  if (!f) throw new ErrorHttp(404, 'Solicitud no encontrada');
  if (f.estado !== 'confirmada') throw new ErrorHttp(409, 'Solo se puede reintentar una solicitud confirmada que espera al vehículo detenido');
  return ejecutar(req, f.id);
}

export async function cancelar(req, id, motivo = '') {
  const f = await obtener(req.empresaId, id);
  if (!f) throw new ErrorHttp(404, 'Solicitud no encontrada');
  if (!['solicitada', 'confirmada'].includes(f.estado)) throw new ErrorHttp(409, `La solicitud ya está «${f.estado}»`);
  const rechazo = f.estado === 'solicitada' && Number(f.solicitado_por) !== Number(req.usuario.id) && puedeConfirmarRol(req.usuario.rol);
  await agregarEvento(f.id, evento(rechazo ? 'rechazada' : 'cancelada', req.usuario, String(motivo || '').trim()), { estado: rechazo ? 'rechazada' : 'cancelada', respuesta: String(motivo || '').trim() || null });
  await registrar(req, rechazo ? 'inmovilizacion_rechazada' : 'inmovilizacion_cancelada', 'inmovilizacion', f.id, { patente: f.patente, motivo });
  return obtener(req.empresaId, f.id);
}

export const estaEnMovimiento = (l) => (l?.velocidad != null && l.velocidad > 0) || (l?.velocidad == null && l?.motor === true);

// Lee la posición en vivo y, solo si está detenido, envía (o simula) el comando.
export async function ejecutar(req, id) {
  const E = req.empresaId;
  const f = await obtener(E, id);
  if (!f || f.estado !== 'confirmada') return f;
  const l = await lecturaActual(E, f.vehiculo_id);
  const vel = l?.velocidad ?? null;
  const enMovimiento = estaEnMovimiento(l);
  const pos = { velocidad_al_enviar: vel, lat: l?.lat ?? null, lng: l?.lng ?? null };
  if (enMovimiento) {
    await agregarEvento(f.id, evento('en_movimiento', req.usuario, `No se envió: ${vel != null ? `${vel} km/h` : 'motor encendido'}. Se enviará cuando esté detenido.`), pos);
    await registrar(req, 'inmovilizacion_en_movimiento', 'inmovilizacion', f.id, { patente: f.patente, velocidad: vel });
    return { ...(await obtener(E, f.id)), en_movimiento: true, mensaje: MENSAJE_MOVIMIENTO };
  }
  const p = await puedeActuar(E, 'gps');
  let cambios, ev, mensaje;
  if (p.ok) {
    const comando = f.accion === 'inmovilizar' ? p.config.comando_inmovilizar : p.config.comando_liberar;
    try {
      const r = await enviarComando(E, f.gps_unidad_id, comando, p.config);
      cambios = { estado: 'enviada', ejecutado_en: new Date(), respuesta: `Comando «${comando}» enviado${r && Object.keys(r).length ? `: ${JSON.stringify(r).slice(0, 200)}` : ''}` };
      ev = evento('enviada', req.usuario, cambios.respuesta);
      await q('UPDATE vehiculos SET gps_inmovilizado = $3 WHERE id = $1 AND empresa_id = $2', [f.vehiculo_id, E, f.accion === 'inmovilizar']);
      mensaje = f.accion === 'inmovilizar' ? 'Orden de inmovilización enviada al vehículo' : 'Orden de liberación enviada al vehículo';
    } catch (e) {
      cambios = { estado: 'fallida', ejecutado_en: new Date(), respuesta: e.message.slice(0, 500) };
      ev = evento('fallida', req.usuario, e.message);
      mensaje = `No se pudo enviar: ${e.message}`;
    }
  } else if (p.marchaBlanca || await marchaBlanca(E)) {
    const comando = f.accion === 'inmovilizar' ? (p.config?.comando_inmovilizar || 'inmovilizar') : (p.config?.comando_liberar || 'liberar');
    cambios = { estado: 'simulada', ejecutado_en: new Date(), respuesta: `Marcha blanca: el comando «${comando}» no se envió (simulado)` };
    ev = evento('simulada', req.usuario, cambios.respuesta);
    mensaje = 'Marcha blanca activa: la orden quedó registrada como simulada y no se envió al vehículo';
  } else {
    cambios = { estado: 'fallida', ejecutado_en: new Date(), respuesta: p.motivo };
    ev = evento('fallida', req.usuario, p.motivo);
    mensaje = `No se envió: ${p.motivo}`;
  }
  await agregarEvento(f.id, ev, { ...pos, ...cambios });
  await registrar(req, `inmovilizacion_${cambios.estado}`, 'inmovilizacion', f.id, { patente: f.patente, accion: f.accion, respuesta: cambios.respuesta });
  return { ...(await obtener(E, f.id)), mensaje };
}

// Desde la sincronización: envía las confirmadas cuyo vehículo ya se detuvo; vence las que esperan demasiado.
export async function procesarPendientes(empresaId) {
  const pend = await q(`SELECT id, confirmado_en FROM inmovilizaciones WHERE empresa_id = $1 AND estado = 'confirmada'`, [empresaId]);
  let n = 0;
  const req = { empresaId, usuario: null };
  for (const p of pend) {
    if (p.confirmado_en && Date.now() - new Date(p.confirmado_en) > VENCE_PENDIENTE_MS) {
      await agregarEvento(p.id, evento('rechazada', null, 'El vehículo siguió en movimiento durante 6 horas: la orden se anuló'), { estado: 'rechazada', respuesta: 'Vencida: el vehículo no se detuvo' });
      await registrar(req, 'inmovilizacion_vencida', 'inmovilizacion', p.id, {});
      continue;
    }
    const f = await obtener(empresaId, p.id);
    if (estaEnMovimiento(await lecturaActual(empresaId, f.vehiculo_id))) continue; // sigue esperando, sin llenar la bitácora
    const r = await ejecutar(req, p.id);
    if (r && !r.en_movimiento) n++;
  }
  return n;
}
