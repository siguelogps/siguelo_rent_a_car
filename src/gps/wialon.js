// Cliente de la Remote API de la plataforma GPS (Wialon). En pantalla siempre se dice «plataforma GPS».
// Configuración por empresa desde la integración 'gps' (url, token, recurso, geocerca_permitida, comandos…).
// - Sesión por token (token/login → eid), una por empresa; si caduca (error 1) se vuelve a abrir sola.
// - Unidades con posición (0x400), sensores (0x1000) y contadores (0x2000: cnm = kilometraje en km).
// - Combustible y motor: sensores calculados por la plataforma (unit/calc_last_message, en lote con core/batch).
// - Comandos: unit/exec_cmd (solo los usa src/gps/inmovilizar.js, con doble validación).
// - Geocercas: resource/get_zones_data y verificación local (punto en polígono, círculo con haversine, línea con ancho).
import { leer } from '../integraciones/index.js';
import { registrarProbador } from '../integraciones/probadores.js';
import { registrarLectorEnVivo } from './index.js';
import { q } from '../db.js';

const ERRORES = {
  1: 'sesión inválida', 2: 'servicio inválido', 3: 'resultado inválido', 4: 'entrada inválida', 5: 'error al ejecutar la solicitud',
  6: 'error desconocido', 7: 'acceso denegado', 8: 'usuario o token inválido (¿token vencido?)', 9: 'servidor de autorización no disponible',
  1001: 'no hay mensajes en el intervalo', 1003: 'solo se permite una solicitud a la vez por sesión', 2014: 'usuario bloqueado'
};
export const BANDERAS = { BASE: 0x1, POSICION: 0x400, SENSORES: 0x1000, CONTADORES: 0x2000, COMANDOS: 0x200 };
const BANDERAS_UNIDAD = BANDERAS.BASE | BANDERAS.POSICION | BANDERAS.SENSORES | BANDERAS.CONTADORES;
const SIN_DATO = -348201.3876; // valor que devuelve la plataforma cuando un sensor no tiene dato

// Para pruebas: permite reemplazar fetch (la plataforma no se llama de verdad en las pruebas).
let fetchImpl = (...a) => fetch(...a);
export function _usarFetch(fn) { fetchImpl = fn || ((...a) => fetch(...a)); sesiones.clear(); zonasCache.clear(); }

