// Sincronización con la plataforma GPS (tarea «gps_sincronizar», cada 2 minutos, por empresa con la integración activa).
// Leer datos está permitido incluso en marcha blanca: solo los comandos y los avisos son «acciones».
// - Une unidades con vehículos (por gps_unidad_id o por la patente en el nombre de la unidad).
// - Actualiza vehiculos.gps_* (posición, velocidad, motor, km, combustible, hora del último mensaje).
// - Guarda muestras en gps_lecturas para los vehículos con reserva en curso (máximo una cada 15 minutos).
// - Evalúa las reglas de alerta (src/gps/alertas.js) y envía las inmovilizaciones confirmadas que esperaban al vehículo detenido.
import { q, uno } from '../db.js';
import { leer } from '../integraciones/index.js';
import { registrarTarea } from '../tareas.js';
import { normalizarPatente } from '../util/patente.js';
import { lecturaActual } from './index.js';
import { leerUnidades, zonaPermitida, dentroDePermitida } from './wialon.js';
import { evaluarReglas, calcularDetenido, registrarAlertas, avisarAlertas } from './alertas.js';
import { procesarPendientes } from './inmovilizar.js';

const MUESTRA_CADA_MS = 15 * 60e3;
export const estadoSincronizacion = new Map(); // empresaId → { en, ok, resultado, error }

// Busca el vehículo de una unidad: primero por id de unidad, luego por patente contenida en el nombre.
export function emparejar(unidad, porId, vehiculos) {
  const v = porId.get(String(unidad.id));
  if (v) return { vehiculo: v, por: 'unidad' };
  const nombre = normalizarPatente(unidad.nombre);
  if (!nombre) return null;
  const exacto = vehiculos.find((x) => normalizarPatente(x.patente) === nombre);
  if (exacto) return { vehiculo: exacto, por: 'patente' };
  const contiene = vehiculos.filter((x) => { const p = normalizarPatente(x.patente); return p.length >= 5 && nombre.includes(p); });
  return contiene.length === 1 ? { vehiculo: contiene[0], por: 'patente' } : null;
}

