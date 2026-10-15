# Síguelo On Rent · apps para Android y iOS

La app abre el sistema Síguelo On Rent (el mismo de la web) dentro de una app nativa hecha con **Capacitor 8**. Así cada mejora del sistema llega al teléfono sin publicar una versión nueva; solo hay que volver a publicar si cambia algo de esta carpeta (íconos, permisos, plugins).

| | Android | iOS |
|---|---|---|
| Nombre en el teléfono | Síguelo On Rent | Síguelo On Rent |
| Paquete / Bundle ID | `cl.siguelogps.onrent` (prueba: `cl.siguelogps.onrent.prueba`) | `cl.siguelogps.onrent` |
| Mínimo | Android 7 (API 24) · apunta a API 36 | iOS 15 · iPhone y iPad |

Qué agrega la app sobre la web (`public/nativa.js`, se activa solo dentro de la app):
- **Cámara y ubicación** para las fotos de entrega/devolución (con permisos y textos en español).
- **Archivos**: PDF de contratos, Excel y documentos se guardan en el teléfono y se abren con «Compartir / Abrir con» (los WebView no muestran PDF ni descargan). Las fotos se ven en un visor dentro de la app.
- Botón **atrás** de Android (cierra modales y el menú) y gesto de **deslizar para volver** en iOS.
- Pantalla **Sin conexión** con «Reintentar», pantalla de inicio y márgenes seguros (notch, barra inferior).
- Enlaces externos (WhatsApp, correo, sitio web) se abren en la app que corresponde.
- **Eliminar mi cuenta** (Mi cuenta → Eliminar mi cuenta), exigido por las dos tiendas. Política en `/privacidad`, soporte en `/soporte`.

El sistema web además quedó como **PWA** (`public/manifest.webmanifest`, `public/sw.js`): desde Chrome o Safari se puede «Agregar a pantalla de inicio».

## Carpetas

- `capacitor.config.json` — dirección del sistema (`server.url`), nombre y colores. Hoy: `https://onrent.siguelogps.com`. Si cambia el dominio, cambiarlo aquí y en `tienda/ficha.md`.
- `android/`, `ios/` — proyectos nativos (se abren con Android Studio / Xcode).
- `www/` — lo único que va dentro de la app: pantalla de carga y «Sin conexión».
- `assets/` — imágenes de origen de íconos y pantalla de inicio (`scripts/fuentes-iconos.py` las dibuja con los logos oficiales; `npm run iconos` genera todos los tamaños).
- `tienda/` — textos de la ficha, respuestas de los formularios, capturas (`capturas/android|iphone|ipad`), ícono 1024 y gráfico destacado de Play.

## 1. Probarla en el celular (Android)

Cada cambio en `apps/movil` compila solo en GitHub Actions (**Actions → App móvil**, también con «Run workflow»):
1. En la ejecución, abajo en **Artifacts**, descarga `on-rent-prueba-1.0.N` (un .zip con el .apk).
2. Pásalo al celular e instálalo (Android pide permitir «instalar apps desconocidas»).

En iPhone se prueba con **TestFlight** (sección 4).

## 2. Compilar en tu computador (opcional)

```
cd apps/movil
npm ci
npm run sincronizar      # prepara www/ y copia la configuración a android/ e ios/
npm run android          # abre Android Studio (▶ para instalar en un teléfono conectado)
npm run ios              # abre Xcode (solo en Mac)
```

## 3. Google Play

1. **Cuenta de desarrollador** de Síguelo GPS en Play Console (la misma de Síguelo Go).
2. **Llave de carga** (una sola vez, en Windows con Android Studio instalado):
   `powershell -ExecutionPolicy Bypass -File apps\movil\scripts\crear-llave.ps1`
   Crea `siguelo-on-rent.jks` y carga en GitHub los secretos `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` y `ANDROID_KEY_PASSWORD`. Guarda la llave y su clave en un lugar seguro (es distinta de la de Síguelo Go).
3. Correr **Actions → App móvil**: deja `on-rent-play-1.0.N` con el **.aab** firmado.
4. En Play Console: **Crear app** → «Síguelo On Rent», español (Latinoamérica), App, Gratis. Aceptar **Firma de apps de Google Play**.
5. Completar con `tienda/ficha.md`: ficha (textos, ícono `tienda/icono-1024.png` reducido a 512, gráfico destacado, capturas `tienda/capturas/android` y `ipad` para tablets), Contenido de la app (privacidad, acceso a la app con la cuenta de revisión, anuncios: no, clasificación, público objetivo: 18+, seguridad de los datos, eliminación de cuenta).
6. Subir el .aab a **Prueba interna** → probar → **Producción** (cuentas nuevas de desarrollador personal exigen prueba cerrada de 14 días con 12 personas; las cuentas de organización no).

