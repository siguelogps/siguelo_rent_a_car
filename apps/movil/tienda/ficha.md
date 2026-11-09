# Ficha de las tiendas · Síguelo On Rent

Textos listos para copiar en Google Play Console y App Store Connect.

**Son dos apps distintas con el mismo nombre y paquete:**
- **Google Play:** app **nativa** de Android (Kotlin, carpeta `android/` del repositorio) para el personal del rentacar: agenda de entregas y devoluciones, flota, reservas, contratos e incidentes. Lo demás del sistema se abre en el navegador desde «Más».
- **App Store:** app de **Capacitor** (`apps/movil`) que muestra el sistema web completo dentro de la app.

Capturas:
- `capturas/android/`: de la app nativa. Las dibuja GitHub Actions (`android/app/src/test/…/CapturasPantallas.kt`, archivos `play-*.png` de la rama `capturas-android`) y se copian a mano: ver `capturas/android/README.md`.
- `capturas/iphone/` y `capturas/ipad/`: de la versión web, con `npm run capturas-tienda` en la raíz del repo (ese comando ya no toca las de Android).

## Datos generales (las dos tiendas)

| Campo | Valor |
|---|---|
| Nombre de la app | **Síguelo On Rent** (Play: máx. 30 caracteres · App Store: máx. 30) |
| Paquete / Bundle ID | `cl.siguelogps.onrent` (en Play, la app nativa es una actualización de la anterior: mismo paquete) |
| Requisitos | Android 8.0 o superior (app nativa) · iOS 15 o superior, iPhone y iPad |
| Categoría | Empresa (Play: *Empresa* · App Store: principal *Negocios*, secundaria *Productividad*) |
| Idioma principal | Español (Latinoamérica) — `es-419` |
| Precio | Gratis (el servicio se contrata con Síguelo GPS; **no** hay compras dentro de la app) |
| Política de privacidad | https://onrent.siguelogps.com/privacidad |
| Eliminar cuenta (Play, «Eliminación de datos») | https://onrent.siguelogps.com/privacidad#eliminar-cuenta |
| Soporte (App Store) | https://onrent.siguelogps.com/soporte |
| Sitio web | https://www.siguelogps.cl |
| Correo de contacto | soporte@siguelogps.cl |
| Clasificación de contenido | Para todo público (sin violencia, sin contenido generado por usuarios que se publique, sin compras) |
| Anuncios | No contiene anuncios |

## Descripción breve (Play, máx. 80)

Tu rentacar en el teléfono: reservas, contratos, entregas y devoluciones.

## Subtítulo (App Store, máx. 30)

Administra tu rentacar

## Descripción completa (Play y App Store, máx. 4.000)

Síguelo On Rent es el sistema de administración para empresas de arriendo de vehículos (rentacar) de Síguelo GPS. Con la app, tu equipo de mesón, patio y administración trabaja desde el teléfono o la tablet, con los mismos datos que en el computador.

Reservas sin dobles asignaciones
• Calendario por vehículo y sucursal: el sistema no permite dobles reservas.
• Cotiza con tus tarifas, temporadas, extras y códigos de descuento.

Entrega y devolución desde el patio
• Kilometraje y combustible leídos desde la plataforma GPS, para confirmar con el tablero.
• Checklist de accesorios y fotos guiadas del vehículo, selladas con fecha, hora y lugar.
• Compara la entrega con la devolución y marca cada daño sobre la foto.

Contrato con firma digital
• El cliente firma en el teléfono; el contrato en PDF lleva un código QR de verificación.
• Envía la copia por correo o WhatsApp.

Cobros, garantías y documentos
• Pagos y garantías, liquidación de la devolución, boletas y facturas electrónicas.
• Multas y TAG asociados a cada arriendo.

Tu flota, siempre al día
• Estado de cada vehículo, mantenciones, revisión técnica, seguros y ubicación GPS.
• Reportes de ocupación y ventas.

Multi-sucursal, con permisos por rol (administración, mesón, patio y finanzas) y todo en español de Chile: CLP, RUT y fechas dd-mm-aaaa.

Para usar la app, tu empresa debe tener contratado Síguelo On Rent. Las cuentas las crea el administrador de tu empresa. ¿Quieres conocerlo? Escríbenos a info@siguelogps.cl.

## Palabras clave (App Store, máx. 100)

