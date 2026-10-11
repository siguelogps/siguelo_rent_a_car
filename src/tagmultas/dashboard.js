// Conector con el dashboard Síguelo (integración 'dashboard_siguelo': url, cliente, api_key, sincronizar_cada_horas).
// Contrato (encabezado X-Api-Key):
//   GET {url}/api/integracion/v1/salud → { ok, cliente, clave, permisos, vehiculos }
//   GET {url}/api/integracion/v1/tag/pasadas?desde=AAAA-MM-DD&hasta=AAAA-MM-DD[&patentes=AAAA11,BBBB22]
//       → { ok, desde, hasta, pasadas: [{ id, patente, fecha_hora (ISO con zona), portico, autopista, monto, monto_neto }], errores: [{ patente, motivo, codigo }] }
//       (puede tardar: 180 s de espera; tramos de máximo 7 días y máximo 100 patentes por consulta)
//       Los tramos AVO llegan con portico «Tramo AVO: P x a P y» y autopista 'avo'.
//   GET {url}/api/integracion/v1/multas?desde=AAAA-MM-DD&hasta=AAAA-MM-DD[&patentes=...]
//       → { ok, utm, multas: [{ id, patente, fecha (AAAA-MM-DD), motivo, lugar, juzgado, tipo, monto (CLP o null = sin valorizar), vigente }],
//           cobertura: [{ patente, estado: 'revisada'|'fallida'|'nunca', revisado_en }], errores: [{ patente, motivo, codigo }] }
//   errores[].codigo: 'CONSULTA_FALLIDA' | 'NO_ES_DE_LA_FLOTA'.
//   HTTP: 400 rango > 31 días o > 120 vehículos · 401 clave inválida · 403 clave sin permiso · 404 ninguna patente es de la flota ·
//         409 el cliente nunca cargó su flota · 502 falla al consultar (nunca es «sin datos») · 503 base del dashboard caída (reintentar).
// Tarea «dashboard_tag_multas» (cada hora): sincroniza cuando la última tiene más de sincronizar_cada_horas.
// Pide desde la última sincronización − 2 días (la primera vez, 30 días), solo las patentes de la empresa;
// importa con origen 'dashboard' (huella 'dash:' + id) y asigna automáticamente.
import { q, uno } from '../db.js';
import { leer } from '../integraciones/index.js';
import { registrarProbador } from '../integraciones/probadores.js';
import { registrarTarea } from '../tareas.js';
import { desdeLocal } from '../util/formato.js';
import { importarRegistros } from './importar.js';

let fetchImpl = (...a) => fetch(...a);
export function _usarFetch(fn) { fetchImpl = fn || ((...a) => fetch(...a)); }

const DIA = 864e5;
export const TRAMO_DIAS = 7;
export const LOTE_PATENTES = 100;
const isoDia = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(d);
const sumarDias = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DIA).toISOString().slice(0, 10);
const norm = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const MENSAJES_HTTP = {
  400: 'el dashboard rechazó la consulta (rango mayor a 31 días o más de 120 vehículos)',
  401: 'el dashboard rechazó la clave de integración (clave inválida)',
  403: 'la clave de integración no tiene permiso para esta consulta',
  404: 'ninguna de las patentes consultadas pertenece a la flota del cliente en el dashboard',
  409: 'el cliente todavía no ha cargado su flota en el dashboard',
  502: 'el dashboard no pudo completar la consulta (se reintentará; no se tomó como «sin datos»)',
  503: 'la base de datos del dashboard no está disponible en este momento (se reintentará más tarde)'
};
export class ErrorDashboard extends Error {
  constructor(mensaje, http = null) { super(mensaje); this.http = http; this.reintentar = [502, 503].includes(http) || http == null; }
}

