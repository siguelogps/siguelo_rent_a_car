// Listas por partes (fase 1 de estandarización, 1-nov-2026). Una lista que puede crecer nunca se pide entera: el
// servidor entrega como mucho `maximo` filas y la pantalla pide la parte siguiente con ?desde_fila= (o ?desde= numérico). En pantalla,
// public/paginador.js muestra de a 50 lo que llegó.
//   const { limite, desde, sql } = tramo(req);   →   `... ORDER BY x, id ${sql}`   (sql = 'LIMIT 500 OFFSET 0')
// El ORDER BY tiene que ser total (con el id al final): si varias filas empatan en la fecha, con OFFSET una misma fila
// podría salir en dos partes y otra en ninguna.
// Filas por página de una lista paginada en el servidor por página (?pagina=&por=): una de las opciones del selector
// «Filas por página» de public/paginador.js (10 · 25 · 50 · 100; 5-nov, RNT-11). Cualquier otro valor, el de omisión.
export const OPCIONES_POR_PAGINA = [10, 25, 50, 100];
export function porPagina(req, porDefecto = 50) {
  const n = Number(req.query?.por);
  return OPCIONES_POR_PAGINA.includes(n) ? n : porDefecto;
}

export function tramo(req, { porDefecto = 500, maximo = 1000 } = {}) {
  const limite = Math.min(maximo, Math.max(1, Math.floor(Number(req.query?.limite)) || porDefecto));
  // 5-nov (RNT-08): en varias listas ?desde= es también el filtro de fecha (facturación, pagos, TAG, reservas): una fila
  // «?desde=500» rompía la fecha y una fecha no es una fila. La fila de partida va en ?desde_fila= (sin ambigüedad);
  // ?desde= sigue valiendo como fila solo si es un número entero.
  const fila = req.query?.desde_fila ?? (/^\d+$/.test(String(req.query?.desde ?? '')) ? req.query.desde : 0);
  const desde = Math.max(0, Math.floor(Number(fila)) || 0);
  return { limite, desde, sql: `LIMIT ${limite} OFFSET ${desde}` };
}
