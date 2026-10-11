// UF, dólar observado y UTM desde fuentes oficiales, nunca ingresados a mano.
// 1) API de la CMF (Comisión para el Mercado Financiero) si hay API_KEY_CMF (la misma clave que usa el dashboard Síguelo).
// 2) mindicador.cl, que publica los valores del Banco Central de Chile (sin clave).
// Se guardan por día en la tabla indicadores; si un día no se puede leer, se usa el último conocido avisando su fecha.
import { q, uno } from './db.js';
import { registrarTarea } from './tareas.js';

const NOMBRES = { uf: 'UF', dolar: 'Dólar observado', utm: 'UTM' };
const RANGO = { uf: [20000, 100000], dolar: [300, 3000], utm: [40000, 200000] };
const CMF = { uf: ['uf', 'UFs'], dolar: ['dolar', 'Dolares'], utm: ['utm', 'UTMs'] };
let fetchImpl = (...a) => fetch(...a);
export const _usarFetch = (f) => { fetchImpl = f || ((...a) => fetch(...a)); };

const hoyChile = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
const plausible = (codigo, v) => Number.isFinite(v) && v >= RANGO[codigo][0] && v <= RANGO[codigo][1];

// La CMF entrega «39.512,34» (formato chileno)
const numeroChileno = (t) => Number(String(t).trim().replace(/\./g, '').replace(',', '.'));

async function desdeCmf(codigo) {
  const clave = process.env.API_KEY_CMF;
  if (!clave) throw new Error('sin API_KEY_CMF');
  const [recurso, llave] = CMF[codigo];
  const r = await fetchImpl(`https://api.cmfchile.cl/api-sbifv3/recursos_api/${recurso}?apikey=${encodeURIComponent(clave)}&formato=json`, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`CMF respondió ${r.status}`);
  const j = await r.json();
  const fila = (j[llave] || j[llave.toUpperCase()] || [])[0];
  const valor = fila ? numeroChileno(fila.Valor ?? fila.valor) : NaN;
  if (!plausible(codigo, valor)) throw new Error(`CMF: valor inválido (${fila?.Valor})`);
  return { valor, fecha: String(fila.Fecha || fila.fecha || hoyChile()).slice(0, 10), fuente: 'CMF Chile' };
}

async function desdeMindicador(codigo) {
  const r = await fetchImpl(`https://mindicador.cl/api/${codigo}`, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`mindicador.cl respondió ${r.status}`);
  const j = await r.json();
  const fila = j?.serie?.[0];
  const valor = Number(fila?.valor);
  if (!plausible(codigo, valor)) throw new Error('mindicador.cl: valor inválido');
  const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date(fila.fecha));
  return { valor, fecha, fuente: 'Banco Central de Chile (vía mindicador.cl)' };
}

export async function actualizarIndicadores() {
  const res = {};
  for (const codigo of Object.keys(NOMBRES)) {
    const fuentes = process.env.API_KEY_CMF ? [desdeCmf, desdeMindicador] : [desdeMindicador, desdeCmf];
    const errores = [];
    for (const f of fuentes) {
      try {
        const v = await f(codigo);
        await q(`INSERT INTO indicadores (codigo, fecha, valor, fuente) VALUES ($1,$2,$3,$4)
                 ON CONFLICT (codigo, fecha) DO UPDATE SET valor = EXCLUDED.valor, fuente = EXCLUDED.fuente, leido_en = now()`, [codigo, v.fecha, v.valor, v.fuente]);
        res[codigo] = v;
        break;
      } catch (e) { errores.push(e.message); }
    }
    if (!res[codigo]) { res[codigo] = { error: errores.join(' · ') }; console.error(`[indicadores] ${codigo}: ${errores.join(' · ')}`); }
  }
  return res;
}

// Último valor conocido: { codigo, nombre, valor, fecha, fuente, antiguo } o null si nunca se pudo leer.
export async function indicador(codigo) {
  const r = await uno('SELECT codigo, fecha, valor, fuente, leido_en FROM indicadores WHERE codigo = $1 AND fecha <= $2::date ORDER BY fecha DESC LIMIT 1', [codigo, hoyChile()]);
  if (!r) return null;
  const dias = Math.round((Date.parse(hoyChile()) - Date.parse(r.fecha)) / 864e5);
  // La UF tiene valor todos los días; el dólar no se publica fines de semana y la UTM es mensual.
  const antiguo = codigo === 'uf' ? dias > 1 : codigo === 'dolar' ? dias > 4 : dias > 35;
  return { ...r, nombre: NOMBRES[codigo], antiguo };
}

export async function indicadores() {
  const out = {};
  for (const c of Object.keys(NOMBRES)) out[c] = await indicador(c);
  return out;
}

export async function valorUf() {
  const i = await indicador('uf');
  if (!i) throw Object.assign(new Error('Todavía no se ha podido leer la UF de la fuente oficial. Inténtalo en unos minutos.'), { estado: 503 });
  return i.valor;
}

registrarTarea('indicadores', 6 * 3600e3, actualizarIndicadores);
