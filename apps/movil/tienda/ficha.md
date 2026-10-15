# Ficha de las tiendas · Síguelo On Rent

Textos listos para copiar en Google Play Console y App Store Connect. Las capturas están en `capturas/` (se regeneran con `npm run capturas-tienda` en la raíz del repo).

## Datos generales (las dos tiendas)

| Campo | Valor |
|---|---|
| Nombre de la app | **Síguelo On Rent** (Play: máx. 30 caracteres · App Store: máx. 30) |
| Paquete / Bundle ID | `cl.siguelogps.onrent` |
| Categoría | Empresa (Play: *Empresa* · App Store: principal *Negocios*, secundaria *Productividad*) |
| Idioma principal | Español (Latinoamérica) — `es-419` |
| Precio | Gratis (el servicio se contrata con Síguelo GPS; **no** hay compras dentro de la app) |
| Política de privacidad | https://onrent.siguelogps.com/privacidad |
| Eliminar cuenta (Play) | https://onrent.siguelogps.com/privacidad#eliminar-cuenta |
| Soporte (App Store) | https://onrent.siguelogps.com/soporte |
| Sitio web | https://www.siguelogps.cl |
| Correo de contacto | soporte@siguelogps.cl |
| Clasificación de contenido | Para todo público (sin violencia, sin contenido generado por usuarios públicos, sin compras) |
| Anuncios | No contiene anuncios |

## Descripción breve (Play, máx. 80)

Rent a car en tu teléfono: reservas, contratos, entregas y devoluciones con fotos.

## Subtítulo (App Store, máx. 30)

Administra tu rent a car

## Descripción completa (Play y App Store, máx. 4.000)

Síguelo On Rent es el sistema de administración para empresas de arriendo de vehículos (rent a car) de Síguelo GPS. Con la app, tu equipo de mesón, patio y administración trabaja desde el teléfono o la tablet, con los mismos datos que en el computador.

RESERVAS SIN TOPES
• Calendario por vehículo y sucursal: el sistema no permite dobles reservas.
• Cotiza con tus tarifas, temporadas, extras y códigos de descuento.

ENTREGA Y DEVOLUCIÓN DESDE EL PATIO
• Kilometraje y combustible leídos desde la plataforma GPS, para confirmar con el tablero.
• Checklist de accesorios y fotos guiadas del vehículo, selladas con fecha, hora y lugar.
• Compara la entrega con la devolución y marca cada daño sobre la foto.

CONTRATO CON FIRMA DIGITAL
• El cliente firma en el teléfono; el contrato en PDF lleva un código QR de verificación.
• Envía la copia por correo o WhatsApp.

COBROS, GARANTÍAS Y DOCUMENTOS
• Pagos y garantías, liquidación de la devolución, boletas y facturas electrónicas.
• Multas y TAG asociados a cada arriendo.

TU FLOTA, SIEMPRE AL DÍA
• Estado de cada vehículo, mantenciones, revisión técnica, seguros y ubicación GPS.
• Reportes de ocupación y ventas.

Multi-sucursal, con permisos por rol (administración, mesón, patio y finanzas) y todo en español de Chile: CLP, RUT y fechas dd-mm-aaaa.

Para usar la app, tu empresa debe tener contratado Síguelo On Rent. Las cuentas las crea el administrador de tu empresa. ¿Quieres conocerlo? Escríbenos a info@siguelogps.cl.

## Palabras clave (App Store, máx. 100)

rent a car,arriendo,vehículos,flota,reservas,contrato,firma,patio,checklist,inspección,gps,chile

## Novedades de esta versión

Primera versión de Síguelo On Rent para teléfonos y tablets.

## Acceso para la revisión (obligatorio: la app pide ingresar)

Crear antes de enviar una empresa de demostración (backoffice → Empresas → Nueva empresa, con datos de prueba) y un usuario administrador solo para la revisión. Informar en:
- **Play Console** → Contenido de la app → Acceso a la app → «Todas o algunas funciones están restringidas» → instrucciones + correo y clave.
- **App Store Connect** → Información para la revisión de la app → «Se requiere inicio de sesión» → usuario y clave + nota:

> Síguelo On Rent es una herramienta de gestión para empresas de arriendo de vehículos (B2B). Las cuentas las crea el administrador de cada empresa cliente; no hay registro público ni compras en la app. Con la cuenta de demostración puede revisar reservas (Reservas), el flujo de entrega con fotos y checklist (Entregas y devoluciones → una reserva → Iniciar entrega) y los contratos con firma digital (Contratos). La cámara se usa para fotos del vehículo y documentos, y la ubicación solo para sellar esas fotos. Para eliminar la cuenta: tocar el nombre de usuario (abajo en el menú) → Mi cuenta → Eliminar mi cuenta.

## Seguridad de los datos (Play Console)

| Pregunta | Respuesta |
|---|---|
| ¿Recopila o comparte datos? | Sí, recopila. **No** comparte con terceros (los proveedores que procesan por encargo no cuentan como «compartir»). |
| ¿Datos cifrados en tránsito? | Sí (HTTPS). |
| ¿Se puede pedir la eliminación? | Sí: en la app (Mi cuenta → Eliminar mi cuenta) y por web (enlace de arriba). |
| Información personal | Nombre, correo, teléfono, ID de usuario → *Funcionalidad de la app* y *Administración de la cuenta*. Obligatorio. |
| Ubicación | Aproximada y precisa → *Funcionalidad de la app* (sello de las fotos). Opcional. |
| Fotos y videos | Fotos → *Funcionalidad de la app*. Opcional. |
| Archivos y documentos | Archivos y documentos → *Funcionalidad de la app*. Opcional. |
| Actividad en la app | Interacciones en la app (bitácora) → *Funcionalidad de la app* y *Seguridad*. |
| Información financiera | Historial de compras (pagos de arriendos que registra la empresa) → *Funcionalidad de la app*. |

## Privacidad de la app (App Store Connect → «Etiquetas de privacidad»)

Datos **vinculados a la identidad**, usados solo para *Funcionalidad de la app*, **sin rastreo**: Información de contacto (nombre, correo, teléfono), Contenido del usuario (fotos, otro contenido del usuario), Ubicación (precisa y aproximada), Identificadores (ID de usuario), Compras (historial de compras), Uso (interacción con el producto). Rastreo: **No**.

## Permisos declarados

| Permiso | Android | iOS (texto que ve la persona) |
|---|---|---|
| Cámara | `CAMERA` | «La cámara se usa para fotografiar el vehículo en la entrega y la devolución, los daños y los documentos del cliente…» |
| Ubicación (solo en uso) | `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | «Al fotografiar el vehículo… la foto queda sellada con el lugar y la hora. La ubicación no se usa en segundo plano.» |
| Fotos | selector del sistema (sin permiso) | «Para adjuntar fotos… que ya están en tu teléfono.» / «Para guardar en tu teléfono los documentos…» |

Cifrado de exportación (App Store): la app solo usa HTTPS → `ITSAppUsesNonExemptEncryption = NO` (ya está en Info.plist).
