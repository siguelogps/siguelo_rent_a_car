// Reglas de alerta de la plataforma GPS → tabla gps_alertas (sin duplicados gracias a «huella»).
// Las reglas son funciones puras (fáciles de probar); registrarAlertas() las guarda y avisa al equipo:
// en la aplicación (Inicio y /gps muestran las alertas sin atender) y, opcionalmente, por correo a la empresa
// (pasa por la bandeja de salida: en marcha blanca queda «retenida»).
import { q, uno } from '../db.js';
import { encolar } from '../salidas.js';
import { ZONA, fechaHora } from '../util/formato.js';
import { formatearPatente } from '../util/patente.js';
import { haversine } from './wialon.js';

export const TIPOS_ALERTA = {
  geocerca: 'Fuera de la zona permitida', velocidad: 'Exceso de velocidad', detenido_fuera_horario: 'Detenido fuera de horario',
  sin_senal: 'Sin señal', combustible: 'Combustible'
};
const SIN_SENAL_MS = 6 * 3600e3;
const DETENIDO_MIN_MS = 30 * 60e3;
const RADIO_DETENIDO_M = 60;

const partesLocales = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((p) => [p.type, p.value]));
const diaLocal = (d) => { const p = partesLocales(d); return `${p.year}-${p.month}-${p.day}`; };
const minutosLocales = (d) => { const p = partesLocales(d); return Number(p.hour) * 60 + Number(p.minute); };
const aMinutos = (hhmm, defecto) => { const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : defecto; };

// ¿La hora local está dentro del horario permitido? (admite ventanas que cruzan medianoche)
export function dentroDeHorario(fecha, desde = '06:00', hasta = '23:00') {
  const m = minutosLocales(fecha), d = aMinutos(desde, 360), h = aMinutos(hasta, 1380);
  return d <= h ? m >= d && m < h : m >= d || m < h;
}

// Desde cuándo está detenido: misma posición (±60 m) y sin velocidad. Devuelve Date o null (en movimiento).
export function calcularDetenido(anterior, lectura, ahora = new Date()) {
  if (lectura.lat == null || lectura.lng == null) return anterior.gps_detenido_desde ? new Date(anterior.gps_detenido_desde) : null;
  if ((lectura.velocidad || 0) > 0) return null;
  const mismo = anterior.gps_lat != null && haversine(anterior.gps_lat, anterior.gps_lng, lectura.lat, lectura.lng) <= RADIO_DETENIDO_M;
  if (mismo && anterior.gps_detenido_desde) return new Date(anterior.gps_detenido_desde);
  return lectura.en && lectura.en < ahora ? lectura.en : ahora;
}

// Reglas → [{ tipo, detalle, valor, huella }]
// ctx: { vehiculo, lectura, reserva, config, dentroZona (true/false/null), nombreZona, detenidoDesde, ahora }
export function evaluarReglas({ vehiculo, lectura, reserva = null, config = {}, dentroZona = null, nombreZona = '', detenidoDesde = null, ahora = new Date() }) {
  const out = [];
  const arrendado = !!reserva || vehiculo.estado === 'arrendado';
  const dia = diaLocal(ahora);
  const max = Number(config.velocidad_maxima) || 120;
  if (lectura.en && ahora - lectura.en > SIN_SENAL_MS) {
    out.push({ tipo: 'sin_senal', detalle: `Sin señal desde ${fechaHora(lectura.en)} (más de 6 horas sin reportar)`, valor: Math.round((ahora - lectura.en) / 3600e3), huella: `sen:${vehiculo.id}:${Math.floor(lectura.en / 1000)}` });
    return out; // con la posición vieja, el resto de las reglas no aplica
  }
  if (arrendado && dentroZona === false) {
    out.push({ tipo: 'geocerca', detalle: `Salida de la zona permitida${nombreZona ? ` «${nombreZona}»` : ''}`, valor: null, huella: `geo:${vehiculo.id}:${reserva?.id || 0}:${dia}` });
  }
  if (lectura.velocidad != null && lectura.velocidad > max) {
    const h = partesLocales(ahora).hour;
    out.push({ tipo: 'velocidad', detalle: `Exceso de velocidad: ${lectura.velocidad} km/h (máximo ${max} km/h)`, valor: lectura.velocidad, huella: `vel:${vehiculo.id}:${dia}T${h}` });
  }
  if (arrendado && detenidoDesde && ahora - detenidoDesde >= DETENIDO_MIN_MS && !dentroDeHorario(ahora, config.horario_desde, config.horario_hasta)) {
    const min = Math.round((ahora - detenidoDesde) / 60e3);
    out.push({ tipo: 'detenido_fuera_horario', detalle: `Detenido ${min >= 120 ? `${Math.floor(min / 60)} h` : `${min} min`} fuera del horario permitido (${config.horario_desde || '06:00'}–${config.horario_hasta || '23:00'})`, valor: min, huella: `det:${vehiculo.id}:${dia}` });
  }
  return out;
}

// Guarda las alertas nuevas (las repetidas se ignoran por huella). Devuelve solo las nuevas.
export async function registrarAlertas(empresaId, vehiculo, reserva, lectura, alertas) {
  const nuevas = [];
  for (const a of alertas) {
    const [fila] = await q(`INSERT INTO gps_alertas (empresa_id, vehiculo_id, reserva_id, tipo, detalle, valor, lat, lng, ocurrido_en, huella)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8, coalesce($9, now()),$10) ON CONFLICT (empresa_id, huella) DO NOTHING RETURNING *`,
      [empresaId, vehiculo.id, reserva?.id || null, a.tipo, a.detalle, a.valor, lectura.lat, lectura.lng, a.tipo === 'sin_senal' ? lectura.en : null, a.huella]);
    if (fila) nuevas.push({ ...fila, patente: vehiculo.patente });
  }
  return nuevas;
}

// Aviso por correo a la empresa (una vez por sincronización, agrupado). En marcha blanca queda retenido.
export async function avisarAlertas(empresaId, nuevas) {
  const importantes = nuevas.filter((a) => a.tipo !== 'sin_senal');
  if (!importantes.length) return null;
  const e = await uno('SELECT nombre, correo FROM empresas WHERE id = $1', [empresaId]);
  if (!e?.correo) return null;
  const lineas = importantes.map((a) => `• ${formatearPatente(a.patente)} · ${TIPOS_ALERTA[a.tipo]}: ${a.detalle} (${fechaHora(a.ocurrido_en)})`);
  return encolar({
    empresaId, canal: 'correo', destino: e.correo,
    asunto: `Plataforma GPS: ${importantes.length} alerta${importantes.length > 1 ? 's' : ''} nueva${importantes.length > 1 ? 's' : ''} · ${e.nombre}`,
    cuerpo: `Se registraron nuevas alertas de la flota:\n\n${lineas.join('\n')}\n\nRevísalas y atiéndelas en Plataforma GPS.`,
    entidad: 'gps_alerta', entidadId: importantes[0].id
  });
}