export const urlApi = (url) => {
  // La API es la misma para la plataforma y la versión Lite; una URL guardada que no sea http(s) (p. ej. un dato que
  // rellenó el navegador) se ignora.
  const base = (/^https?:\/\//i.test(String(url || '').trim()) ? String(url).trim() : 'https://hst-api.wialon.com').replace(/\/+$/, '');
  return /\/wialon\/ajax\.html$/i.test(base) ? base : `${base}/wialon/ajax.html`;
};

export class ClienteGps {
  constructor({ url, token }) {
    this.url = urlApi(url);
    this.token = token;
    this.sid = null;
    this.cola = Promise.resolve();
  }

  // La plataforma admite una solicitud a la vez por sesión: se encolan.
  llamar(svc, params = {}) {
    const t = this.cola.then(() => this._llamar(svc, params, true));
    this.cola = t.catch(() => undefined);
    return t;
  }

  async _llamar(svc, params, reintentar) {
    if (!this.sid && svc !== 'token/login') await this._login();
    const body = new URLSearchParams({ svc, params: JSON.stringify(params) });
    if (this.sid && svc !== 'token/login') body.set('sid', this.sid);
    let res;
    try {
      res = await fetchImpl(this.url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(30000) });
    } catch (e) {
      throw new Error(`No se pudo conectar con la plataforma GPS (${e.name === 'TimeoutError' ? 'sin respuesta en 30 s' : e.message})`);
    }
    if (!res.ok) throw new Error(`Plataforma GPS ${svc}: HTTP ${res.status}`);
    const json = await res.json();
    if (json && typeof json === 'object' && !Array.isArray(json) && json.error) {
      if (json.error === 1 && reintentar && svc !== 'token/login') {
        this.sid = null;
        await this._login();
        return this._llamar(svc, params, false);
      }
      throw Object.assign(new Error(`Plataforma GPS ${svc}: error ${json.error} (${ERRORES[json.error] || 'sin descripción'})${json.reason ? ` — ${json.reason}` : ''}`), { codigo: json.error });
    }
    return json;
  }

  async _login() {
    if (!this.token) throw new Error('Falta el token de la plataforma GPS (Configuración › Integraciones)');
    this.sid = null;
    const r = await this._llamar('token/login', { token: this.token }, false);
    if (!r?.eid) throw new Error('La plataforma GPS no devolvió una sesión (revisa el token)');
    this.sid = r.eid;
    this.usuario = r.user?.nm || null;
    return r;
  }

  async buscarUnidades(flags = BANDERAS_UNIDAD) {
    const r = await this.llamar('core/search_items', {
      spec: { itemsType: 'avl_unit', propName: 'sys_name', propValueMask: '*', sortType: 'sys_name' }, force: 1, flags, from: 0, to: 0
    });
    return r.items || [];
  }

  async unidad(id, flags = BANDERAS_UNIDAD) {
    const r = await this.llamar('core/search_item', { id: Number(id), flags });
    return r.item || null;
  }

  // Valores calculados de los sensores (con sus tablas aplicadas) de varias unidades, en lotes de 50.
  async sensoresCalculados(ids) {
    const out = new Map();
    for (let i = 0; i < ids.length; i += 50) {
      const lote = ids.slice(i, i + 50);
      const r = await this.llamar('core/batch', { params: lote.map((id) => ({ svc: 'unit/calc_last_message', params: { unitId: Number(id), flags: 1 } })), flags: 0 });
      const filas = Array.isArray(r) ? r : [];
      lote.forEach((id, k) => { const f = filas[k]; out.set(String(id), f && typeof f === 'object' && !f.error ? f : {}); });
    }
    return out;
  }

  ejecutarComando(unidadId, comando) {
    return this.llamar('unit/exec_cmd', { itemId: Number(unidadId), commandName: comando, linkType: '', param: '', timeout: 60, flags: 0 });
  }

  async recursosConZonas(nombre) {
    const r = await this.llamar('core/search_items', {
      spec: { itemsType: 'avl_resource', propName: 'sys_name', propValueMask: nombre ? `*${nombre}*` : '*', sortType: 'sys_name' }, force: 1, flags: 0x1 | 0x1000, from: 0, to: 0
    });
    return r.items || [];
  }

  async datosZonas(recursoId, zonasIds) {
    const r = await this.llamar('resource/get_zones_data', { itemId: Number(recursoId), col: zonasIds.map(Number), flags: 0x1C });
    return Array.isArray(r) ? r : [];
  }
}

// ── Sesión por empresa (se reutiliza mientras no cambien url/token) ──
const sesiones = new Map(); // empresaId → { clave, cliente }
export async function clienteDe(empresaId, config = null) {
  const conf = config || (await leer(empresaId, 'gps')).config;
  if (!conf.token) throw new Error('La plataforma GPS no está configurada (falta el token)');
  const clave = `${urlApi(conf.url)}|${conf.token}`;
  const s = sesiones.get(empresaId);
  if (s && s.clave === clave) return s.cliente;
  const cliente = new ClienteGps(conf);
  sesiones.set(empresaId, { clave, cliente });
  return cliente;
}

// ── Lectura de sensores ──
const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export function sensorCombustible(sens = {}) {
  const lista = Object.values(sens || {});
  return lista.find((s) => s.t === 'fuel level') || lista.find((s) => /combust|fuel|estanque|nivel de comb/.test(sinAcentos(s.n)) && !/consumo|consumption|rate/.test(sinAcentos(s.n))) || null;
}
export function sensorMotor(sens = {}) {
  const lista = Object.values(sens || {});
  return lista.find((s) => s.t === 'engine operation') || lista.find((s) => /motor|igni|encend|engine|contacto/.test(sinAcentos(s.n)) && !/bloq|corte|inmov|horas|hours|rpm|temp/.test(sinAcentos(s.n))) || null;
}
// Valor del sensor de combustible → octavos (0-8), como el resto del sistema.
export function aOctavos(valor, sensor, capacidadLitros = null) {
  const v = Number(valor);
  if (!Number.isFinite(v) || v === SIN_DATO || v < 0) return null;
  const m = sinAcentos(sensor?.m);
  let frac;
  if (m.includes('%')) frac = v / 100;
  else if (/^l|lt|litro/.test(m) && capacidadLitros) frac = v / capacidadLitros;
  else if (capacidadLitros && v > 100) frac = v / capacidadLitros;
  else if (v <= 100) frac = v / 100;
  else return null;
  return Math.max(0, Math.min(8, Math.round(frac * 8)));
}

