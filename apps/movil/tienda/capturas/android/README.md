# Capturas de Google Play · app nativa

Son de la app **nativa** de Android (no de la versión web). Las dibuja GitHub Actions con Robolectric y Roborazzi
(`android/app/src/test/java/cl/siguelogps/onrent/CapturasPantallas.kt`, pruebas `p01…p08`) con datos inventados, y
quedan como `play-*.png` en la rama `capturas-android`.

Miden **1080 × 2100 px** (360 × 700 dp a xxhdpi, proporción 1,94:1): Play pide que el lado más corto tenga al menos
320 px, que el más largo no pase de 3840 px y que no sea más del doble del otro. Las otras capturas de esa rama (1080 × 2340 o
más largas, con todo el contenido desplegado) sirven para revisar pantallas, pero no para Play.

| Archivo | Qué muestra |
|---|---|
| `01-ingreso.png` | Ingreso con correo y clave |
| `02-agenda.png` | Agenda: entregas del día, con lo empezado en el teléfono |
| `03-entrega-fotos.png` | Entrega · fotos guiadas con sello de fecha, hora y lugar |
| `04-devolucion-danos.png` | Devolución · esquema de daños con un daño nuevo |
| `05-entrega-firma.png` | Entrega · resumen y firma del cliente |
| `06-vehiculos-oscuro.png` | Vehículos con km y combustible de la plataforma GPS (modo oscuro) |
| `07-contrato.png` | Contrato firmado: ver PDF, compartir, reenviar |
| `08-eliminar-cuenta.png` | Eliminar mi cuenta (exigido por Play) |

Para actualizarlas, cuando cambien las pantallas (desde la raíz del repositorio):

```
git fetch origin capturas-android
for f in 01-ingreso 02-agenda 03-entrega-fotos 04-devolucion-danos 05-entrega-firma 06-vehiculos-oscuro 07-contrato 08-eliminar-cuenta; do
  git show "origin/capturas-android:play-$f.png" > "apps/movil/tienda/capturas/android/$f.png"
done
```

`npm run capturas-tienda` ya no genera esta carpeta (solo `iphone` e `ipad`).
