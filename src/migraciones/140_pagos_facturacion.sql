-- Módulos 7 y 8: pagos en línea (enlace de pago), liquidación (PDF y opciones) y facturación electrónica (folios por CAF).

-- Enlace de pago para enviar por WhatsApp o correo: /api/pagos/link/<token>
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS link_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS pagos_link_token ON pagos (link_token) WHERE link_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS pagos_token_externo ON pagos (token_externo) WHERE token_externo IS NOT NULL;
CREATE INDEX IF NOT EXISTS pagos_referencia ON pagos (referencia) WHERE referencia IS NOT NULL;

-- Liquidación: PDF generado al aprobar, documento tributario elegido y avisos enviados.
ALTER TABLE liquidaciones ADD COLUMN IF NOT EXISTS pdf_archivo_id BIGINT REFERENCES archivos(id);
ALTER TABLE liquidaciones ADD COLUMN IF NOT EXISTS opciones JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE liquidaciones ADD COLUMN IF NOT EXISTS pago_saldo_id BIGINT REFERENCES pagos(id);

-- Documentos tributarios: nota de crédito referida, ambiente y mensaje para pantalla (motivo de retención o error).
ALTER TABLE documentos_tributarios ADD COLUMN IF NOT EXISTS dte_ref_id BIGINT REFERENCES documentos_tributarios(id);
ALTER TABLE documentos_tributarios ADD COLUMN IF NOT EXISTS ambiente TEXT;
ALTER TABLE documentos_tributarios ADD COLUMN IF NOT EXISTS mensaje TEXT;
ALTER TABLE documentos_tributarios ADD COLUMN IF NOT EXISTS xml_archivo_id BIGINT REFERENCES archivos(id);
ALTER TABLE documentos_tributarios ADD COLUMN IF NOT EXISTS anulado_por BIGINT REFERENCES documentos_tributarios(id);
CREATE INDEX IF NOT EXISTS dte_empresa ON documentos_tributarios (empresa_id, creado_en DESC);

-- Folios por tipo de DTE: rango del CAF vigente y siguiente folio a usar.
CREATE TABLE IF NOT EXISTS dte_folios (
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  tipo INT NOT NULL,                         -- 39, 33, 61
  desde BIGINT, hasta BIGINT,                -- rango autorizado en el CAF (NULL = aún no se lee el CAF)
  siguiente BIGINT NOT NULL DEFAULT 1,
  caf_archivo_id BIGINT REFERENCES archivos(id),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, tipo)
);