// Unidad de la plataforma → lectura normalizada.
export function normalizarUnidad(it, valores = {}, capacidad = null) {
  const p = it.pos || it.lmsg?.pos || null;
  const sc = sensorCombustible(it.sens), sm = sensorMotor(it.sens);
  const km = it.cnm_km ?? (it.cnm && typeof it.cnm === 'object' ? it.cnm.mileage : it.cnm);
  let motor = null;
  if (sm && valores[sm.id] != null && Number(valores[sm.id]) !== SIN_DATO) motor = Number(valores[sm.id]) > 0;
  const t = p?.t ?? it.lmsg?.t ?? null;
  return {
    id: String(it.id), nombre: it.nm || '',
    lat: p && Number.isFinite(p.y) ? p.y : null, lng: p && Number.isFinite(p.x) ? p.x : null,
    velocidad: p && p.s != null ? Math.round(Number(p.s)) : null, curso: p?.c ?? null,
    en: t ? new Date(Number(t) * 1000) : null,
    km: km != null && Number.isFinite(Number(km)) ? Math.round(Number(km)) : null,
    motor, combustible: sc ? aOctavos(valores[sc.id], sc, capacidad) : null
  };
}

// Todas las unidades de la empresa, con sensores calculados.
export async function leerUnidades(empresaId, { config = null, conSensores = true } = {}) {
  const c = await clienteDe(empresaId, config);
  const items = await c.buscarUnidades();
  const conSens = conSensores ? items.filter((i) => sensorCombustible(i.sens) || sensorMotor(i.sens)).map((i) => i.id) : [];
  const valores = conSens.length ? await c.sensoresCalculados(conSens) : new Map();
  const capacidades = new Map((await q('SELECT gps_unidad_id, capacidad_estanque FROM vehiculos WHERE empresa_id = $1 AND gps_unidad_id IS NOT NULL', [empresaId])).map((v) => [v.gps_unidad_id, v.capacidad_estanque]));
  return items.map((it) => normalizarUnidad(it, valores.get(String(it.id)) || {}, capacidades.get(String(it.id))));
}

export async function leerUnidad(empresaId, unidadId, capacidad = null, config = null) {
  const c = await clienteDe(empresaId, config);
  const it = await c.unidad(unidadId);
  if (!it) return null;
  const valores = (sensorCombustible(it.sens) || sensorMotor(it.sens)) ? (await c.sensoresCalculados([it.id])).get(String(it.id)) : {};
  return normalizarUnidad(it, valores, capacidad);
}

export async function enviarComando(empresaId, unidadId, comando, config = null) {
  const c = await clienteDe(empresaId, config);
  return c.ejecutarComando(unidadId, comando);
}

