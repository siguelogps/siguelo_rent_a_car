-- Módulo 5 (contratos): enlace de firma a distancia (tablet del counter o celular del cliente) y anulación.
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS token_firma TEXT UNIQUE;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS token_firma_vence TIMESTAMPTZ;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS anulado_motivo TEXT;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS anulado_en TIMESTAMPTZ;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS anulado_por BIGINT REFERENCES usuarios(id);
CREATE INDEX IF NOT EXISTS contratos_reserva ON contratos (empresa_id, reserva_id);
