-- Entrada desde el menú Apps de la plataforma GPS (estándar Síguelo OS). Solo agrega columnas.
--   empresas.gps_cuenta_id: id de la cuenta de la plataforma GPS que conectó la empresa (se anota al conectar o probar).
--     No es secreto: es lo que la plataforma dice de quien entra, y así se encuentra su empresa.
--   usuarios.gps_usuario_id: el usuario de la plataforma vinculado a este usuario de On Rent (uno por empresa).
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS gps_cuenta_id TEXT;
CREATE INDEX IF NOT EXISTS empresas_gps_cuenta_idx ON empresas (gps_cuenta_id) WHERE gps_cuenta_id IS NOT NULL;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS gps_usuario_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_gps_usuario_uq ON usuarios (empresa_id, gps_usuario_id) WHERE gps_usuario_id IS NOT NULL;
