-- Backoffice Síguelo estándar (espec. aprobada por Pablo el 22-oct, igual en todas las herramientas):
-- · estado del cliente (activo / suspendido / baja) con motivo; «activa» se mantiene en sincronía para lo que ya la lee;
-- · «Ver como» (solo lectura) y «Operar» (con motivo) quedan en la sesión y en entradas_siguelo;
-- · nivel de Síguelo On Board de cada persona del equipo (admin / usa / ve) para decidir quién puede operar;
-- · invitación al primer administrador (Síguelo no escribe ni ve su clave);
-- · «Solicitar a Síguelo», enlaces de carga de un solo uso (certificado y CAF) y conexiones generales de Síguelo;
-- · «distribuidor» de cada cliente (Síguelo por defecto): deja listo el futuro nivel partner, sin construirlo.
-- Nada se borra: las integraciones que el cliente ya tenía configuradas siguen igual (mismos secretos cifrados).

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'activo';
UPDATE empresas SET estado = CASE WHEN activa THEN 'activo' ELSE 'suspendido' END;
ALTER TABLE empresas DROP CONSTRAINT IF EXISTS empresas_estado_check;
ALTER TABLE empresas ADD CONSTRAINT empresas_estado_check CHECK (estado IN ('activo', 'suspendido', 'baja'));
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS estado_motivo TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS estado_detalle TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS estado_en TIMESTAMPTZ;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS estado_por BIGINT REFERENCES usuarios(id);
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS exportar_hasta DATE;            -- baja: el cliente exporta hasta esta fecha
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS datos_eliminados_en TIMESTAMPTZ; -- baja: cuándo se anonimizó
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS marcha_blanca_en TIMESTAMPTZ;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS marcha_blanca_por BIGINT REFERENCES usuarios(id);
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS distribuidor TEXT NOT NULL DEFAULT 'siguelo';

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS nivel_panel TEXT;               -- admin | usa | ve (lo manda On Board)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS invitacion_hash TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS invitacion_vence TIMESTAMPTZ;

-- Entradas del equipo Síguelo a la cuenta de un cliente
CREATE TABLE IF NOT EXISTS entradas_siguelo (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
  modo TEXT NOT NULL CHECK (modo IN ('ver', 'operar')),
  motivo TEXT,
  inicio TIMESTAMPTZ NOT NULL DEFAULT now(),
  fin TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS entradas_siguelo_empresa ON entradas_siguelo (empresa_id, inicio DESC);
ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS modo TEXT;                      -- ver | operar (solo equipo Síguelo)
ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS motivo TEXT;
ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS entrada_id BIGINT REFERENCES entradas_siguelo(id);
-- Las sesiones del equipo que ya estaban dentro de un cliente quedan en solo lectura (nunca más «ver como» con todo).
UPDATE sesiones SET modo = 'ver' WHERE empresa_id IS NOT NULL AND usuario_id IN (SELECT id FROM usuarios WHERE rol IN ('superadmin', 'soporte'));

-- «Solicitar a Síguelo»: bandeja del backoffice; además se avisa por correo y se abre un ticket en el CRM.
CREATE TABLE IF NOT EXISTS solicitudes_siguelo (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  tipo TEXT NOT NULL,                       -- gps, facturacion, folios, correo, whatsapp, siguelo_os, marcha_blanca, otro
  detalle TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_curso', 'resuelta', 'descartada')),
  solicitante_id BIGINT REFERENCES usuarios(id),
  solicitante_nombre TEXT, solicitante_correo TEXT,
  correo_estado TEXT,                       -- enviado | pendiente: <motivo>
  crm_estado TEXT, crm_ticket TEXT, crm_intentos INT NOT NULL DEFAULT 0,
  nota TEXT, resuelta_por BIGINT REFERENCES usuarios(id), resuelta_en TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS solicitudes_siguelo_estado ON solicitudes_siguelo (estado, creado_en DESC);

-- Enlace de carga de un solo uso (certificado digital y CAF): vence en 72 h, sirve una vez, el archivo queda cifrado.
CREATE TABLE IF NOT EXISTS enlaces_carga (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  token_hash TEXT NOT NULL UNIQUE,
  piezas TEXT[] NOT NULL,                   -- certificado, caf_39, caf_33, caf_61
  correo TEXT NOT NULL,
  vence_en TIMESTAMPTZ NOT NULL,
  usado_en TIMESTAMPTZ,
  anulado_en TIMESTAMPTZ,
  recibidos JSONB NOT NULL DEFAULT '{}'::jsonb,
  creado_por BIGINT REFERENCES usuarios(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Conexiones generales de Síguelo (no son de un cliente): almacenamiento de archivos, correo de Síguelo y CRM.
CREATE TABLE IF NOT EXISTS conexiones_siguelo (
  tipo TEXT PRIMARY KEY,
  config_cifrada TEXT,
  estado_prueba TEXT, probado_en TIMESTAMPTZ,
  actualizado_por BIGINT REFERENCES usuarios(id),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ingreso a la plataforma GPS desde el backoffice: la vuelta trae un «estado» de un solo uso que dice a qué cliente va
-- el token (nunca un id de empresa escrito en la dirección).
CREATE TABLE IF NOT EXISTS gps_ingresos (
  estado_hash TEXT PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
  cuenta TEXT NOT NULL,
  vence_en TIMESTAMPTZ NOT NULL
);
