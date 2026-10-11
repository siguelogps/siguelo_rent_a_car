-- Síguelo Rentacar · esquema base (multi-empresa: toda tabla de negocio lleva empresa_id).
-- Montos en CLP como BIGINT (sin decimales). Fechas con zona horaria (timestamptz); vencimientos como date.

CREATE TABLE empresas (
  id BIGSERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,                 -- identificador público (portal de reservas: /reservar/<slug>)
  rut TEXT, razon_social TEXT, giro TEXT, acteco TEXT,
  direccion TEXT, comuna TEXT, ciudad TEXT, telefono TEXT, correo TEXT, sitio_web TEXT,
  logo_clave TEXT,                           -- archivo en el almacenamiento externo
  color TEXT DEFAULT '#0F5F58',
  plan TEXT NOT NULL DEFAULT 'pro',
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  marcha_blanca BOOLEAN NOT NULL DEFAULT TRUE, -- correos, WhatsApp, cobros y DTE detenidos hasta desactivarla
  zona_horaria TEXT NOT NULL DEFAULT 'America/Santiago',
  ajustes JSONB NOT NULL DEFAULT '{}'::jsonb,  -- tolerancia de atraso, precio combustible, lavado, etc.
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sucursales (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  nombre TEXT NOT NULL, direccion TEXT, comuna TEXT, ciudad TEXT, telefono TEXT, horario TEXT,
  lat DOUBLE PRECISION, lng DOUBLE PRECISION,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usuarios (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT REFERENCES empresas(id),  -- NULL = equipo Síguelo (superadmin)
  nombre TEXT NOT NULL,
  correo TEXT NOT NULL UNIQUE,
  clave_hash TEXT,
  rol TEXT NOT NULL CHECK (rol IN ('superadmin','administrador','counter','patio','finanzas')),
  sucursal_id BIGINT REFERENCES sucursales(id),
  telefono TEXT,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  ultimo_acceso TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sesiones (
  token_hash TEXT PRIMARY KEY,
  usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  empresa_id BIGINT REFERENCES empresas(id),  -- empresa activa (el superadmin puede cambiarla)
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_en TIMESTAMPTZ NOT NULL,
  agente TEXT
);

CREATE TABLE folios (
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  tipo TEXT NOT NULL,                        -- R (reserva), C (cotización), CT (contrato), INC, OT, LQ
  ultimo BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (empresa_id, tipo)
);

-- ── Flota ──
CREATE TABLE categorias (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  nombre TEXT NOT NULL, descripcion TEXT,
  pasajeros INT, maletas INT, transmision TEXT, ejemplo TEXT,  -- «Kia Morning o similar»
  imagen_clave TEXT,
  orden INT NOT NULL DEFAULT 0,
  activa BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE propietarios (                  -- vehículos de inversionistas (liquidación al dueño)
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  nombre TEXT NOT NULL, rut TEXT, correo TEXT, telefono TEXT, banco TEXT, cuenta TEXT,
  porcentaje NUMERIC(5,2) NOT NULL DEFAULT 0,  -- % del ingreso que se le liquida
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE vehiculos (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  patente TEXT NOT NULL,
  marca TEXT, modelo TEXT, anio INT, color TEXT, vin TEXT, motor TEXT,
  categoria_id BIGINT REFERENCES categorias(id),
  sucursal_id BIGINT REFERENCES sucursales(id),
  propietario_id BIGINT REFERENCES propietarios(id),
  transmision TEXT, combustible_tipo TEXT DEFAULT 'bencina', capacidad_estanque INT,
  km INT NOT NULL DEFAULT 0,
  combustible_nivel INT NOT NULL DEFAULT 8 CHECK (combustible_nivel BETWEEN 0 AND 8), -- octavos
  tag_numero TEXT,
  estado TEXT NOT NULL DEFAULT 'disponible' CHECK (estado IN ('disponible','arrendado','reservado','mantencion','fuera_servicio')),
  venc_revision_tecnica DATE, venc_permiso_circulacion DATE, venc_soap DATE, venc_seguro DATE,
  seguro_compania TEXT, seguro_poliza TEXT,
  mant_cada_km INT DEFAULT 10000, mant_ultima_km INT DEFAULT 0, mant_cada_meses INT DEFAULT 12, mant_ultima_fecha DATE,
  -- plataforma GPS
  gps_unidad_id TEXT, gps_nombre TEXT,
  gps_lat DOUBLE PRECISION, gps_lng DOUBLE PRECISION, gps_velocidad INT, gps_motor BOOLEAN, gps_direccion TEXT,
  gps_km INT, gps_combustible INT, gps_actualizado_en TIMESTAMPTZ,
  gps_inmovilizado BOOLEAN NOT NULL DEFAULT FALSE,
  notas TEXT,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, patente)
);

-- ── Tarifas ──
CREATE TABLE temporadas (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  nombre TEXT NOT NULL, desde DATE NOT NULL, hasta DATE NOT NULL,
  prioridad INT NOT NULL DEFAULT 0
);

CREATE TABLE tarifas (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  categoria_id BIGINT NOT NULL REFERENCES categorias(id),
  temporada_id BIGINT REFERENCES temporadas(id),  -- NULL = tarifa base
  precio_dia BIGINT NOT NULL, precio_semana BIGINT, precio_mes BIGINT,  -- semana = 7 días, mes = 30 días
  km_libre BOOLEAN NOT NULL DEFAULT FALSE,
  km_dia_incluidos INT DEFAULT 250,
  precio_km_extra BIGINT DEFAULT 0,
  garantia BIGINT NOT NULL DEFAULT 0,
  deducible BIGINT NOT NULL DEFAULT 0,
  UNIQUE (empresa_id, categoria_id, temporada_id)
);

CREATE TABLE extras (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  codigo TEXT NOT NULL,                      -- conductor_adicional, silla_nino, cadenas, cruce_argentina, gps, ...
  nombre TEXT NOT NULL, descripcion TEXT,
  cobro TEXT NOT NULL DEFAULT 'dia' CHECK (cobro IN ('dia','fijo')),
  precio BIGINT NOT NULL DEFAULT 0, tope BIGINT,
  requiere_documento BOOLEAN NOT NULL DEFAULT FALSE,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (empresa_id, codigo)
);

CREATE TABLE recargos (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('otra_sucursal','conductor_joven','fuera_horario')),
  nombre TEXT NOT NULL,
  sucursal_origen_id BIGINT REFERENCES sucursales(id), sucursal_destino_id BIGINT REFERENCES sucursales(id),
  edad_max INT,                              -- conductor joven: menor de esta edad
  cobro TEXT NOT NULL DEFAULT 'fijo' CHECK (cobro IN ('dia','fijo')),
  monto BIGINT NOT NULL DEFAULT 0,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE descuentos (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  codigo TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('porcentaje','monto')),
  valor BIGINT NOT NULL,
  desde DATE, hasta DATE, usos_max INT, usos INT NOT NULL DEFAULT 0,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (empresa_id, codigo)
);

-- ── Clientes ──
CREATE TABLE clientes (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  tipo TEXT NOT NULL DEFAULT 'persona' CHECK (tipo IN ('persona','empresa')),
  nombre TEXT NOT NULL, apellidos TEXT,
  documento_tipo TEXT NOT NULL DEFAULT 'rut' CHECK (documento_tipo IN ('rut','pasaporte','dni')),
  documento TEXT NOT NULL,                   -- RUT normalizado 12345678-K
  nacionalidad TEXT, fecha_nacimiento DATE,
  correo TEXT, telefono TEXT, direccion TEXT, comuna TEXT, ciudad TEXT, pais TEXT DEFAULT 'Chile',
  razon_social TEXT, giro TEXT,              -- para factura
  licencia_numero TEXT, licencia_clase TEXT, licencia_vence DATE, licencia_pais TEXT DEFAULT 'Chile',
  lista_negra BOOLEAN NOT NULL DEFAULT FALSE, lista_negra_motivo TEXT, lista_negra_en TIMESTAMPTZ, lista_negra_por BIGINT REFERENCES usuarios(id),
  notas TEXT, origen TEXT DEFAULT 'counter',
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, documento_tipo, documento)
);

CREATE TABLE conductores (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  cliente_id BIGINT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  documento_tipo TEXT NOT NULL DEFAULT 'rut', documento TEXT,
  fecha_nacimiento DATE, licencia_numero TEXT, licencia_clase TEXT, licencia_vence DATE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Archivos (fotos y documentos): el contenido vive en el almacenamiento externo (S3 / R2); aquí solo la referencia.
CREATE TABLE archivos (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  entidad TEXT NOT NULL,                     -- cliente, conductor, inspeccion, dano, incidente, contrato, vehiculo, empresa
  entidad_id BIGINT,
  tipo TEXT,                                 -- cedula_frente, cedula_reverso, licencia, foto_frente, firma, pdf, ...
  clave TEXT NOT NULL UNIQUE,
  nombre TEXT, mime TEXT, tamano INT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,   -- lat, lng, tomada_en, sello
  subido_por BIGINT REFERENCES usuarios(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX archivos_entidad ON archivos (empresa_id, entidad, entidad_id);

-- Solo lo usa el almacenamiento «bd» (desarrollo / demo). En producción se usa S3 o R2.
CREATE TABLE archivos_contenido (
  clave TEXT PRIMARY KEY,
  datos BYTEA NOT NULL
);

-- ── Reservas ──
CREATE TABLE agencias (                      -- portal de agencias con comisión
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  nombre TEXT NOT NULL, rut TEXT, correo TEXT, telefono TEXT,
  comision_pct NUMERIC(5,2) NOT NULL DEFAULT 10,
  activa BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE reservas (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  folio TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'cotizacion' CHECK (estado IN ('cotizacion','confirmada','en_curso','devuelta','cerrada','cancelada','no_show')),
  cliente_id BIGINT REFERENCES clientes(id),
  vehiculo_id BIGINT REFERENCES vehiculos(id),
  categoria_id BIGINT REFERENCES categorias(id),
  sucursal_retiro_id BIGINT REFERENCES sucursales(id),
  sucursal_devolucion_id BIGINT REFERENCES sucursales(id),
  inicio TIMESTAMPTZ NOT NULL,
  fin TIMESTAMPTZ NOT NULL,
  extras JSONB NOT NULL DEFAULT '[]'::jsonb,         -- [{codigo, cantidad}]
  conductores JSONB NOT NULL DEFAULT '[]'::jsonb,    -- ids de conductores adicionales
  codigo_descuento TEXT,
  cotizacion JSONB NOT NULL DEFAULT '{}'::jsonb,     -- {lineas:[{concepto,detalle,monto}], total, dias, temporada}
  total BIGINT NOT NULL DEFAULT 0,
  km_incluidos INT, precio_km_extra BIGINT, garantia BIGINT NOT NULL DEFAULT 0, deducible BIGINT NOT NULL DEFAULT 0,
  origen TEXT NOT NULL DEFAULT 'counter' CHECK (origen IN ('counter','portal','agencia','telefono')),
  agencia_id BIGINT REFERENCES agencias(id),
  token_portal TEXT UNIQUE,                  -- acceso del cliente final a su reserva (subir documentos, ver contrato)
  notas TEXT, motivo_cancelacion TEXT,
  retiro_real TIMESTAMPTZ, devolucion_real TIMESTAMPTZ,
  creado_por BIGINT REFERENCES usuarios(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, folio)
);
CREATE INDEX reservas_vehiculo_fechas ON reservas (empresa_id, vehiculo_id, inicio, fin);

CREATE TABLE bloqueos (                      -- vehículo no disponible (mantención, traslado, etc.)
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  vehiculo_id BIGINT NOT NULL REFERENCES vehiculos(id),
  inicio TIMESTAMPTZ NOT NULL, fin TIMESTAMPTZ NOT NULL,
  motivo TEXT NOT NULL,
  orden_trabajo_id BIGINT,
  creado_por BIGINT REFERENCES usuarios(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Contratos ──
CREATE TABLE plantillas (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('contrato','correo','whatsapp')),
  clave TEXT NOT NULL,                       -- contrato_estandar, reserva_confirmada, contrato_firmado, liquidacion, multa_asignada…
  nombre TEXT NOT NULL, asunto TEXT, cuerpo TEXT NOT NULL,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, tipo, clave)
);

CREATE TABLE contratos (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  reserva_id BIGINT NOT NULL REFERENCES reservas(id),
  folio TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente_firma' CHECK (estado IN ('pendiente_firma','firmado','anulado')),
  plantilla_id BIGINT REFERENCES plantillas(id),
  contenido TEXT NOT NULL,                   -- texto final con las variables ya reemplazadas
  datos JSONB NOT NULL DEFAULT '{}'::jsonb,  -- foto de los datos al generar (cliente, vehículo, montos)
  codigo_verificacion TEXT NOT NULL UNIQUE,  -- va en el QR: /verificar/<codigo>
  firma_archivo_id BIGINT REFERENCES archivos(id),
  firmante_nombre TEXT, firmante_documento TEXT, firmado_en TIMESTAMPTZ, firmado_ip TEXT, firmado_agente TEXT,
  pdf_archivo_id BIGINT REFERENCES archivos(id),
  hash_sha256 TEXT,                          -- huella del PDF firmado
  enviado_correo_en TIMESTAMPTZ, enviado_whatsapp_en TIMESTAMPTZ,
  creado_por BIGINT REFERENCES usuarios(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, folio)
);

-- ── Entrega y devolución ──
CREATE TABLE inspecciones (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  reserva_id BIGINT NOT NULL REFERENCES reservas(id),
  vehiculo_id BIGINT NOT NULL REFERENCES vehiculos(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('entrega','devolucion')),
  estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','completa')),
  km INT, km_gps INT, combustible INT, combustible_gps INT,
  checklist JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {repuesto:true, gata:true, triangulos:2, extintor:true, documentos:true, tag:true, limpieza:'ok'|'sucio'}
  observaciones TEXT,
  firma_archivo_id BIGINT REFERENCES archivos(id), firmante_nombre TEXT,
  sucursal_id BIGINT REFERENCES sucursales(id),
  lat DOUBLE PRECISION, lng DOUBLE PRECISION,
  realizado_por BIGINT REFERENCES usuarios(id),
  iniciado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  completado_en TIMESTAMPTZ,
  UNIQUE (reserva_id, tipo)
);

CREATE TABLE inspeccion_fotos (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  inspeccion_id BIGINT NOT NULL REFERENCES inspecciones(id) ON DELETE CASCADE,
  posicion TEXT NOT NULL,                    -- frente, atras, izquierdo, derecho, esq_fi, esq_fd, esq_ti, esq_td, interior, odometro, combustible, extra
  archivo_id BIGINT NOT NULL REFERENCES archivos(id),
  lat DOUBLE PRECISION, lng DOUBLE PRECISION, tomada_en TIMESTAMPTZ,
  UNIQUE (inspeccion_id, posicion)
);

CREATE TABLE incidentes (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  folio TEXT NOT NULL,
  reserva_id BIGINT REFERENCES reservas(id),
  contrato_id BIGINT REFERENCES contratos(id),
  vehiculo_id BIGINT NOT NULL REFERENCES vehiculos(id),
  cliente_id BIGINT REFERENCES clientes(id),
  tipo TEXT NOT NULL DEFAULT 'dano' CHECK (tipo IN ('dano','accidente','robo','mecanico','otro')),
  estado TEXT NOT NULL DEFAULT 'reportado' CHECK (estado IN ('reportado','presupuestado','cobrado_cliente','en_seguro','pagado','cerrado','anulado')),
  descripcion TEXT,
  presupuesto BIGINT, taller TEXT,
  deducible BIGINT,                          -- tope que paga el cliente
  monto_cliente BIGINT,                      -- lo que se le cobra (menor entre presupuesto y deducible, editable)
  cobrado_cliente BIGINT NOT NULL DEFAULT 0,
  recupero_seguro BIGINT, numero_siniestro TEXT, compania_seguro TEXT,
  costo_real BIGINT,
  creado_por BIGINT REFERENCES usuarios(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrado_en TIMESTAMPTZ,
  UNIQUE (empresa_id, folio)
);

CREATE TABLE incidente_eventos (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  incidente_id BIGINT NOT NULL REFERENCES incidentes(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,                        -- reporte, presupuesto, cobro, seguro, pago, nota, cierre
  detalle TEXT, monto BIGINT,
  usuario_id BIGINT REFERENCES usuarios(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE danos (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  vehiculo_id BIGINT NOT NULL REFERENCES vehiculos(id),
  inspeccion_id BIGINT REFERENCES inspecciones(id),   -- donde se registró por primera vez
  vista TEXT NOT NULL,                       -- esquema: coordenadas en el SVG 360×470 (src: public/esquema.js)
  x DOUBLE PRECISION NOT NULL, y DOUBLE PRECISION NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('raya','abolladura','trizadura','otro')),
  descripcion TEXT,
  archivo_id BIGINT REFERENCES archivos(id),
  estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','reparado')),
  incidente_id BIGINT REFERENCES incidentes(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  reparado_en TIMESTAMPTZ
);

-- ── Pagos, garantía, liquidación y facturación ──
CREATE TABLE pagos (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  reserva_id BIGINT REFERENCES reservas(id),
  cliente_id BIGINT REFERENCES clientes(id),
  concepto TEXT NOT NULL CHECK (concepto IN ('arriendo','garantia','liquidacion','reembolso','multa','tag','incidente')),
  metodo TEXT NOT NULL CHECK (metodo IN ('webpay','mercadopago','efectivo','transferencia','pos','otro')),
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','autorizado','retenido','capturado','liberado','pagado','rechazado','anulado','reembolsado','simulado')),
  monto BIGINT NOT NULL,
  monto_capturado BIGINT NOT NULL DEFAULT 0,
  monto_liberado BIGINT NOT NULL DEFAULT 0,
  referencia TEXT,                           -- buy_order / external_reference
  token_externo TEXT,                        -- token Webpay / id preferencia MP
  autorizacion TEXT, tarjeta TEXT,           -- código autorización, últimos 4
  vence_retencion TIMESTAMPTZ,
  detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
  registrado_por BIGINT REFERENCES usuarios(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX pagos_reserva ON pagos (empresa_id, reserva_id);

CREATE TABLE liquidaciones (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  reserva_id BIGINT NOT NULL UNIQUE REFERENCES reservas(id),
  folio TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','aprobada','cobrada','anulada')),
  lineas JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{codigo, concepto, calculo, origen, monto, incluir, editado, motivo}]
  total_cargos BIGINT NOT NULL DEFAULT 0,
  garantia_retenida BIGINT NOT NULL DEFAULT 0,
  garantia_capturada BIGINT NOT NULL DEFAULT 0,
  garantia_liberada BIGINT NOT NULL DEFAULT 0,
  saldo_por_cobrar BIGINT NOT NULL DEFAULT 0, -- si los cargos superan la garantía
  aprobado_por BIGINT REFERENCES usuarios(id), aprobado_en TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE documentos_tributarios (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  reserva_id BIGINT REFERENCES reservas(id),
  liquidacion_id BIGINT REFERENCES liquidaciones(id),
  tipo INT NOT NULL,                         -- 39 boleta electrónica, 33 factura electrónica, 61 nota de crédito
  folio BIGINT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','retenido','emitido','aceptado','reparos','rechazado','error')),
  receptor JSONB NOT NULL DEFAULT '{}'::jsonb,
  lineas JSONB NOT NULL DEFAULT '[]'::jsonb,
  neto BIGINT, iva BIGINT, exento BIGINT, total BIGINT NOT NULL,
  track_id TEXT, respuesta JSONB, pdf_archivo_id BIGINT REFERENCES archivos(id),
  creado_por BIGINT REFERENCES usuarios(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  emitido_en TIMESTAMPTZ
);

-- ── TAG y multas ──
CREATE TABLE importaciones (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('tag','multas')),
  origen TEXT NOT NULL,                      -- dashboard, csv, excel
  nombre_archivo TEXT,
  filas INT NOT NULL DEFAULT 0, nuevas INT NOT NULL DEFAULT 0, duplicadas INT NOT NULL DEFAULT 0,
  asignadas INT NOT NULL DEFAULT 0, sin_contrato INT NOT NULL DEFAULT 0, errores JSONB NOT NULL DEFAULT '[]'::jsonb,
  usuario_id BIGINT REFERENCES usuarios(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tag_transitos (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  patente TEXT NOT NULL,
  vehiculo_id BIGINT REFERENCES vehiculos(id),
  fecha_hora TIMESTAMPTZ NOT NULL,
  portico TEXT, autopista TEXT, concesionaria TEXT,
  monto BIGINT NOT NULL DEFAULT 0,
  origen TEXT NOT NULL,                      -- dashboard, csv, excel
  huella TEXT NOT NULL,                      -- evita duplicados al reimportar
  reserva_id BIGINT REFERENCES reservas(id),
  estado TEXT NOT NULL DEFAULT 'sin_contrato' CHECK (estado IN ('asignado','sin_contrato','cobrado','condonado')),
  importacion_id BIGINT REFERENCES importaciones(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, huella)
);
CREATE INDEX tag_reserva ON tag_transitos (empresa_id, reserva_id);

CREATE TABLE multas (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  patente TEXT NOT NULL,
  vehiculo_id BIGINT REFERENCES vehiculos(id),
  fecha_infraccion TIMESTAMPTZ NOT NULL,
  hora_conocida BOOLEAN NOT NULL DEFAULT FALSE, -- el registro MTT solo trae la fecha
  motivo TEXT, lugar TEXT, juzgado TEXT, rol_causa TEXT, tipo TEXT,
  monto BIGINT NOT NULL DEFAULT 0,
  origen TEXT NOT NULL,
  huella TEXT NOT NULL,
  reserva_id BIGINT REFERENCES reservas(id),
  cliente_id BIGINT REFERENCES clientes(id),
  estado TEXT NOT NULL DEFAULT 'sin_contrato' CHECK (estado IN ('asignada','sin_contrato','revisar','notificada','cobrada','pagada','condonada')),
  notificada_en TIMESTAMPTZ,
  importacion_id BIGINT REFERENCES importaciones(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, huella)
);

-- ── Plataforma GPS ──
CREATE TABLE gps_alertas (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  vehiculo_id BIGINT NOT NULL REFERENCES vehiculos(id),
  reserva_id BIGINT REFERENCES reservas(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('geocerca','velocidad','detenido_fuera_horario','sin_senal','combustible')),
  detalle TEXT, valor DOUBLE PRECISION,
  lat DOUBLE PRECISION, lng DOUBLE PRECISION,
  ocurrido_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  atendida BOOLEAN NOT NULL DEFAULT FALSE, atendida_por BIGINT REFERENCES usuarios(id), atendida_en TIMESTAMPTZ, nota TEXT,
  huella TEXT,
  UNIQUE (empresa_id, huella)
);

CREATE TABLE inmovilizaciones (               -- bitácora: cada solicitud, confirmación y envío
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  vehiculo_id BIGINT NOT NULL REFERENCES vehiculos(id),
  reserva_id BIGINT REFERENCES reservas(id),
  accion TEXT NOT NULL CHECK (accion IN ('inmovilizar','liberar')),
  motivo TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'solicitada' CHECK (estado IN ('solicitada','confirmada','enviada','rechazada','fallida','cancelada','simulada')),
  solicitado_por BIGINT NOT NULL REFERENCES usuarios(id),
  confirmado_por BIGINT REFERENCES usuarios(id),   -- doble validación: debe ser otra persona
  velocidad_al_enviar INT, lat DOUBLE PRECISION, lng DOUBLE PRECISION,
  respuesta TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmado_en TIMESTAMPTZ, ejecutado_en TIMESTAMPTZ
);

CREATE TABLE gps_lecturas (                  -- km y combustible por contrato (inicio / fin) y muestras
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  vehiculo_id BIGINT NOT NULL REFERENCES vehiculos(id),
  reserva_id BIGINT REFERENCES reservas(id),
  km INT, combustible INT, lat DOUBLE PRECISION, lng DOUBLE PRECISION, velocidad INT,
  leido_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Mantención ──
CREATE TABLE ordenes_trabajo (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  folio TEXT NOT NULL,
  vehiculo_id BIGINT NOT NULL REFERENCES vehiculos(id),
  tipo TEXT NOT NULL DEFAULT 'preventiva' CHECK (tipo IN ('preventiva','correctiva','revision_tecnica','neumaticos','otro')),
  motivo TEXT NOT NULL,
  km_programado INT, fecha_programada DATE,
  taller TEXT, costo BIGINT NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'programada' CHECK (estado IN ('programada','en_taller','terminada','anulada')),
  inicio TIMESTAMPTZ, fin TIMESTAMPTZ, km_al_ingreso INT,
  incidente_id BIGINT REFERENCES incidentes(id),
  notas TEXT,
  creado_por BIGINT REFERENCES usuarios(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, folio)
);

-- ── Configuración, integraciones y salidas ──
CREATE TABLE integraciones (
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  tipo TEXT NOT NULL,                        -- gps, webpay, mercadopago, simpleapi, whatsapp, correo, almacenamiento, dashboard_siguelo
  activa BOOLEAN NOT NULL DEFAULT FALSE,     -- solo administradores la cambian; si está apagada no genera acciones
  config_cifrada TEXT,                       -- JSON cifrado con APP_SECRET (AES-256-GCM)
  estado_prueba TEXT, probado_en TIMESTAMPTZ,
  actualizado_por BIGINT REFERENCES usuarios(id),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, tipo)
);

CREATE TABLE salidas (                       -- bandeja de salida: en marcha blanca quedan «retenidas»
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id),
  canal TEXT NOT NULL CHECK (canal IN ('correo','whatsapp')),
  destino TEXT NOT NULL,
  asunto TEXT, cuerpo TEXT NOT NULL,
  adjuntos JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{archivo_id, nombre}]
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','retenida','enviada','error','descartada')),
  error TEXT,
  entidad TEXT, entidad_id BIGINT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  enviado_en TIMESTAMPTZ
);

CREATE TABLE bitacora (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT REFERENCES empresas(id),
  usuario_id BIGINT REFERENCES usuarios(id),
  accion TEXT NOT NULL,
  entidad TEXT, entidad_id BIGINT,
  detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bitacora_entidad ON bitacora (empresa_id, entidad, entidad_id);
