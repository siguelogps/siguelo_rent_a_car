-- 22-oct (Pablo): la plataforma GPS la conecta el propio cliente desde Configuración › Conexiones (o el equipo Síguelo
-- con «Operar», junto con él). Lo demás sigue siendo solo de Síguelo.
-- · apagada_por_siguelo: Síguelo apagó la integración a propósito desde el backoffice. Solo entonces el cliente no puede
--   conectarla. Se separa de «activa = false» porque una integración que nadie ha tocado también está inactiva, y esa sí
--   la puede conectar el cliente (era el error: la tarjeta decía «No contratado» y no dejaba conectar nada).
-- · gps_ingresos.origen: el «estado» de un solo uso de la vuelta solo sirve en la ruta que lo creó (backoffice o cliente).
ALTER TABLE integraciones ADD COLUMN IF NOT EXISTS apagada_por_siguelo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE gps_ingresos ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'backoffice';
