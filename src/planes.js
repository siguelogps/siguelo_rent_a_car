// Planes comerciales: qué módulos incluye cada uno y sus límites (vehículos, usuarios, sucursales).
// Los módulos base (inicio, configuración, integraciones, usuarios) están en todos los planes.
import { q, uno } from './db.js';
import { ErrorHttp } from './auth.js';

export const MODULOS_BASE = ['inicio', 'configuracion', 'integraciones', 'usuarios'];
export const MODULOS_PLAN = {
  reservas: 'Reservas y calendario', patio: 'Entregas y devoluciones (celular)', contratos: 'Contrato digital con firma y QR', clientes: 'Clientes y lista negra',
  flota: 'Flota y vencimientos', mantencion: 'Mantención', pagos: 'Pagos y garantías', liquidaciones: 'Liquidación al cierre', incidentes: 'Incidentes y daños',
  tarifas: 'Tarifas, extras y descuentos', gps: 'Plataforma GPS en vivo', inmovilizar: 'Inmovilización remota', tag_multas: 'TAG y multas',
  facturacion: 'Boleta y factura electrónica', reportes: 'Reportes y Excel', portal: 'Portal de reservas en línea'
};

const cache = new Map(); // empresaId → { plan, en }
export const limpiarCachePlanes = () => cache.clear();

export async function planDeEmpresa(empresaId) {
  const c = cache.get(empresaId);
  if (c && Date.now() - c.en < 30e3) return c.plan;
  const p = await uno(`SELECT p.* FROM empresas e LEFT JOIN planes p ON p.codigo = e.plan WHERE e.id = $1`, [empresaId]);
  const plan = p?.codigo ? p : null; // empresa con un plan que ya no existe: sin restricciones (no se bloquea a un cliente por un error de catálogo)
  cache.set(empresaId, { plan, en: Date.now() });
  return plan;
}

export async function incluye(empresaId, modulo) {
  if (!modulo || MODULOS_BASE.includes(modulo)) return true;
  const p = await planDeEmpresa(empresaId);
  return !p || p.modulos.includes(modulo);
}

const RECURSOS = {
  vehiculos: { campo: 'max_vehiculos', sql: 'SELECT count(*)::int AS n FROM vehiculos WHERE empresa_id = $1 AND activo', nombre: 'vehículos' },
  usuarios: { campo: 'max_usuarios', sql: 'SELECT count(*)::int AS n FROM usuarios WHERE empresa_id = $1 AND activo', nombre: 'usuarios' },
  sucursales: { campo: 'max_sucursales', sql: 'SELECT count(*)::int AS n FROM sucursales WHERE empresa_id = $1 AND activa', nombre: 'sucursales' }
};

// Lanza 403 si agregar `cantidad` más supera el límite del plan.
export async function verificarLimite(empresaId, recurso, cantidad = 1) {
  const p = await planDeEmpresa(empresaId);
  const r = RECURSOS[recurso];
  const max = p?.[r.campo];
  if (max == null) return;
  const [{ n }] = await q(r.sql, [empresaId]);
  if (n + cantidad > max) throw new ErrorHttp(403, `El plan ${p.nombre} permite hasta ${max} ${r.nombre} (hoy hay ${n}). Pide a Síguelo un cambio de plan.`);
}

export async function usoDeEmpresa(empresaId) {
  const out = {};
  for (const [k, r] of Object.entries(RECURSOS)) out[k] = (await q(r.sql, [empresaId]))[0].n;
  return out;
}
