-- Indicadores económicos oficiales (UF, dólar observado, UTM): se leen solos, no se ingresan a mano.
CREATE TABLE indicadores (
  codigo TEXT NOT NULL CHECK (codigo IN ('uf','dolar','utm')),
  fecha DATE NOT NULL,
  valor NUMERIC(14,2) NOT NULL,
  fuente TEXT NOT NULL,
  leido_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (codigo, fecha)
);
