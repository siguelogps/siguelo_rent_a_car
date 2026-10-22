-- App nativa Síguelo On Rent (Android): teléfonos para avisos push y respuestas guardadas para reintentos idempotentes.

-- Teléfonos que reciben avisos push (token de Firebase). Se borran al salir, al eliminar la cuenta o cuando Firebase
-- dice que el token ya no existe.
CREATE TABLE IF NOT EXISTS dispositivos (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  plataforma TEXT NOT NULL DEFAULT 'android',
  version_app TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dispositivos_empresa ON dispositivos (empresa_id);

-- Idempotencia: la app manda «Idempotency-Key» en cada envío de su cola. Si el envío se repite (se cortó la señal
-- justo después de guardar), se devuelve la misma respuesta en vez de crear un daño o un incidente duplicado.
CREATE TABLE IF NOT EXISTS idempotencia (
  usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  clave TEXT NOT NULL,
  empresa_id BIGINT,
  metodo TEXT NOT NULL,
  ruta TEXT NOT NULL,
  estado INT,
  respuesta JSONB,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, clave)
);
CREATE INDEX IF NOT EXISTS idempotencia_creado ON idempotencia (creado_en);
