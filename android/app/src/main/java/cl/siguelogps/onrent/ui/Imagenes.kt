// Imágenes: las del teléfono (archivo) y las del servidor (/api/archivos/:id, siempre con la sesión, nunca una URL
// pública). Se reducen al tamaño en pantalla y se guardan en memoria (y en la caché de la app, para verlas sin señal).
// En las capturas de pantalla (sin servidor) se dibuja un recuadro gris con la etiqueta.
package cl.siguelogps.onrent.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.sp
import cl.siguelogps.onrent.core.ApiOnRent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

class CargadorImagenes(private val api: ApiOnRent, cache: File) {
    private val dir = File(cache, "imagenes").apply { mkdirs() }
    private val memoria = object : LruCache<String, Bitmap>(24 * 1024 * 1024) { override fun sizeOf(k: String, v: Bitmap) = v.byteCount }

    suspend fun cargar(local: String?, archivoId: Long?, lado: Int = 1280): Bitmap? = withContext(Dispatchers.IO) {
        val clave = local ?: "a$archivoId"
        memoria.get(clave)?.let { return@withContext it }
        val f = local?.let { File(it) } ?: archivoId?.let { id ->
            File(dir, "$id.img").also { if (!it.exists() && api.descargar("/archivos/$id", it) != null) it.delete() }
        } ?: return@withContext null
        if (!f.exists()) return@withContext null
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(f.absolutePath, o)
        var m = 1
        while (maxOf(o.outWidth, o.outHeight) / (m * 2) >= lado) m *= 2
        BitmapFactory.decodeFile(f.absolutePath, BitmapFactory.Options().apply { inSampleSize = m })?.also { memoria.put(clave, it) }
    }
}

class FuenteImagenes(val cargador: CargadorImagenes)
val LocalImagenes = staticCompositionLocalOf<FuenteImagenes?> { null }

@Composable
fun Imagen(archivoLocal: String?, archivoId: Long?, descripcion: String, modifier: Modifier = Modifier) {
    val f = LocalImagenes.current
    val img by produceState<ImageBitmap?>(null, archivoLocal, archivoId, f) { value = f?.cargador?.cargar(archivoLocal, archivoId)?.asImageBitmap() }
    val i = img
    if (i == null) {
        Box(modifier.background(Color(0xFF8C939D)), contentAlignment = Alignment.Center) { Txt(if (f == null) descripcion else "", color = Color.White, size = 11.sp, lineas = 1) }
        return
    }
    Image(i, contentDescription = descripcion, contentScale = ContentScale.Crop, modifier = modifier)
}

@Composable fun ImagenLlena(archivoLocal: String?, archivoId: Long?, descripcion: String) = Imagen(archivoLocal, archivoId, descripcion, Modifier.fillMaxSize())
