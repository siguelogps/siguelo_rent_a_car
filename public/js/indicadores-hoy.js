// Textos de los indicadores del día («Retiros hoy», «Devoluciones hoy», «Atrasadas»), los mismos en Inicio y en Reservas.
//
// Auditoría 8-nov (On Rent #14): el mismo indicador decía cosas distintas en cada pantalla («confirmados» y «sin retiros
// pendientes», «en curso que vuelven hoy» y «todas en su sucursal», «R-1009» y «RKDS-90 · 5 h de atraso»). Ahora los dos
// salen de esta función. Módulo puro (sin imports): los ayudantes de formato llegan como parámetro y se prueba en Node.

/** Inicio recibe listas; Reservas, conteos. Esto lleva las listas de Inicio a los mismos conteos. */
export function resumenDesdeListas({ retiros = [], devoluciones = [], atrasadas = [] }) {
  const porSucursal = new Map();
  for (const r of retiros) if (r.sucursal_retiro) porSucursal.set(r.sucursal_retiro, (porSucursal.get(r.sucursal_retiro) || 0) + 1);
  const [nombre, n] = [...porSucursal.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  return {
    retiros: retiros.length,
    retiros_sucursal: nombre ? { nombre, n } : null,
    devoluciones: devoluciones.length,
    devoluciones_otra: devoluciones.filter((r) => r.sucursal_devolucion && r.sucursal_retiro && r.sucursal_devolucion !== r.sucursal_retiro).length,
    atrasadas
  };
}

/** { retiros, devoluciones, atrasadas }: el texto chico de cada indicador (ya escapado). */
export function subtitulosHoy(k, { esc, patente, atrasoTxt }) {
  const atr = k.atrasadas?.[0];
  const masAtr = (k.atrasadas?.length || 0) - 1;
  return {
    retiros: !k.retiros ? 'sin retiros pendientes' : k.retiros_sucursal ? `${k.retiros_sucursal.n} en ${esc(k.retiros_sucursal.nombre)}` : 'confirmados',
    devoluciones: !k.devoluciones ? 'sin devoluciones hoy' : k.devoluciones_otra ? `${k.devoluciones_otra} en otra sucursal` : 'todas en su sucursal',
    atrasadas: !atr ? 'ninguna' : `${esc(atr.patente ? patente(atr.patente) : atr.folio)} · ${atrasoTxt(atr.fin)}${masAtr > 0 ? ` y ${masAtr} más` : ''}`
  };
}
