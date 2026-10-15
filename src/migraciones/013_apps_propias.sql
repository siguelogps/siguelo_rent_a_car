-- Apps con la marca del cliente (marca blanca), igual que en Síguelo On Bus:
-- · módulos extra por empresa (además de los de su plan), el primero es «app_propia»;
-- · solicitud de app propia con su autorización firmada en línea (PDF con hash SHA-256) y sus estados;
-- · versiones compiladas (APK/AAB) que sube GitHub Actions, por empresa y app («equipo» o «clientes»).
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS modulos_extra TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE solicitudes_app (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL UNIQUE REFERENCES empresas(id),
  estado TEXT NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador', 'enviada', 'en_revision', 'con_observaciones', 'compilando', 'lista', 'publicada')),
  datos JSONB NOT NULL DEFAULT '{}'::jsonb,       -- nombres de las apps, color, textos de la tienda, soporte
  icono_archivo_id BIGINT REFERENCES archivos(id),
  logo_archivo_id BIGINT REFERENCES archivos(id),
  capturas BIGINT[] NOT NULL DEFAULT '{}',
  observaciones TEXT,
  firma JSONB,                                     -- nombre, rut, cargo, fecha, ip, hash, contenido, archivos de la firma y del PDF
  compilacion JSONB,                               -- parámetros enviados a GitHub Actions y resultado del disparo
  historial JSONB NOT NULL DEFAULT '[]'::jsonb,
  url_tiendas JSONB,                               -- links de Google Play de cada app
  creada TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizada TIMESTAMPTZ NOT NULL DEFAULT now(),
  creada_por BIGINT REFERENCES usuarios(id)
);

CREATE TABLE app_versiones (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  app TEXT NOT NULL CHECK (app IN ('equipo', 'clientes')),
  formato TEXT NOT NULL CHECK (formato IN ('apk', 'aab')),
  version TEXT NOT NULL,
  paquete TEXT,
  archivo_id BIGINT NOT NULL REFERENCES archivos(id),
  tamano INT,
  subida TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX app_versiones_empresa ON app_versiones (empresa_id, app, formato, subida DESC);
