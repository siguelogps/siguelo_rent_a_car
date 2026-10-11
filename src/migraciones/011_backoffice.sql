-- Backoffice Síguelo: planes comerciales con su detalle y rol «soporte» del equipo Síguelo.
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check CHECK (rol IN ('superadmin','soporte','administrador','counter','patio','finanzas'));

CREATE TABLE planes (
  codigo TEXT PRIMARY KEY,                 -- se guarda en empresas.plan
  nombre TEXT NOT NULL,
  descripcion TEXT,
  precio_uf NUMERIC(10,2),                 -- mensual; NULL = a convenir
  max_vehiculos INT,                       -- NULL = sin límite
  max_usuarios INT,
  max_sucursales INT,
  modulos TEXT[] NOT NULL DEFAULT '{}',    -- módulos incluidos (claves de src/permisos.js + 'portal')
  orden INT NOT NULL DEFAULT 0,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO planes (codigo, nombre, descripcion, precio_uf, max_vehiculos, max_usuarios, max_sucursales, modulos, orden) VALUES
 ('basico', 'Básico', 'Operación diaria del rent a car: reservas, contratos con firma, entregas y devoluciones, cobros y liquidación.', NULL, 15, 5, 1,
  '{reservas,patio,contratos,clientes,flota,mantencion,pagos,liquidaciones,incidentes,tarifas}', 1),
 ('pro', 'Pro', 'Todo el Básico más plataforma GPS, TAG y multas, facturación electrónica, reportes y portal de reservas en línea.', NULL, 50, 15, 5,
  '{reservas,patio,contratos,clientes,flota,mantencion,pagos,liquidaciones,incidentes,tarifas,gps,inmovilizar,tag_multas,facturacion,reportes,portal}', 2),
 ('empresa', 'Empresa', 'Todo el Pro sin límites de vehículos, usuarios ni sucursales.', NULL, NULL, NULL, NULL,
  '{reservas,patio,contratos,clientes,flota,mantencion,pagos,liquidaciones,incidentes,tarifas,gps,inmovilizar,tag_multas,facturacion,reportes,portal}', 3);

-- La sesión de un usuario Síguelo parte en el backoffice (sin empresa): «ver como» se activa a mano.
UPDATE sesiones SET empresa_id = NULL WHERE usuario_id IN (SELECT id FROM usuarios WHERE empresa_id IS NULL);
