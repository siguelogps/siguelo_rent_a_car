// RUT chileno: limpieza, dígito verificador (módulo 11), validación y formato 12.345.678-9.
export const limpiarRut = (rut) => String(rut || '').replace(/[^0-9kK]/g, '').toUpperCase();

export function dv(cuerpo) {
  let s = 0, m = 2;
  for (const d of String(cuerpo).split('').reverse()) { s += Number(d) * m; m = m === 7 ? 2 : m + 1; }
  const r = 11 - (s % 11);
  return r === 11 ? '0' : r === 10 ? 'K' : String(r);
}

export function validarRut(rut) {
  const l = limpiarRut(rut);
  if (l.length < 2) return false;
  const cuerpo = l.slice(0, -1);
  if (!/^\d{6,9}$/.test(cuerpo)) return false;
  return dv(cuerpo) === l.slice(-1);
}

// Forma guardada en la base: 12345678-9 (sin puntos)
export function normalizarRut(rut) {
  const l = limpiarRut(rut);
  return l.length < 2 ? '' : `${l.slice(0, -1)}-${l.slice(-1)}`;
}

export function formatearRut(rut) {
  const l = limpiarRut(rut);
  if (l.length < 2) return rut || '';
  const cuerpo = l.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cuerpo}-${l.slice(-1)}`;
}
