# Síguelo On Rent · app Android nativa

La app del personal del rentacar, en Kotlin con Jetpack Compose, sin WebView. Reemplaza a la app de Capacitor
(`apps/movil`) en Android, con el **mismo paquete** `cl.siguelogps.onrent`: en Play es una actualización de la misma
app. En iPhone sigue la app de Capacitor, y `apps/movil` sigue siendo la base de las apps con la marca del cliente
(`apps-propias.yml`): no se borró nada de ahí.

## Qué hace en el teléfono (nativo)

| Pantalla | Qué hace | Del servidor |
| --- | --- | --- |
| Ingreso | Correo y clave de siempre. La sesión es un token (30 días) guardado cifrado con el Keystore. | `POST /api/ingresar` con `nativa: true` |
| Agenda | Entregas, devoluciones y recibidas de hoy, con búsqueda. Marca lo «empezado en el teléfono» y lo «por subir». | `GET /api/patio/tareas` |
| Entrega y devolución | El asistente de la web en 5 pasos: km y combustible (de la plataforma GPS, confirmar o corregir) + checklist, las 11 fotos guiadas con sello de fecha, hora, coordenadas y sucursal (CameraX), esquema de daños con foto y nota, checklist y observaciones, y la firma del cliente. **Funciona sin señal.** | `/api/patio/…` |
| Vehículos | La flota con km y combustible de la plataforma GPS (o «Registro manual»; sin dato = «—»), vencimientos, daños y arriendo en curso. | `GET /api/vehiculos` |
| Reserva | Cliente, arriendo, lectura GPS y contrato. Acciones: entregar/recibir, confirmar, cancelar, no se presentó, generar contrato, reportar incidente, llamar. | `/api/reservas/:id` |
| Contrato | Estado, firma, código de verificación. Ver o compartir el PDF (se descarga con la sesión y se abre con otra app, como `abrirArchivo()` de `public/nativa.js`), enviar el enlace de firma, reenviar el firmado. | `/api/contratos/:id` |
| Incidentes | Lista, ficha y reporte nuevo con hasta 8 fotos. **El reporte funciona sin señal.** | `/api/incidentes` |
| Más | Usuario y empresa (de la sesión), envíos del teléfono, los módulos de computador con «Abrir en el navegador», privacidad, soporte, **eliminar mi cuenta** y cerrar sesión. | `/api/configuracion/eliminar-mi-cuenta` |

Lo demás (calendario de reservas, clientes, pagos, liquidaciones, facturación, mantención, plataforma GPS, TAG y
multas, tarifas, reportes, configuración) se abre en el navegador desde «Más», según el rol y el plan.

**Sin señal.** Lo último que se leyó queda en el teléfono (Room) y se muestra con el aviso «sin señal · se muestra lo
guardado». La entrega o devolución a medias se guarda a cada toque. Al firmar, todo (fotos, daños, firma, km,
checklist) pasa a una cola que WorkManager sube cuando hay señal, aunque la app esté cerrada, en orden y con espera
creciente. Arriba siempre se ve «Sin señal · 3 por subir» o «1 con error · revisar», y en Más → Envíos del teléfono,
el detalle.

**Sin duplicados.** Cada daño, incidente y cierre de inspección lleva un UUID en la cabecera `Idempotency-Key`; el
servidor guarda la respuesta y la repite si el envío llega dos veces (`src/app-nativa/idempotencia.js`). Las fotos se
guardan por posición (subirla de nuevo la reemplaza) e «iniciar» devuelve la inspección que ya existe.

**Seguridad.** La empresa y el usuario salen siempre de la sesión. El token va cifrado con una llave del Android
Keystore. Solo HTTPS. Sin respaldo en la nube. Permisos: cámara y ubicación solo mientras se usa la app; avisos.

## Cómo está armada

| Carpeta | Qué hay |
| --- | --- |
| `core/` | Kotlin puro, sin Android: modelos de la API, reglas del patio traducidas de `public/js/patio-comun.js` y `public/esquema.js`, la cola de subida, formatos chilenos y el cliente HTTP. Pruebas con JUnit. |
| `app/` | La app: pantallas (`ui/`), Room, sesión cifrada, WorkManager, CameraX, ubicación, avisos push y actualizaciones de Play. |
| `app/src/test/…/CapturasPantallas.kt` | Dibuja las pantallas en la JVM (Robolectric + Roborazzi), sin emulador. |

El esquema de daños es el mismo dibujo de `public/esquema.js` (las mismas coordenadas de 360×470), así un daño marcado
en el teléfono cae en el mismo lugar en la web, la liquidación y el PDF. `PatioTest` revisa 405 puntos contra la
función de la web (`core/src/test/resources/casos-esquema.json`; si cambia `esquema.js`, se regeneran con el comando
de abajo).

## Compilar

Java 17 o 21 y el SDK de Android (`ANDROID_HOME` o `local.properties` con `sdk.dir=…`).

