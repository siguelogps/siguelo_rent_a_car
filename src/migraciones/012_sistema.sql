-- Valores internos del sistema (p. ej. huella de la última SUPERADMIN_CLAVE aplicada).
CREATE TABLE sistema (
  clave TEXT PRIMARY KEY,
  valor TEXT,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
