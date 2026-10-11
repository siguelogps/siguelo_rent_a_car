# Síguelo Rent a Car · convenciones del proyecto

Sistema de administración de rentacar (producto de Síguelo GPS), multi-empresa, para vender a rentacars en Chile.
Node.js ≥ 22 (ESM), Express 5, PostgreSQL (PGlite embebido si no hay `DATABASE_URL`), frontend en HTML + JS de módulos sin framework.

## Reglas de producto (obligatorias)
- Todo en español de Chile: CLP con punto de miles (`clp()`), RUT con dígito verificador (`src/util/rut.js`), fechas dd-mm-aaaa, hora America/Santiago.
- En pantalla **nunca** se nombra a Wialon: se dice «plataforma GPS». (En el código interno sí puede aparecer `wialon`.)
- Estilo idéntico al CRM Síguelo Gestión: `public/app.css` (copiado, no editar tokens) + `public/rentacar.css`. Botón principal amarillo `btn primario`, chips `chip`, tarjetas `tarjeta`, patentes `pat`, montos/folios en IBM Plex Mono (`monto`, `mono`, `folio`). Las maquetas aprobadas están en `mockups/` (ver `mockups/capturas/*.png`): hay que respetarlas.
- Logo oficial `public/img/logo-siguelo.png` y `public/img/logo-pin.png`: no se modifican ni recolorean.
- Multi-empresa: **toda** consulta filtra por `empresa_id = req.empresaId`. Nunca confiar en un empresa_id que venga del navegador.
- Fotos y documentos **no** se guardan en el disco del servidor: usar `guardarArchivo()` / `leerArchivo()` de `src/almacenamiento/index.js`.
- Marcha blanca: correos, WhatsApp, cobros, DTE e inmovilización no salen mientras `empresas.marcha_blanca` sea true o la integración esté apagada. Usar `puedeActuar(empresaId, tipo)` de `src/integraciones/index.js`; los mensajes van por `encolar()` / `avisar()` de `src/salidas.js` (quedan «retenida»). Los cobros en marcha blanca se registran con estado `simulado`.
- Integraciones se configuran desde pantalla (tabla `integraciones`, cifrada), nunca en variables de entorno. Solo administradores las activan.
- Commits con mensajes en español.

## Estructura
- `src/server.js` arranque · `src/app.js` Express (carga automática de `src/api/*.js`, cada uno `export default express.Router()` montado en `/api`).
- `src/db.js`: `q(sql, params)` → filas, `uno()`, `transaccion(async (tx) => tx.query(...))`, `siguienteFolio(empresaId, 'R'|'C'|'CT'|'INC'|'OT'|'LQ', tx)`.
  **Dentro de `transaccion` usar solo `tx.query`** (con PGlite, llamar `q()` dentro de una transacción la bloquea).
- Migraciones: `src/migraciones/NNN_nombre.sql` (se aplican solas al arrancar). El esquema completo está en `001_esquema.sql`. Cada módulo usa su propio rango de números si necesita columnas nuevas.
- `src/auth.js`: `requiere('modulo', 'ver'|'editar')`, `ErrorHttp(estado, mensaje)`, `soloSuperadmin`. Permisos por rol en `src/permisos.js`.
- `src/bitacora.js`: `registrar(req, accion, entidad, id, detalle)` para trazabilidad.
- `src/cotizador.js` (precios), `src/disponibilidad.js` (sin dobles reservas), `src/gps/index.js` (`lecturaActual()` km/combustible), `src/tareas.js` (`registrarTarea(nombre, cadaMs, fn)`), `src/integraciones/probadores.js` (`registrarProbador(tipo, fn)`).
- Datos de prueba: `src/demo.js` + `src/demo-extra/*.js` (cada módulo exporta `sembrar(empresaId)`).
- Frontend: `public/<pagina>.html` con `<main>` y un `<script type="module">` que hace `await iniciarPagina({ activo, titulo })` de `/comun.js` (menú, barra, `api()`, `clp`, `fecha`, `rut`, `pat`, `chipEstado`, `modal`, `toast`, `confirmar`, `leerForm`, `reducirImagen`, `descargar`).
  URLs limpias: `/vehiculos` → `vehiculos.html`; con parámetro (ver `PAGINAS_PARAM` en `src/app.js`): `/reservas/:id` → `reserva.html`, `/vehiculos/:id` → `vehiculo.html`, `/clientes/:id` → `cliente.html`, `/contratos/:id` → `contrato.html`, `/incidentes/:id` → `incidente.html`, `/liquidaciones/:id` → `liquidacion.html`, `/patio/:id` → `patio-inspeccion.html`, `/firmar/:token`, `/verificar/:codigo`, `/reservar/:slug`, `/embed/:slug`, `/portal/:token`.
- CSS propio de cada módulo en `public/css/<modulo>.css` (prefijo de clases propio); `public/rentacar.css` es común.
- Pruebas: `node --test` con `test/ayuda.js` (`levantar()` → app con PGlite en memoria + demo, `como(correo)` → cliente con sesión). Usuarios demo (clave `demo1234`): demo@ (administrador), counter@, patio@, finanzas@, soporte@ (superadmin) `@siguelogps.cl`.

## Comandos
`npm start` · `npm run dev` · `npm test` · `npm run capturas` (maquetas a PNG)
