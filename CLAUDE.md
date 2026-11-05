# Síguelo On Rent · convenciones del proyecto

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
- Equipo Síguelo (roles `superadmin` y `soporte`, sin empresa): entra al **backoffice** (`/empresas`, `/planes`, `/equipo`) y a un cliente solo con «Ver como» (`POST /api/empresa-activa`). Planes en la tabla `planes` (`src/planes.js`): `requiere()` bloquea los módulos que el plan no incluye y `verificarLimite()` exige los máximos de vehículos, usuarios y sucursales.
- Nombre del producto: **Síguelo On Rent** (no «Rent a Car»; «rentacar» solo como sustantivo para las empresas clientes).
- App móvil (`apps/movil`, Capacitor): carga el sistema desde el servidor. Lo propio de la app va en `public/nativa.js` (`esNativa()`, `abrirArchivo()`); para descargas usar siempre `descargar()` de `comun.js` y nunca `window.open` a PDF sin pasar por `abrirArchivo`. `/privacidad`, `/soporte` y «Eliminar mi cuenta» son exigidos por las tiendas. Dominio: `https://onrent.siguelogps.com`.
- Apps con marca (como Síguelo On Bus): módulo de plan `app_propia` (o `empresas.modulos_extra`), `src/apps-propias.js`, `src/api/08-apps.js`, páginas `/apps` (cliente) y `/apps-marca` (backoffice), workflow `.github/workflows/apps-propias.yml`.
- Commits con mensajes en español.

## Estructura
- `src/server.js` arranque · `src/app.js` Express (carga automática de `src/api/*.js`, cada uno `export default express.Router()` montado en `/api`).
- `src/db.js`: `q(sql, params)` → filas, `uno()`, `transaccion(async (tx) => tx.query(...))`, `siguienteFolio(empresaId, 'R'|'C'|'CT'|'INC'|'OT'|'LQ', tx)`.
  **Dentro de `transaccion` usar solo `tx.query`** (con PGlite, llamar `q()` dentro de una transacción la bloquea).
- Migraciones: `src/migraciones/NNN_nombre.sql` (se aplican solas al arrancar). El esquema completo está en `001_esquema.sql`. Cada módulo usa su propio rango de números si necesita columnas nuevas. **El número es único**: una migración nueva no repite uno existente (`160_app_nativa.sql` y `160_app_plataforma.sql` quedaron así y no se renombran porque ya están aplicadas; `test/nucleo.test.js` lo vigila).
- `src/auth.js`: `requiere('modulo', 'ver'|'editar')`, `ErrorHttp(estado, mensaje)`, `soloSuperadmin`. Permisos por rol en `src/permisos.js`.
- `src/bitacora.js`: `registrar(req, accion, entidad, id, detalle)` para trazabilidad.
- `src/cotizador.js` (precios), `src/disponibilidad.js` (sin dobles reservas), `src/gps/index.js` (`lecturaActual()` km/combustible), `src/tareas.js` (`registrarTarea(nombre, cadaMs, fn)`), `src/integraciones/probadores.js` (`registrarProbador(tipo, fn)`).
- Datos de prueba: `src/demo.js` + `src/demo-extra/*.js` (cada módulo exporta `sembrar(empresaId)`).
- Frontend: `public/<pagina>.html` con `<main>` y un `<script type="module">` que hace `await iniciarPagina({ activo, titulo })` de `/comun.js` (menú, barra, `api()`, `clp`, `fecha`, `rut`, `pat`, `chipEstado`, `modal`, `toast`, `confirmar`, `leerForm`, `reducirImagen`, `descargar`).
  URLs limpias: `/vehiculos` → `vehiculos.html`; con parámetro (ver `PAGINAS_PARAM` en `src/app.js`): `/reservas/:id` → `reserva.html`, `/vehiculos/:id` → `vehiculo.html`, `/clientes/:id` → `cliente.html`, `/contratos/:id` → `contrato.html`, `/incidentes/:id` → `incidente.html`, `/liquidaciones/:id` → `liquidacion.html`, `/patio/:id` → `patio-inspeccion.html`, `/firmar/:token`, `/verificar/:codigo`, `/reservar/:slug`, `/embed/:slug`, `/portal/:token`.
- CSS propio de cada módulo en `public/css/<modulo>.css` (prefijo de clases propio); `public/rentacar.css` es común.
- Pruebas: `node --test` con `test/ayuda.js` (`levantar()` → app con PGlite en memoria + demo, `como(correo)` → cliente con sesión). Usuarios demo (clave `demo1234`): demo@ (administrador), counter@, patio@, finanzas@, soporte@ (superadmin) `@siguelogps.cl`.