```
cd android
./gradlew :core:test                   # lógica (no necesita el SDK de Android)
./gradlew assembleDebug                # APK de prueba (cl.siguelogps.onrent.prueba, «On Rent prueba»)
./gradlew :app:testDebugUnitTest --tests "*CapturasPantallas*" -Proborazzi.test.record=true   # capturas en app/build/capturas
```

Casos del esquema (desde la raíz del repositorio):

```
node --input-type=module -e "import { vistaDe, zonaDano } from './public/esquema.js'; const o=[]; for (let x=8;x<=352;x+=24) for (let y=8;y<=462;y+=17) { const v=vistaDe(x,y); o.push({x,y,vista:v,zona:zonaDano(v,x,y)}); } console.log(JSON.stringify(o));" > android/core/src/test/resources/casos-esquema.json
```

El servidor se cambia con `-Ponrent.url=https://…` o la variable `ONRENT_URL` (en Actions, la variable del
repositorio `ON_RENT_URL`); por defecto `https://onrent.siguelogps.com`.

En GitHub Actions, `.github/workflows/app-movil.yml` («App móvil») corre las pruebas (Kotlin y servidor), deja el APK
de prueba, el AAB y APK firmados si están los secretos, y sube las capturas a la rama `capturas-android`
(`git fetch origin capturas-android`). Versión 1.0.N, con N el número de la compilación, igual que antes: Play la toma
como una versión más nueva de la app que ya existe. Para recompilar se usa «Run workflow», no «Re-run jobs». Si algo
falla y la rama tiene un pull request abierto, las últimas líneas del registro quedan como comentario en el PR.

## Secretos que tiene que agregar Pablo

Son los **mismos nombres** que ya usaba la app de Capacitor. Si ya están en `siguelogps/siguelo_rent_a_car`, no hay que
hacer nada: la app nativa se firma con la misma llave de carga (`siguelo-on-rent.jks`). Si faltan, en PowerShell,
desde la carpeta de la llave (`gh` pregunta el valor y no queda en el historial):

```powershell
gh secret set ANDROID_KEYSTORE_BASE64 --repo siguelogps/siguelo_rent_a_car --body ([Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\siguelo-on-rent.jks")))
gh secret set ANDROID_KEYSTORE_PASSWORD --repo siguelogps/siguelo_rent_a_car
gh secret set ANDROID_KEY_ALIAS --repo siguelogps/siguelo_rent_a_car
gh secret set ANDROID_KEY_PASSWORD --repo siguelogps/siguelo_rent_a_car
```

Avisos push (opcional). En Firebase, agrega las apps Android `cl.siguelogps.onrent` y `cl.siguelogps.onrent.prueba`,
descarga `google-services.json` y ejecuta:

```powershell
Get-Content .\google-services.json -Raw | gh secret set GOOGLE_SERVICES_JSON --repo siguelogps/siguelo_rent_a_car
```

Para que el servidor mande los avisos: Firebase → ⚙ Configuración del proyecto → Cuentas de servicio → Generar nueva
clave privada. Después, en On Rent, con un superadmin: Backoffice → Apps con marca → «App Síguelo On Rent (Android)»,
pegar el contenido y Guardar (queda cifrada, no se vuelve a mostrar). «Aviso de prueba a mi teléfono» lo prueba.
El aviso que existe es «Reserva nueva» (del counter o del portal), para el personal que ve Reservas; tocarlo abre la
reserva.

Sin la llave, el trabajo firmado se omite y lo dice; el APK de prueba se compila igual. Sin `GOOGLE_SERVICES_JSON`,
la app compila sin avisos push.

## Versión mínima

Backoffice → Apps con marca → «App Síguelo On Rent (Android)» → Versión mínima (por ejemplo `1.0.42`). Las apps más
viejas muestran «Actualiza la app» y abren la actualización de Google Play. Vacío = no se exige. Además, la app ofrece
sola las actualizaciones de Play que llevan más de 3 días disponibles.

## Síguelo On Board

Los nombres de los artefactos no cambian, así que `siguelo-admin/apps/catalogo.json` sigue sirviendo tal cual:
`on-rent-prueba-1.0.N` (APK de prueba) y `on-rent-play-1.0.N` (con `on-rent-1.0.N.aab`), workflow `app-movil.yml`.

## Pendiente

- **Probar en un teléfono de verdad.** Todo se compiló y se probó en la JVM, pero no en un teléfono ni en un emulador:
  falta ver la cámara, el sello de las fotos, la ubicación, la firma con el dedo, que la cola suba después de recuperar
  la señal con la app cerrada, abrir el PDF y los avisos push.
- Migración `160_app_nativa.sql`: se aplica sola al arrancar el servidor.
- La ficha de Play: capturas nuevas de la app nativa (las de `apps/movil/tienda/capturas` son de la versión web) y
  revisar la declaración de datos (fotos, ubicación aproximada en el sello).
- iPhone sigue con la app de Capacitor. Una app nativa para iOS sería otro proyecto.
