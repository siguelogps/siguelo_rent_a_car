// Patentes chilenas: «SXLR-27», «sx lr 27», «SXLR27» → «SXLR27» (forma guardada) y «SXLR-27» (forma mostrada).
export const normalizarPatente = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export function formatearPatente(p) {
  const n = normalizarPatente(p);
  if (/^[A-Z]{4}\d{2}$/.test(n) || /^[A-Z]{2}\d{4}$/.test(n)) return `${n.slice(0, 4)}-${n.slice(4)}`;
  if (/^[A-Z]{3}\d{3}$/.test(n)) return `${n.slice(0, 3)}-${n.slice(3)}`; // motos
  return n;
}