## Comandos
`npm start` · `npm run dev` · `npm test` · `npm run capturas` (maquetas a PNG) · `npm run capturas-tienda` (capturas de las fichas de las apps)

## Reglas de pantalla (estandarización Síguelo, fase 1 · 1-nov-2026)
- **Toda lista va paginada de a 50.** En pantalla, `public/paginador.js` (lo instala `iniciarPagina()`) pagina solo toda `table.tabla` y todo contenedor con `data-paginar`; una lista que ya pagina en el servidor (las bitácoras) o que no es una lista (una matriz) lleva `data-sin-paginar`. En el servidor, una lista que puede crecer se pide por partes con `tramo(req)` de `src/paginacion.js` (`?limite=&desde=`, máximo 1000) y un `ORDER BY` total (con el id al final). No se agregan botones «Ver más».
- **Las búsquedas son por palabras:** cada palabra tiene que aparecer, en cualquier orden, sin mayúsculas ni tildes. En SQL, `porPalabras(columnas, q, params)` de `src/busqueda.js` (usa la función `sin_tildes()` de la migración 180; patentes y documentos con `{ col, limpiar: true }`); en pantalla, `calzaPalabras(texto, q)` de `comun.js`.
- **Todo `<select>` de 8 opciones o más lleva buscador** («selector buscable», `public/selector-buscable.js`, lo instala `iniciarPagina()`; en una página pública se llama `instalarSelectorBuscable()` de `comun.js`). Se convierte solo, también en modales y listas que se vuelven a llenar; el `<select>` nativo sigue siendo el valor del formulario. `data-sin-buscar` excluye, `data-buscar` fuerza uno corto, `data-secundario` en una `<option>` es texto gris que también se busca. Un `<select multiple>` no se toca.
- **Los modales se cierran solo con sus botones** (✕, «Cancelar», la acción) o con Esc; un clic fuera nunca los cierra.
- **Obligatorios con « *»:** lo pone `comun.js` solo, en todo control con `required` o `data-obligatorio` dentro de un `<label>`. No se escribe el asterisco a mano.
- **Vocabulario:** «Conexiones» (no «Integraciones»), «Cerrar sesión» (no «Salir»), «plataforma GPS».

## Reglas de pantalla (estandarización Síguelo, fase 2 · 1-nov-2026, maqueta `estandar-siguelo.html` aprobada)
- **Lo común vive en `public/estandar.js`** (módulo puro, probado en Node): menú del cliente por grupos (`MENU`, «Configuración» al final), menú del backoffice (`BACKOFFICE_MENU`), manuales por pantalla (`MANUALES`), pestañas base de Configuración (`PESTANAS_BASE`, `ordenarPestanas()`) y las franjas (`htmlFranja()`). `comun.js` solo lo pinta.
- **Botón «?» en la barra solo cuando la pantalla tiene manual:** se registra en `MANUALES` (clave = `activo`) o se pasa `iniciarPagina({ manual })`. Sin manual, no se muestra. On Rent aún no tiene manuales escritos.
- **«Mi cuenta»** (desde el avatar de la barra o la tarjeta del pie, `abrirMiCuenta()` de `comun.js`): nombre, correo y rol · «Cambiar mi clave» · Tema (Claro · Automático · Oscuro) · «Eliminar mi cuenta» · «Cerrar sesión». Ya no existe la pestaña «Mi clave» de Configuración (`#mi-clave` abre Mi cuenta).
- **Configuración:** primero Empresa · Usuarios · Conexiones · Bandeja de salida · Bitácora, después las propias (Sucursales, Plantillas, Portal de reservas). Solo pestañas con contenido real.
- **Ingreso:** «Ingresa a Síguelo On Rent», Correo y Clave con «ojo», botón «Entrar», y debajo solo los caminos que existen (equipo Síguelo desde On Board). Sin «Recordarme» ni recuperación de clave, porque no existen.
- **Franjas del equipo Síguelo:** negra en el backoffice (con «Entraste desde Síguelo On Board · Volver a On Board» solo si se entró desde allá: cookie `desde_onboard`), azul en «Ver como», negra también al «Operar». El amarillo queda para la marcha blanca (hoy, el chip de la barra).
- **Backoffice:** rutas de siempre (`/empresas`, `/empresas/:id`…); la ficha lleva pestañas Datos · Plan y módulos · Conexiones · Usuarios · Apps · Actividad y bitácora y la «Zona de riesgo» con título. Las conexiones de la lista se leen como letra + signo (✓ · … · ! · –).
