// Interfaz de la plataforma GPS para el resto de los módulos (patio, liquidación, mantención).
// Mientras no haya conexión configurada, devuelve lo último guardado en vehiculos.gps_* (o km/combustible del vehículo).
// El módulo GPS (src/gps/wialon.js) reemplaza la lectura en vivo cuando la integración está activa.
import { uno } from '../db.js';

let lectorEnVivo = null; // async (empresaId, vehiculo) → { km, combustible, lat, lng, velocidad, motor, en }
export const registrarLectorEnVivo = (fn) => { lectorEnVivo = fn; };

// → { km, combustible (0-8), lat, lng, velocidad, motor, actualizado_en, origen: 'plataforma_gps'|'registro' }
export async function lecturaActual(empresaId, vehiculoId) {
  const v = await uno('SELECT * FROM vehiculos WHERE id = $1 AND empresa_id = $2', [vehiculoId, empresaId]);
  if (!v) return null;
  if (lectorEnVivo && v.gps_unidad_id) {
    try { const r = await lectorEnVivo(empresaId, v); if (r) return { ...r, origen: 'plataforma_gps' }; } catch { /* se usa lo guardado */ }
  }
  const tieneGps = v.gps_actualizado_en != null;
  return {
    km: v.gps_km ?? v.km, combustible: v.gps_combustible ?? v.combustible_nivel, lat: v.gps_lat, lng: v.gps_lng,
    velocidad: v.gps_velocidad, motor: v.gps_motor, actualizado_en: v.gps_actualizado_en, origen: tieneGps ? 'plataforma_gps' : 'registro'
  };
}
