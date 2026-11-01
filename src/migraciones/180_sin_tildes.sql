-- Fase 1 de estandarización (1-nov-2026): búsqueda por palabras sin importar mayúsculas ni tildes.
-- sin_tildes(texto) deja el texto en minúsculas y sin tildes ni diéresis (la ñ queda como n: «Muñoz» = «munoz»), igual
-- que sinTildes() de src/busqueda.js, para que el servidor y la pantalla comparen lo mismo.
-- Es SQL puro (translate), sin la extensión unaccent, para que funcione igual en PostgreSQL y en PGlite.
CREATE OR REPLACE FUNCTION sin_tildes(t text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT lower(translate(t,
    'áéíóúàèìòùäëïöüâêîôûãõçñÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÃÕÇÑ',
    'aeiouaeiouaeiouaeiouaocnAEIOUAEIOUAEIOUAEIOUAOCN'))
$$;