// ── Geometría ──
const R_TIERRA = 6371000;
const rad = (g) => (g * Math.PI) / 180;
export function haversine(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_TIERRA * Math.asin(Math.min(1, Math.sqrt(a)));
}
// Rayo horizontal (par/impar). puntos: [{x: lng, y: lat}]
export function puntoEnPoligono(lat, lng, puntos) {
  let dentro = false;
  for (let i = 0, j = puntos.length - 1; i < puntos.length; j = i++) {
    const xi = puntos[i].x, yi = puntos[i].y, xj = puntos[j].x, yj = puntos[j].y;
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}
// Distancia (m) de un punto a un segmento, con proyección equirrectangular local (suficiente para geocercas).
function distanciaSegmento(lat, lng, a, b) {
  const k = Math.cos(rad(lat)) * R_TIERRA * Math.PI / 180, kl = R_TIERRA * Math.PI / 180;
  const px = lng * k, py = lat * kl, ax = a.x * k, ay = a.y * kl, bx = b.x * k, by = b.y * kl;
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
// Zona de la plataforma: t = 1 línea (w = ancho), 2 polígono, 3 círculo (p[0] = centro, r o w = radio en m)
export function dentroDeZona(zona, lat, lng) {
  const p = zona.p || [];
  if (!p.length || lat == null || lng == null) return null;
  if (zona.t === 3) return haversine(lat, lng, p[0].y, p[0].x) <= Number(p[0].r || zona.w || 0);
  if (zona.t === 1) {
    const ancho = Number(zona.w || 0) / 2;
    for (let i = 1; i < p.length; i++) if (distanciaSegmento(lat, lng, p[i - 1], p[i]) <= Math.max(ancho, Number(p[i].r || 0))) return true;
    return false;
  }
  return puntoEnPoligono(lat, lng, p);
}

// Geocerca «zona permitida» (por nombre) desde el recurso configurado. Se guarda 1 hora.
const zonasCache = new Map(); // empresaId → { clave, en, zonas }
export async function zonaPermitida(empresaId, config = null) {
  const conf = config || (await leer(empresaId, 'gps')).config;
  const nombre = String(conf.geocerca_permitida || '').trim();
  if (!nombre || !conf.token) return null;
  const clave = `${conf.recurso || ''}|${nombre}`;
  const c = zonasCache.get(empresaId);
  if (c && c.clave === clave && Date.now() - c.en < 3600e3) return c.zonas;
  const cli = await clienteDe(empresaId, conf);
  const buscado = sinAcentos(nombre);
  const zonas = [];
  for (const rec of await cli.recursosConZonas(conf.recurso || '')) {
    const ids = Object.values(rec.zl || {}).filter((z) => sinAcentos(z.n) === buscado || sinAcentos(z.n).includes(buscado)).map((z) => z.id);
    if (ids.length) zonas.push(...(await cli.datosZonas(rec.id, ids)));
  }
  const res = zonas.length ? { nombre, zonas } : null;
  zonasCache.set(empresaId, { clave, en: Date.now(), zonas: res });
  return res;
}
// true dentro, false fuera, null si no hay geocerca o posición
export function dentroDePermitida(zp, lat, lng) {
  if (!zp?.zonas?.length || lat == null || lng == null) return null;
  return zp.zonas.some((z) => dentroDeZona(z, lat, lng));
}

// ── Integración con el resto del sistema ──
// Lectura en vivo para patio, liquidación y mantención (src/gps/index.js → lecturaActual).
registrarLectorEnVivo(async (empresaId, v) => {
  const { activa, config } = await leer(empresaId, 'gps');
  if (!activa || !config.token || !v.gps_unidad_id) return null; // se usa lo último guardado
  const u = await leerUnidad(empresaId, v.gps_unidad_id, v.capacidad_estanque, config);
  if (!u) return null;
  return { km: u.km ?? v.gps_km ?? v.km, combustible: u.combustible ?? v.gps_combustible ?? v.combustible_nivel, lat: u.lat, lng: u.lng, velocidad: u.velocidad, motor: u.motor, actualizado_en: u.en };
});

// Prueba de conexión (Configuración › Integraciones › Probar)
registrarProbador('gps', async (config, empresaId) => {
  if (!config.token) throw new Error('Falta conectar con el usuario y la clave de la plataforma GPS');
  const c = new ClienteGps(config);
  const items = await c.buscarUnidades(BANDERAS.BASE);
  let extra = '';
  if (config.geocerca_permitida && empresaId) {
    zonasCache.delete(empresaId);
    try { extra = (await zonaPermitida(empresaId, config)) ? ` · geocerca «${config.geocerca_permitida}» encontrada` : ` · no se encontró la geocerca «${config.geocerca_permitida}»`; } catch { /* la geocerca es opcional */ }
  }
  return `Conectado: ${items.length} unidades${extra}`;
});