export async function llamar(config, ruta, params = {}, timeout = 30000) {
  if (!config?.url) throw new ErrorDashboard('Falta la URL del dashboard', 0);
  if (!config?.api_key && !config?.token_plataforma) throw new ErrorDashboard('Conecta primero la plataforma GPS (Configuración › Integraciones): el dashboard usa esa misma conexión', 0);
  const u = new URL(`${String(config.url).replace(/\/+$/, '')}/api/integracion/v1/${ruta}`);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
  let r;
  try {
    r = await fetchImpl(u.toString(), { headers: { ...(config.api_key ? { 'X-Api-Key': config.api_key } : { 'X-Token-Plataforma': config.token_plataforma, 'X-Cuenta-Plataforma': config.cuenta_plataforma || 'hosting' }), Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    throw new ErrorDashboard(e.name === 'TimeoutError' ? `El dashboard no respondió en ${Math.round(timeout / 1000)} s` : `No se pudo conectar con el dashboard (${e.message})`);
  }
  let j = null;
  try { j = await r.json(); } catch { /* respuesta sin JSON */ }
  if (!r.ok) {
    const det = j?.error || j?.mensaje;
    throw new ErrorDashboard(`Dashboard (HTTP ${r.status}): ${MENSAJES_HTTP[r.status] || 'error inesperado'}${det ? ` — ${det}` : ''}`, r.status);
  }
  if (!j || j.ok === false) throw new ErrorDashboard(`Dashboard: ${j?.error || j?.mensaje || 'respuesta no válida'}`, 502);
  return j;
}

export const salud = (config) => llamar(config, 'salud', {}, 20000);

// errores[] del dashboard → texto para la bitácora de importaciones
export const textoError = (e) => (typeof e === 'string' ? e
  : `${e?.patente ? `${e.patente}: ` : ''}${e?.motivo || e?.mensaje || 'error'}${e?.codigo ? ` (${e.codigo === 'CONSULTA_FALLIDA' ? 'consulta fallida' : e.codigo === 'NO_ES_DE_LA_FLOTA' ? 'no es de la flota del dashboard' : e.codigo})` : ''}`);

const lotes = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out.length ? out : [[]]; };

// Pasadas TAG en tramos de 7 días y lotes de 100 patentes (el dashboard puede tardar en calcularlas)
export async function traerPasadas(config, desde, hasta, patentes = []) {
  const pasadas = [], errores = [];
  let fallidas = 0, consultas = 0;
  for (let d = desde; d <= hasta; d = sumarDias(d, TRAMO_DIAS)) {
    const h = sumarDias(d, TRAMO_DIAS - 1) < hasta ? sumarDias(d, TRAMO_DIAS - 1) : hasta;
    for (const lote of lotes(patentes, LOTE_PATENTES)) {
      consultas++;
      try {
        const j = await llamar(config, 'tag/pasadas', { desde: d, hasta: h, patentes: lote.join(',') }, 180000);
        pasadas.push(...(j.pasadas || []));
        errores.push(...(j.errores || []).map((e) => `TAG ${d} a ${h} · ${textoError(e)}`));
      } catch (e) {
        fallidas++;
        errores.push(`TAG ${d} a ${h}: ${e.message}`);
        if ([401, 403, 409].includes(e.http)) return { pasadas, errores, fallidas: consultas, consultas, bloqueo: e }; // no tiene sentido seguir
      }
    }
  }
  return { pasadas, errores, fallidas, consultas };
}

// Multas: el dashboard acepta hasta 31 días; se piden en tramos de 7 días y lotes de 100 patentes, igual que el TAG.
export async function traerMultas(config, desde, hasta, patentes = []) {
  const multas = [], cobertura = new Map(), errores = [];
  let utm = null, fallidas = 0, consultas = 0;
  for (let d = desde; d <= hasta; d = sumarDias(d, TRAMO_DIAS)) {
    const h = sumarDias(d, TRAMO_DIAS - 1) < hasta ? sumarDias(d, TRAMO_DIAS - 1) : hasta;
    for (const lote of lotes(patentes, LOTE_PATENTES)) {
      consultas++;
      try {
        const j = await llamar(config, 'multas', { desde: d, hasta: h, patentes: lote.join(',') }, 180000);
        multas.push(...(j.multas || []));
        for (const c of j.cobertura || []) cobertura.set(norm(c.patente), c); // la última respuesta es la más reciente
        if (j.utm != null) utm = j.utm;
        errores.push(...(j.errores || []).map((e) => `Multas ${d} a ${h} · ${textoError(e)}`));
      } catch (e) {
        fallidas++;
        errores.push(`Multas ${d} a ${h}: ${e.message}`);
        if ([401, 403, 409].includes(e.http)) return { multas, cobertura: [...cobertura.values()], utm, errores, fallidas: consultas, consultas };
      }
    }
  }
  const unicas = [...new Map(multas.map((m) => [m.id, m])).values()];
  return { multas: unicas, cobertura: [...cobertura.values()], utm, errores, fallidas, consultas };
}

const autopistaLegible = (a) => (String(a || '').trim().toLowerCase() === 'avo' ? 'AVO (Américo Vespucio Oriente)' : a || null);

// Pasada del dashboard → registro de importación
export const pasadaARegistro = (p) => ({
  huella: `dash:${p.id}`, patente: p.patente, fecha_hora: new Date(p.fecha_hora), portico: p.portico || null, autopista: autopistaLegible(p.autopista),
  monto: Math.round(Number(p.monto) || 0), monto_neto: p.monto_neto != null ? Math.round(Number(p.monto_neto)) : null
});
// Multa del dashboard: solo trae la fecha (registro MTT) → hora_conocida = false. Monto null → 0 y «sin valorizar».
export const multaARegistro = (m) => ({
  huella: `dash:${m.id}`, patente: m.patente, fecha_infraccion: desdeLocal(String(m.fecha).slice(0, 10), '00:00'), hora_conocida: false,
  motivo: m.motivo || null, lugar: m.lugar || null, juzgado: m.juzgado || null, tipo: m.tipo || null,
  monto: m.monto == null || !Number.isFinite(Number(m.monto)) ? 0 : Math.round(Number(m.monto)), sin_valorizar: m.monto == null || !Number.isFinite(Number(m.monto))
});

export const ultimaSincronizacion = (empresaId) => uno(`SELECT * FROM dashboard_sincronizaciones WHERE empresa_id = $1 ORDER BY creado_en DESC LIMIT 1`, [empresaId]);

export async function sincronizarEmpresa(empresaId, { usuarioId = null, config = null, hoy = isoDia(new Date()) } = {}) {
  const conf = config || (await leer(empresaId, 'dashboard_siguelo')).config;
  const ultimaOk = await uno(`SELECT hasta FROM dashboard_sincronizaciones WHERE empresa_id = $1 AND estado = 'ok' ORDER BY creado_en DESC LIMIT 1`, [empresaId]);
  let desde = ultimaOk ? sumarDias(String(ultimaOk.hasta).slice(0, 10), -2) : sumarDias(hoy, -30);
  if (desde < sumarDias(hoy, -60)) desde = sumarDias(hoy, -60); // si estuvo apagada mucho tiempo, no se piden meses de una vez
  const patentes = (await q('SELECT patente FROM vehiculos WHERE empresa_id = $1 AND activo ORDER BY patente', [empresaId])).map((v) => norm(v.patente));
  const propias = new Set(patentes);
  const deLaEmpresa = (p) => propias.has(norm(p));
  const nombre = `Dashboard Síguelo ${desde} a ${hoy}`;

  const tag = await traerPasadas(conf, desde, hoy, patentes);
  const pasadas = tag.pasadas.filter((p) => deLaEmpresa(p.patente));
  const mul = tag.bloqueo ? { multas: [], cobertura: [], utm: null, errores: [], fallidas: 0, consultas: 0 } : await traerMultas(conf, desde, hoy, patentes);
  const multas = mul.multas.filter((m) => deLaEmpresa(m.patente) && m.vigente !== false);
  const sinValor = multas.filter((m) => m.monto == null).length;

  // Los errores quedan en el registro de importaciones (pantalla Importaciones) aunque no haya filas nuevas.
  const impTag = pasadas.length || tag.errores.length ? await importarRegistros(empresaId, 'tag', pasadas.map(pasadaARegistro), { origen: 'dashboard', nombreArchivo: nombre, usuarioId, errores: tag.errores.map((error) => ({ error })) }) : null;
  const errMul = [...mul.errores, ...(sinValor ? [`${sinValor} multa${sinValor > 1 ? 's' : ''} sin valorizar por el dashboard: quedan con monto $0 hasta revisarlas`] : [])];
  const impMul = multas.length || errMul.length ? await importarRegistros(empresaId, 'multas', multas.map(multaARegistro), { origen: 'dashboard', nombreArchivo: nombre, usuarioId, errores: errMul.map((error) => ({ error })) }) : null;

  const errores = [...tag.errores, ...errMul];
  const consultas = tag.consultas + mul.consultas, fallidas = tag.fallidas + mul.fallidas;
  // Una consulta fallida (502/503/red) nunca se toma como «sin datos»: la sincronización queda parcial o con error y se reintenta.
  const estado = fallidas && fallidas >= consultas ? 'error' : fallidas ? 'parcial' : 'ok';
  const [s] = await q(`INSERT INTO dashboard_sincronizaciones (empresa_id, desde, hasta, estado, pasadas, multas, nuevas_tag, nuevas_multas, cobertura, utm, errores, usuario_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
  [empresaId, desde, hoy, estado, pasadas.length, multas.length, impTag?.nuevas || 0, impMul?.nuevas || 0,
    JSON.stringify(mul.cobertura.filter((c) => deLaEmpresa(c.patente))), mul.utm ?? null, JSON.stringify(errores.slice(0, 100)), usuarioId]);
  return { ...s, importacion_tag: impTag, importacion_multas: impMul };
}

// Tarea: cada hora revisa qué empresas tocan según su frecuencia. Si la última falló, reintenta a la hora siguiente.
export async function sincronizarTodo() {
  const filas = await q(`SELECT i.empresa_id FROM integraciones i JOIN empresas e ON e.id = i.empresa_id WHERE i.tipo = 'dashboard_siguelo' AND i.activa AND e.activa`);
  for (const { empresa_id: id } of filas) {
    const { activa, config } = await leer(id, 'dashboard_siguelo');
    if (!activa || !(config.api_key || config.token_plataforma) || !config.url) continue;
    const ult = await ultimaSincronizacion(id);
    const cada = Math.max(1, Number(config.sincronizar_cada_horas) || 24) * 3600e3;
    if (ult && ult.estado === 'ok' && Date.now() - new Date(ult.creado_en) < cada - 5 * 60e3) continue;
    try { await sincronizarEmpresa(id, { config }); }
    catch (e) { console.error(`[dashboard_tag_multas] empresa ${id}:`, e.message); }
  }
}
registrarTarea('dashboard_tag_multas', 3600e3, sincronizarTodo);

registrarProbador('dashboard_siguelo', async (config) => {
  const j = await salud(config);
  const esperado = config.usuario_plataforma || config.cliente;
  const aviso = esperado && j.cliente && String(j.cliente).toLowerCase() !== String(esperado).toLowerCase() ? ` (ojo: el dashboard responde como «${j.cliente}», no «${esperado}»)` : '';
  const permisos = Array.isArray(j.permisos) ? j.permisos.join(', ') : j.permisos && typeof j.permisos === 'object' ? Object.keys(j.permisos).filter((k) => j.permisos[k]).join(', ') : j.permisos;
  return `Conectado: ${j.cliente || 'cliente sin nombre'} · ${j.vehiculos ?? 0} vehículos${j.clave ? ` · clave «${j.clave}»` : ''}${permisos ? ` · permisos: ${permisos}` : ''}${aviso}`;
});