export async function sincronizarEmpresa(empresaId, { unidades = null, ahora = new Date() } = {}) {
  const { config } = await leer(empresaId, 'gps');
  const lista = unidades || await leerUnidades(empresaId, { config });
  const vehiculos = await q('SELECT * FROM vehiculos WHERE empresa_id = $1 AND activo', [empresaId]);
  const porId = new Map(vehiculos.filter((v) => v.gps_unidad_id).map((v) => [String(v.gps_unidad_id), v]));
  let zona = null;
  try { zona = await zonaPermitida(empresaId, config); } catch { zona = null; } // la geocerca es opcional
  const reservas = await q(`SELECT id, folio, vehiculo_id, cliente_id FROM reservas WHERE empresa_id = $1 AND estado = 'en_curso'`, [empresaId]);
  const reservaDe = new Map(reservas.map((r) => [r.vehiculo_id, r]));
  const ultimas = new Map((reservas.length ? await q(`SELECT reserva_id, max(leido_en) AS en FROM gps_lecturas WHERE empresa_id = $1 AND reserva_id = ANY($2::bigint[]) GROUP BY reserva_id`, [empresaId, reservas.map((r) => r.id)]) : []).map((x) => [x.reserva_id, new Date(x.en)]));

  const res = { unidades: lista.length, emparejadas: 0, vinculadas: 0, lecturas: 0, alertas: 0, sin_vehiculo: 0 };
  const nuevas = [];
  const usados = new Set();
  for (const u of lista) {
    const m = emparejar(u, porId, vehiculos.filter((x) => !x.gps_unidad_id || String(x.gps_unidad_id) === u.id));
    if (!m || usados.has(m.vehiculo.id)) { res.sin_vehiculo++; continue; }
    const v = m.vehiculo;
    usados.add(v.id);
    res.emparejadas++;
    if (m.por === 'patente' && !v.gps_unidad_id) res.vinculadas++;
    const detenido = calcularDetenido(v, u, ahora);
    await q(`UPDATE vehiculos SET gps_unidad_id = coalesce(gps_unidad_id, $3), gps_nombre = $4,
               gps_lat = coalesce($5, gps_lat), gps_lng = coalesce($6, gps_lng), gps_velocidad = $7, gps_motor = $8,
               gps_km = coalesce($9, gps_km), gps_combustible = coalesce($10, gps_combustible),
               gps_actualizado_en = coalesce($11, gps_actualizado_en), gps_detenido_desde = $12
             WHERE id = $1 AND empresa_id = $2`,
    [v.id, empresaId, u.id, u.nombre, u.lat, u.lng, u.velocidad, u.motor, u.km, u.combustible, u.en, detenido]);
    const reserva = reservaDe.get(v.id) || null;
    if (reserva && u.lat != null) {
      const ult = ultimas.get(reserva.id);
      if (!ult || ahora - ult >= MUESTRA_CADA_MS) {
        await q('INSERT INTO gps_lecturas (empresa_id, vehiculo_id, reserva_id, km, combustible, lat, lng, velocidad, leido_en) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [empresaId, v.id, reserva.id, u.km ?? v.gps_km, u.combustible ?? v.gps_combustible, u.lat, u.lng, u.velocidad, ahora]);
        res.lecturas++;
      }
    }
    const reglas = evaluarReglas({ vehiculo: v, lectura: u, reserva, config, dentroZona: dentroDePermitida(zona, u.lat, u.lng), nombreZona: zona?.nombre, detenidoDesde: detenido, ahora });
    if (reglas.length) nuevas.push(...await registrarAlertas(empresaId, v, reserva, u, reglas));
  }
  res.alertas = nuevas.length;
  if (nuevas.length) await avisarAlertas(empresaId, nuevas).catch((e) => console.error('[gps] aviso de alertas:', e.message));
  res.inmovilizaciones = await procesarPendientes(empresaId).catch((e) => { console.error('[gps] inmovilizaciones pendientes:', e.message); return 0; });
  estadoSincronizacion.set(empresaId, { en: new Date(), ok: true, resultado: res });
  return res;
}

export async function sincronizarTodo() {
  const filas = await q(`SELECT i.empresa_id FROM integraciones i JOIN empresas e ON e.id = i.empresa_id WHERE i.tipo = 'gps' AND i.activa AND e.activa`);
  for (const { empresa_id: id } of filas) {
    const { activa, config } = await leer(id, 'gps');
    if (!activa || !config.token) continue;
    try { await sincronizarEmpresa(id); }
    catch (e) { estadoSincronizacion.set(id, { en: new Date(), ok: false, error: e.message }); console.error(`[gps_sincronizar] empresa ${id}:`, e.message); }
  }
}
registrarTarea('gps_sincronizar', 2 * 60e3, sincronizarTodo);

// Lectura puntual (km y combustible) para el inicio o fin de un contrato. La usan entrega y devolución.
export async function registrarLectura(empresaId, vehiculoId, reservaId = null) {
  const l = await lecturaActual(empresaId, vehiculoId);
  if (!l) return null;
  const [f] = await q('INSERT INTO gps_lecturas (empresa_id, vehiculo_id, reserva_id, km, combustible, lat, lng, velocidad) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [empresaId, vehiculoId, reservaId, l.km, l.combustible, l.lat, l.lng, l.velocidad]);
  return { ...f, origen: l.origen };
}

// Recorrido del contrato: km y combustible al inicio y al final, y las muestras intermedias.
export async function recorridoReserva(empresaId, reservaId) {
  const r = await uno(`SELECT r.id, r.folio, r.estado, r.vehiculo_id, r.inicio, r.fin, r.retiro_real, r.devolucion_real,
      v.patente, v.gps_km, v.gps_combustible, v.gps_actualizado_en, v.km AS km_registro, v.combustible_nivel
    FROM reservas r LEFT JOIN vehiculos v ON v.id = r.vehiculo_id WHERE r.id = $1 AND r.empresa_id = $2`, [reservaId, empresaId]);
  if (!r) return null;
  const muestras = await q('SELECT km, combustible, lat, lng, velocidad, leido_en FROM gps_lecturas WHERE empresa_id = $1 AND reserva_id = $2 ORDER BY leido_en', [empresaId, reservaId]);
  const insp = await q('SELECT tipo, km, km_gps, combustible, combustible_gps, completado_en FROM inspecciones WHERE empresa_id = $1 AND reserva_id = $2', [empresaId, reservaId]);
  const ent = insp.find((i) => i.tipo === 'entrega'), dev = insp.find((i) => i.tipo === 'devolucion');
  const primera = muestras.find((m) => m.km != null), ultima = [...muestras].reverse().find((m) => m.km != null);
  const inicio = ent && (ent.km_gps ?? ent.km) != null
    ? { km: ent.km_gps ?? ent.km, combustible: ent.combustible_gps ?? ent.combustible, en: ent.completado_en || r.retiro_real, origen: ent.km_gps != null ? 'plataforma_gps' : 'inspeccion' }
    : primera ? { km: primera.km, combustible: primera.combustible, en: primera.leido_en, origen: 'plataforma_gps' } : null;
  let fin = null;
  if (dev && (dev.km_gps ?? dev.km) != null) fin = { km: dev.km_gps ?? dev.km, combustible: dev.combustible_gps ?? dev.combustible, en: dev.completado_en || r.devolucion_real, origen: dev.km_gps != null ? 'plataforma_gps' : 'inspeccion' };
  else if (r.estado === 'en_curso' && r.gps_km != null) fin = { km: r.gps_km, combustible: r.gps_combustible, en: r.gps_actualizado_en, origen: 'plataforma_gps', actual: true };
  else if (ultima) fin = { km: ultima.km, combustible: ultima.combustible, en: ultima.leido_en, origen: 'plataforma_gps' };
  const km = inicio && fin && fin.km != null && inicio.km != null ? Math.max(0, fin.km - inicio.km) : null;
  return {
    reserva_id: r.id, folio: r.folio, estado: r.estado, vehiculo_id: r.vehiculo_id, patente: r.patente,
    inicio, fin, km_recorridos: km,
    combustible_diferencia: inicio?.combustible != null && fin?.combustible != null ? fin.combustible - inicio.combustible : null,
    muestras
  };
}
