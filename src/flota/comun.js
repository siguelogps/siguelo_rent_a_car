// Ayudas compartidas por Flota, Tarifas y Mantención: limpieza de datos del formulario, patentes y vencimientos.
import { uno } from '../db.js';
import { ErrorHttp } from '../auth.js';
import { normalizarPatente } from '../util/patente.js';
import { aIsoFecha } from '../util/formato.js';

export const HOY_SQL = `(now() AT TIME ZONE 'America/Santiago')::date`;
export const hoyIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());

// Patentes chilenas: autos BBBB10 (desde 2007) y AB1234 (antiguas); motos BBB10 y AB123.
const FORMATOS_PATENTE = [/^[A-Z]{4}\d{2}$/, /^[A-Z]{2}\d{4}$/, /^[A-Z]{3}\d{2}$/, /^[A-Z]{2}\d{3}$/];
export function validarPatente(p) {
  const n = normalizarPatente(p);
  if (!n) throw new ErrorHttp(400, 'Ingresa la patente.', { campo: 'patente' });
  if (!FORMATOS_PATENTE.some((re) => re.test(n))) throw new ErrorHttp(400, `La patente «${p}» no tiene un formato chileno válido (ej.: SXLR-27 o AB-1234).`, { campo: 'patente' });
  return n;
}

/**
 * limpiar(body, { campo: tipo }) → objeto solo con los campos presentes en body, convertidos.
 * tipos: 'texto', 'entero', 'monto', 'fecha', 'bool', 'id', 'numero'
 */
export function limpiar(body = {}, tipos = {}) {
  const o = {};
  for (const [k, tipo] of Object.entries(tipos)) {
    if (!(k in body)) continue;
    let v = body[k];
    if (typeof v === 'string') v = v.trim();
    if (v === '' || v === undefined) v = null;
    if (v !== null) {
      if (tipo === 'entero' || tipo === 'id' || tipo === 'monto') {
        const n = typeof v === 'number' ? v : Number(String(v).replace(/[$.\s]/g, '').replace(',', '.'));
        if (!Number.isFinite(n)) throw new ErrorHttp(400, `El valor de «${k}» no es un número válido.`, { campo: k });
        v = Math.round(n);
        if (tipo === 'monto' && v < 0) throw new ErrorHttp(400, `El monto de «${k}» no puede ser negativo.`, { campo: k });
      } else if (tipo === 'numero') {
        const n = Number(String(v).replace(',', '.'));
        if (!Number.isFinite(n)) throw new ErrorHttp(400, `El valor de «${k}» no es un número válido.`, { campo: k });
        v = n;
      } else if (tipo === 'fecha') {
        const f = v instanceof Date ? v.toISOString().slice(0, 10) : aIsoFecha(v);
        if (!f) throw new ErrorHttp(400, `La fecha de «${k}» no es válida (usa dd-mm-aaaa).`, { campo: k });
        v = f;
      } else if (tipo === 'bool') v = v === true || v === 'true' || v === 1 || v === '1' || v === 'si' || v === 'on';
      else v = String(v);
    } else if (tipo === 'bool') v = false;
    o[k] = v;
  }
  return o;
}

// INSERT / UPDATE dinámicos a partir de un objeto limpio
export function sqlInsert(tabla, datos) {
  const cols = Object.keys(datos);
  return { sql: `INSERT INTO ${tabla} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, params: cols.map((c) => datos[c]) };
}
export function sqlUpdate(tabla, datos, id, empresaId) {
  const cols = Object.keys(datos);
  if (!cols.length) return null;
  return {
    sql: `UPDATE ${tabla} SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${cols.length + 1} AND empresa_id = $${cols.length + 2} RETURNING *`,
    params: [...cols.map((c) => datos[c]), id, empresaId]
  };
}

// Verifica que un id referenciado pertenezca a la empresa (nunca confiar en ids del navegador)
export async function deLaEmpresa(tabla, id, empresaId, nombre = 'registro') {
  if (id == null) return null;
  const f = await uno(`SELECT * FROM ${tabla} WHERE id = $1 AND empresa_id = $2`, [id, empresaId]);
  if (!f) throw new ErrorHttp(400, `El ${nombre} elegido no existe.`);
  return f;
}

export const esDuplicado = (e) => e?.code === '23505' || /duplicate key|unique constraint/i.test(e?.message || '');

// Días entre hoy (Chile) y una fecha 'aaaa-mm-dd'
export const diasHasta = (f, hoy = hoyIso()) => (f ? Math.round((Date.parse(f) - Date.parse(hoy)) / 864e5) : null);

// Suma meses a una fecha 'aaaa-mm-dd'
export function sumarMeses(f, meses) {
  if (!f || !meses) return null;
  const [a, m, d] = f.split('-').map(Number);
  const x = new Date(Date.UTC(a, m - 1 + Number(meses), 1));
  const ultimo = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(d, ultimo));
  return x.toISOString().slice(0, 10);
}

export const VENCIMIENTOS = [
  ['venc_revision_tecnica', 'Revisión técnica'], ['venc_permiso_circulacion', 'Permiso de circulación'], ['venc_soap', 'SOAP'], ['venc_seguro', 'Seguro']
];

// Estado de mantención de un vehículo (por km según la plataforma GPS y por fecha)
export function mantencion(v, hoy = hoyIso()) {
  const km = v.gps_km ?? v.km ?? 0;
  const out = { km_actual: km, proxima_km: null, faltan_km: null, proxima_fecha: null, faltan_dias: null, por_km: false, por_fecha: false };
  if (v.mant_cada_km > 0) {
    out.proxima_km = (v.mant_ultima_km || 0) + v.mant_cada_km;
    out.faltan_km = out.proxima_km - km;
    out.por_km = out.faltan_km <= 1000;
  }
  if (v.mant_cada_meses > 0 && v.mant_ultima_fecha) {
    out.proxima_fecha = sumarMeses(v.mant_ultima_fecha, v.mant_cada_meses);
    out.faltan_dias = diasHasta(out.proxima_fecha, hoy);
    out.por_fecha = out.faltan_dias <= 30;
  }
  out.vencida = (out.faltan_km != null && out.faltan_km <= 0) || (out.faltan_dias != null && out.faltan_dias <= 0);
  return out;
}

// Ocupación de hoy, la misma en Inicio y en Reservas (antes Inicio dividía por toda la flota activa y contaba el estado
// «arrendado» del vehículo, mientras Reservas sacaba los fuera de servicio y contaba reservas en curso: 6 de 12 vs 6 de 11).
// Regla única: base = vehículos activos que se pueden arrendar (sin los fuera de servicio, igual que disponibilidad.js);
// ocupados = de esos, los que tienen una reserva en curso (la reserva manda, no el estado manual del vehículo).
export async function ocupacionHoy(empresaId) {
  return uno(`SELECT count(*) FILTER (WHERE v.estado <> 'fuera_servicio')::int AS total,
      count(*) FILTER (WHERE v.estado <> 'fuera_servicio' AND EXISTS (SELECT 1 FROM reservas r WHERE r.empresa_id = v.empresa_id AND r.vehiculo_id = v.id AND r.estado = 'en_curso'))::int AS ocupados
    FROM vehiculos v WHERE v.empresa_id = $1 AND v.activo`, [empresaId]);
}