<!-- Auditoría 8-nov (marca #12): «rent a car» queda solo aquí, como palabra que la gente busca en la tienda; en los
     textos que se leen va «rentacar», como manda el CLAUDE.md. -->

rent a car,arriendo,vehículos,flota,reservas,contrato,firma,patio,checklist,inspección,gps,chile

## Novedades de esta versión

- **Google Play** (la app nativa reemplaza a la anterior): Nueva app para el patio: agenda de entregas y devoluciones del día, fotos guiadas con fecha, hora y lugar, daños sobre el esquema y firma del cliente. Funciona sin señal y sube todo cuando vuelve.
- **App Store:** Primera versión de Síguelo On Rent para iPhone y iPad.

## Acceso para la revisión (obligatorio: la app pide ingresar)

La app no tiene registro público, así que las dos tiendas necesitan un usuario y una clave. **No se escriben en este archivo ni en el repositorio.** Se obtienen así:

1. Entra a Síguelo On Rent con un usuario **superadmin** del equipo Síguelo (backoffice).
2. **Backoffice › Clientes ›** botón **«Cuenta de revisión de tiendas»** (arriba a la derecha, junto a «+ Nuevo cliente»).
3. La primera vez dice **«Crear cuenta»**; después, **«Generar clave nueva»**. Crea (o deja como nueva) la empresa de demostración **Rentacar Demo Revisión**: vehículos, clientes, reservas, contratos e incidentes de prueba, en **marcha blanca** y sin conexiones (no sale ningún correo, WhatsApp, cobro, boleta ni inmovilización), con entregas y devoluciones para hoy que se renuevan solas cada hora.
4. La ventana muestra el **correo** (`revision-tiendas@demo.siguelogps.cl`) y una **clave al azar** una sola vez («Copiar correo y clave»). Pégalos directo en las tiendas. Si se pierde la clave, o el revisor eliminó la cuenta desde la app, vuelve a apretar el botón: la clave anterior deja de servir.

Dónde se pegan:
- **Play Console** → Contenido de la app → **Acceso a la app** → «Todas o algunas funciones están restringidas» → «Agregar instrucciones»: nombre «Cuenta de revisión», usuario, clave y la nota de Google Play de abajo.
- **App Store Connect** → la versión → **Información para la revisión de la app** → «Se requiere inicio de sesión»: usuario, clave y la nota de App Store de abajo.

### Nota para Google Play (app nativa)

> Síguelo On Rent es una herramienta de gestión para empresas de arriendo de vehículos (B2B), para el personal de patio y administración. Las cuentas las crea el administrador de cada empresa cliente; no hay registro público ni compras en la app. La cuenta de revisión es de una empresa de demostración: nada de lo que haga ahí envía mensajes ni cobros reales.
> Al ingresar se abre la **Agenda** con las entregas y devoluciones del día. Para revisar el flujo principal: Agenda → «Entregas» → tocar una reserva → el asistente pide kilometraje y combustible, las fotos del vehículo (cámara), los daños sobre el esquema, el checklist y la firma del cliente. «Devoluciones» funciona igual. En la barra inferior están Vehículos, Incidentes (reportar uno con fotos) y Más.
> La cámara se usa solo para fotografiar el vehículo, sus daños y los incidentes. La ubicación se pide solo mientras se usa la app, para sellar esas fotos con el lugar; no se usa en segundo plano.
> Para eliminar la cuenta: **Más › Eliminar mi cuenta** (pide la clave y confirmar). También por web: https://onrent.siguelogps.com/privacidad#eliminar-cuenta

### Nota para App Store (iPhone y iPad)

> Síguelo On Rent es una herramienta de gestión para empresas de arriendo de vehículos (B2B). Las cuentas las crea el administrador de cada empresa cliente; no hay registro público ni compras en la app. La cuenta de revisión es de una empresa de demostración: nada de lo que haga ahí envía mensajes ni cobros reales.
> Con la cuenta puede revisar las reservas (Reservas), el flujo de entrega con fotos y checklist (Entregas y devoluciones → una reserva → Iniciar entrega) y los contratos con firma digital (Contratos). La cámara se usa para fotos del vehículo y documentos, y la ubicación solo para sellar esas fotos.
> Para eliminar la cuenta: tocar el nombre de usuario (abajo en el menú) → Mi cuenta → Eliminar mi cuenta.

## Seguridad de los datos (Play Console, app nativa)

Revisado contra `android/app/src/main/AndroidManifest.xml`, `android/app/build.gradle.kts` y el código de la app (9-nov). La app usa: Room (lo último leído y la cola de envíos, solo en el teléfono), WorkManager (sube la cola cuando vuelve la señal), CameraX (fotos dentro de la app, sin galería), ubicación de Google Play services (solo con la app abierta), Firebase Cloud Messaging (avisos «Reserva nueva») y las actualizaciones de Google Play dentro de la app. **No** tiene anuncios, analítica, informes de fallos (no hay Crashlytics ni otro), compras, contactos, galería, micrófono ni ubicación en segundo plano.

| Pregunta | Respuesta |
|---|---|
| ¿Recopila o comparte datos? | Sí, **recopila**. **No comparte** con terceros (Google como proveedor de los avisos push procesa por encargo: no cuenta como «compartir»). |
| ¿Datos cifrados en tránsito? | **Sí.** Solo HTTPS (la app no permite tráfico sin cifrar: `seguridad_red.xml`). |
| ¿Se puede pedir la eliminación? | **Sí.** En la app: **Más › Eliminar mi cuenta**. Por web: https://onrent.siguelogps.com/privacidad#eliminar-cuenta |
| Información personal | **Nombre**, **Dirección de correo electrónico** e **IDs de usuario** (la cuenta y el nombre de quien firma una entrega) → *Funcionalidad de la app* y *Administración de la cuenta*. Obligatorio. |
| Ubicación | **Ubicación precisa** y **aproximada** (la app pide las dos; queda en el sello de cada foto de entrega, devolución o daño) → *Funcionalidad de la app*. Opcional (sin permiso, la foto queda «sin ubicación»). |
| Fotos y videos | **Fotos** (vehículo, daños, incidentes y la firma del cliente) → *Funcionalidad de la app*. Opcional (solo al hacer una entrega, devolución o incidente). |
| Actividad en la app | **Otro contenido generado por el usuario** (notas, observaciones, checklist, descripción de incidentes) e **Interacciones en la app** (quién hizo cada entrega, devolución o cambio, para la bitácora de la empresa) → *Funcionalidad de la app* y *Prevención de fraudes, seguridad y cumplimiento*. Obligatorio. |
| Dispositivo u otros IDs | **IDs de dispositivo u otros IDs** (el identificador de avisos push de Firebase, que se registra con la sesión) → *Funcionalidad de la app*. Solo si la versión se compiló con `GOOGLE_SERVICES_JSON` (el registro de Actions dice «avisos push activados»); si no, se omite. |
| Información financiera, compras | **No.** La app no cobra ni registra pagos (eso se hace en el navegador, fuera de la app). |
| Diagnóstico (fallos, rendimiento) | **No.** |
| Archivos y documentos | **No.** La app no elige ni sube archivos del teléfono; los contratos en PDF solo se descargan para verlos. |

Lo que queda guardado en el teléfono (Room) para trabajar sin señal no cuenta como recopilado mientras no sale del teléfono; no se respalda en la nube (`allowBackup=false`) y se borra al cerrar sesión.

## Privacidad de la app (App Store Connect → «Etiquetas de privacidad», app de Capacitor)

Datos **vinculados a la identidad**, usados solo para *Funcionalidad de la app*, **sin rastreo**: Información de contacto (nombre, correo, teléfono), Contenido del usuario (fotos, otro contenido del usuario), Ubicación (precisa y aproximada), Identificadores (ID de usuario), Compras (historial de compras), Uso (interacción con el producto). Rastreo: **No**.

## Permisos declarados

| Permiso | Android (app nativa) | iOS (texto que ve la persona) |
|---|---|---|
| Cámara | `CAMERA` (CameraX, dentro de la app) | «La cámara se usa para fotografiar el vehículo en la entrega y la devolución, los daños y los documentos del cliente…» |
| Ubicación (solo en uso) | `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` (sin ubicación en segundo plano) | «Al fotografiar el vehículo… la foto queda sellada con el lugar y la hora. La ubicación no se usa en segundo plano.» |
| Avisos | `POST_NOTIFICATIONS` (Android 13 o más) | — |
| Fotos de la galería | No se usa: las fotos se sacan con la cámara | «Para adjuntar fotos… que ya están en tu teléfono.» / «Para guardar en tu teléfono los documentos…» |

Cifrado de exportación (App Store): la app solo usa HTTPS → `ITSAppUsesNonExemptEncryption = NO` (ya está en Info.plist).
