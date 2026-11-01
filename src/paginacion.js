// Listas por partes (fase 1 de estandarización, 1-nov-2026). Una lista que puede crecer nunca se pide entera: el
// servidor entrega como mucho `maximo` filas y la pantalla pide la parte siguiente con ?desde=. En pantalla,
// public/paginador.js muestra de a 50 lo que llegó.
//   const { limite, desde, sql } = tramo(req);   →   `... ORDER BY x, id ${sql}`   (sql = 'LIMIT 500 OFFSET 0')
// El ORDER BY tiene que ser total (con el id al final): si varias filas empatan en la fecha, con OFFSET una misma fila
// podría salir en dos partes y otra en ninguna.
export function tramo(req, { porDefecto = 500, maximo = 1000 } = {}) {
  const limite = Math.min(maximo, Math.max(1, Math.floor(Number(req.query?.limite)) || porDefecto));
  const desde = Math.max(0, Math.floor(Number(req.query?.desde)) || 0);
  return { limite, desde, sql: `LIMIT ${limite} OFFSET ${desde}` };
}
