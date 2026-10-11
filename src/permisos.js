// Permisos por rol. Cada módulo tiene nivel: null (sin acceso), 'ver' o 'editar'.
// El superadmin (equipo Síguelo) tiene todo y además administra las empresas.
export const ROLES = {
  superadmin: 'Síguelo (superadmin)',
  soporte: 'Síguelo (soporte)',
  administrador: 'Administrador',
  counter: 'Counter',
  patio: 'Patio',
  finanzas: 'Finanzas'
};

export const MODULOS = {
  inicio: 'Inicio', reservas: 'Reservas', patio: 'Entregas y devoluciones', contratos: 'Contratos', clientes: 'Clientes',
  flota: 'Vehículos', mantencion: 'Mantención', gps: 'Plataforma GPS', inmovilizar: 'Inmovilización remota',
  pagos: 'Pagos y garantías', liquidaciones: 'Liquidaciones', facturacion: 'Facturación', incidentes: 'Incidentes y daños',
  tag_multas: 'TAG y multas', reportes: 'Reportes', tarifas: 'Tarifas', configuracion: 'Configuración',
  integraciones: 'Integraciones', usuarios: 'Usuarios y permisos'
};

const E = 'editar', V = 'ver';
const MATRIZ = {
  administrador: Object.fromEntries(Object.keys(MODULOS).map((m) => [m, E])),
  counter: { inicio: V, reservas: E, patio: E, contratos: E, clientes: E, flota: V, mantencion: V, gps: V, inmovilizar: E, pagos: E, liquidaciones: V, incidentes: V, tag_multas: V, tarifas: V },
  patio: { inicio: V, reservas: V, patio: E, contratos: V, clientes: V, flota: V, mantencion: E, gps: V, incidentes: E },
  finanzas: { inicio: V, reservas: V, contratos: V, clientes: V, flota: V, mantencion: V, gps: V, pagos: E, liquidaciones: E, facturacion: E, incidentes: E, tag_multas: E, reportes: V, tarifas: V }
};

export function nivel(rol, modulo) {
  if (rol === 'superadmin' || rol === 'soporte') return E; // equipo Síguelo dentro de una empresa («ver como»)
  return MATRIZ[rol]?.[modulo] || null;
}
export const puede = (rol, modulo, accion = 'ver') => {
  const n = nivel(rol, modulo);
  return accion === 'ver' ? n === V || n === E : n === E;
};
export const permisosDe = (rol) => Object.fromEntries(Object.keys(MODULOS).map((m) => [m, nivel(rol, m)]));

// Equipo Síguelo: superadmin (todo, incluido el equipo y los planes) y soporte (empresas y «ver como»).
export const esSiguelo = (rol) => rol === 'superadmin' || rol === 'soporte';