## 4. App Store

1. **Apple Developer Program** de la empresa (organización, con D-U-N-S). Anotar el **Team ID** (Membership).
2. En **Certificates, IDs & Profiles** → Identifiers → registrar el App ID `cl.siguelogps.onrent`.
3. En **App Store Connect** → Apps → «+» → Nueva app: iOS, «Síguelo On Rent», idioma español (México), Bundle ID `cl.siguelogps.onrent`, SKU `siguelo-on-rent`.
4. **Llave de la API** (Users and Access → Integrations → App Store Connect API → «+», rol *App Manager*). Descarga el `.p8` (una sola vez) y carga en GitHub (Settings → Secrets and variables → Actions):
   - `APPSTORE_KEY_ID` (Key ID), `APPSTORE_ISSUER_ID` (Issuer ID), `IOS_TEAM_ID` (Team ID)
   - `APPSTORE_KEY_P8_BASE64` = el .p8 en base64 (PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("AuthKey_XXXX.p8")) | Set-Clipboard`)
5. Correr **Actions → App móvil**: archiva, firma (los certificados los crea Xcode solo con la llave) y **sube la versión a TestFlight**.
6. En App Store Connect completar con `tienda/ficha.md`: textos, capturas `tienda/capturas/iphone` (6,9") y `ipad` (13"), URL de privacidad y soporte, etiquetas de privacidad, cuenta de revisión. Elegir la compilación y **Enviar a revisión**.

> Para la revisión de Apple es clave la nota de `tienda/ficha.md` (herramienta B2B, cuentas creadas por la empresa) y una cuenta de demostración con datos.

## Versiones

GitHub Actions numera solo: versión `1.0.N` y número de compilación `N` (N = número de ejecución). Cada subida a las tiendas necesita un N mayor que la anterior: basta con volver a correr el flujo.

## Apps con la marca del cliente (marca blanca)

Igual que en Síguelo On Bus. Cada empresa con el módulo «App con la marca del cliente» (en su plan, o habilitado por Síguelo en Backoffice › Apps con marca cuando lo pide) obtiene **dos apps Android**:

| App | Abre | Paquete |
|---|---|---|
| Equipo | `https://onrent.siguelogps.com/ingresar?app=<empresa>` (ingreso con su logo; solo entra su personal) | `cl.siguelogps.onrent.<empresa>.equipo` |
| Clientes | `https://onrent.siguelogps.com/reservar/<empresa>` (su portal de reservas) | `cl.siguelogps.onrent.<empresa>.clientes` |

Flujo: la empresa completa en **Apps** el nombre de cada app, ícono, logo, color, textos de la tienda y soporte → firma en línea la autorización y licencia de uso de marca (PDF con fecha, IP y hash SHA-256) → Síguelo revisa en **Backoffice › Apps con marca** (observaciones o aprobación) → al aprobar se dispara `.github/workflows/apps-propias.yml`, que aplica la marca (`scripts/app-propia.mjs`), compila y firma el APK y el AAB y los sube a la plataforma → la solicitud pasa a «Lista para tienda» y la empresa puede descargar y compartir el APK → Síguelo sube el AAB a Play Console y la marca «Publicada» con el link.

Para que el disparo sea automático (una sola vez, superadmin): en Backoffice › Apps con marca guardar un token de GitHub con permiso *Contents: read & write* sobre este repositorio, y crear el **token de servicio**, que se guarda en GitHub como secreto `ON_RENT_PUBLICAR_TOKEN` junto a la variable `ON_RENT_URL=https://onrent.siguelogps.com`. Sin token de GitHub, la pantalla muestra el comando para ejecutarlo a mano.

**iPhone:** las apps con marca son solo Android. Apple no acepta apps «de plantilla» publicadas por el proveedor en nombre de sus clientes (norma 4.2.6): una app con marca en el App Store debe publicarse en la cuenta de desarrollador de Apple del propio cliente. En iPhone, el personal usa la app Síguelo On Rent y los clientes el portal de reservas (se puede agregar a la pantalla de inicio).
