-- Módulos 10 (TAG y multas) y 11 (plataforma GPS): columnas y tablas de apoyo. Solo agrega, no cambia lo existente.

-- Desde cuándo el vehículo está detenido en el mismo lugar (regla «detenido fuera de horario»).
ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS gps_detenido_desde TIMESTAMPTZ;

-- Inmovilización: cada paso (solicitud, confirmación, intento rechazado por movimiento, envío) queda en «eventos».
ALTER TABLE inmovilizaciones ADD COLUMN IF NOT EXISTS eventos JSONB NOT NULL DEFAULT '[]'::jsonb;

-- TAG: aviso al cliente y monto neto informado por el dashboard; «asignacion» = auto | manual.
ALTER TABLE tag_transitos ADD COLUMN IF NOT EXISTS notificado_en TIMESTAMPTZ;
ALTER TABLE tag_transitos ADD COLUMN IF NOT EXISTS monto_neto BIGINT;
ALTER TABLE tag_transitos ADD COLUMN IF NOT EXISTS asignacion TEXT NOT NULL DEFAULT 'auto';

-- Multas: reservas candidatas cuando el día lo comparten dos contratos (estado «revisar»).
ALTER TABLE multas ADD COLUMN IF NOT EXISTS candidatos JSONB;
ALTER TABLE multas ADD COLUMN IF NOT EXISTS asignacion TEXT NOT NULL DEFAULT 'auto';
-- El dashboard puede no saber valorizar una multa (monto null): se guarda 0 y se marca «sin valorizar».
ALTER TABLE multas ADD COLUMN IF NOT EXISTS sin_valorizar BOOLEAN NOT NULL DEFAULT FALSE;

-- Sincronizaciones con el dashboard Síguelo (TAG y multas): rango pedido, conteos y cobertura de la revisión MTT.
CREATE TABLE IF NOT EXISTS dashboard_sincronizaciones (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  desde DATE NOT NULL, hasta DATE NOT NULL,
  estado TEXT NOT NULL DEFAULT 'ok' CHECK (estado IN ('ok','parcial','error')),
  pasadas INT NOT NULL DEFAULT 0, multas INT NOT NULL DEFAULT 0,
  nuevas_tag INT NOT NULL DEFAULT 0, nuevas_multas INT NOT NULL DEFAULT 0,
  cobertura JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{patente, estado: revisada|fallida|nunca, revisado_en}]
  utm BIGINT,
  errores JSONB NOT NULL DEFAULT '[]'::jsonb,
  usuario_id BIGINT REFERENCES usuarios(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dashboard_sinc_empresa ON dashboard_sincronizaciones (empresa_id, creado_en DESC);

CREATE INDEX IF NOT EXISTS gps_lecturas_reserva ON gps_lecturas (empresa_id, reserva_id, leido_en);
CREATE INDEX IF NOT EXISTS gps_lecturas_vehiculo ON gps_lecturas (empresa_id, vehiculo_id, leido_en);
CREATE INDEX IF NOT EXISTS gps_alertas_pend ON gps_alertas (empresa_id, atendida, ocurrido_en DESC);
CREATE INDEX IF NOT EXISTS multas_reserva ON multas (empresa_id, reserva_id);
CREATE INDEX IF NOT EXISTS inmovilizaciones_vehiculo ON inmovilizaciones (empresa_id, vehiculo_id, creado_en DESC);
