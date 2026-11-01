// Búsqueda por palabras (fase 1 de estandarización, 1-nov-2026; regla de Pablo del 21-oct en Síguelo Gestión):
// «Juan Pérez» tiene que encontrar a «Juan Carlos Pérez González». Antes cada lista buscaba el texto entero con
// ILIKE '%juan pérez%', que no calza si entre las palabras hay otras, y con tildes distintas («Perez» no encontraba
// «Pérez»).
//
// Ahora el texto se parte en palabras y CADA palabra tiene que aparecer (en cualquier orden) en alguna de las columnas,
// sin importar mayúsculas ni tildes. La comparación usa la función SQL sin_tildes() (migración 180), que hace lo mismo
// que sinTildes() de aquí.

// minúsculas, sin tildes ni diéresis (la ñ queda como n: «Muñoz» = «munoz»), espacios simples
export const sinTildes = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

// Palabras del texto buscado (máximo 8; sin los comodines de LIKE, que se tomarían como «cualquier cosa»).
export const palabras = (q) => sinTildes(q).replace(/[%_\\]/g, ' ').split(' ').filter(Boolean).slice(0, 8);

// Condición SQL para un WHERE: cada palabra en alguna de las columnas. Los valores se agregan a `params` (posicionales
// $n, como el resto del código) y se devuelve el SQL, o null si no hay palabras.
//   Una columna es una expresión SQL ('c.nombre', "coalesce(c.apellidos,'')") o { col, limpiar: true } para patentes y
//   documentos, que se comparan sin guiones ni puntos por los dos lados («ab-1234» calza con «AB1234» y al revés).
//   porPalabras(['c.nombre', 'c.correo', { col: 'c.documento', limpiar: true }], 'juan perez', params)
//   → ((sin_tildes(c.nombre) LIKE $2 OR …) AND (sin_tildes(c.nombre) LIKE $4 OR …))
const limpio = (w) => w.replace(/[-.\s]/g, '');
export function porPalabras(columnas, q, params) {
  const ps = palabras(q);
  if (!ps.length || !columnas.length) return null;
  const partes = ps.map((p) => `(${columnas.map((c) => {
    if (typeof c === 'string') { params.push(`%${p}%`); return `sin_tildes(${c}) LIKE $${params.length}`; }
    params.push(`%${limpio(p)}%`);
    return `sin_tildes(replace(replace(${c.col}, '-', ''), '.', '')) LIKE $${params.length}`;
  }).join(' OR ')})`);
  return `(${partes.join(' AND ')})`;
}

// ¿El texto calza con lo buscado? (lo mismo en JavaScript, para filtrar listas ya cargadas)
export function calza(texto, q) {
  const t = sinTildes(texto);
  return palabras(q).every((p) => t.includes(p));
}
