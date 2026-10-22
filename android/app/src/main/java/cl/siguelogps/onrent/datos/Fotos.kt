// Fotos de la entrega, la devolución, los daños y los incidentes. Igual que la web (public/js/patio-fotos.js): se
// reducen a 1600 px, JPEG 82 %, y se les estampa abajo una banda con fecha y hora de Chile, la etiqueta, las
// coordenadas y la sucursal. Se guardan en la carpeta privada de la app hasta que el servidor las recibe.
package cl.siguelogps.onrent.datos

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Shader
import android.graphics.Typeface
import androidx.core.content.res.ResourcesCompat
import cl.siguelogps.onrent.R
import cl.siguelogps.onrent.core.Formatos
import java.io.File
import java.util.Locale
import java.util.UUID

class Fotos(private val ctx: Context) {
    private val dir get() = File(ctx.filesDir, "fotos").apply { mkdirs() }

    /** Gira según el sensor, reduce, estampa el sello y guarda. Devuelve la ruta. */
    fun guardar(original: Bitmap, rotacion: Int, etiqueta: String, sucursal: String?, pos: Posicion?, ahora: Long = System.currentTimeMillis()): String {
        val girada = if (rotacion % 360 != 0) Bitmap.createBitmap(original, 0, 0, original.width, original.height, Matrix().apply { postRotate(rotacion.toFloat()) }, true) else original
        val foto = reducir(girada, 1600).copy(Bitmap.Config.ARGB_8888, true)
        sellar(foto, etiqueta, sucursal, pos, ahora)
        val archivo = File(dir, "${UUID.randomUUID()}.jpg")
        archivo.outputStream().use { foto.compress(Bitmap.CompressFormat.JPEG, 82, it) }
        return archivo.absolutePath
    }

    /** La firma del cliente: trazos oscuros sobre blanco, PNG (como el canvas de la web). */
    fun guardarFirma(firma: Bitmap): String {
        val archivo = File(dir, "firma-${UUID.randomUUID()}.png")
        archivo.outputStream().use { firma.compress(Bitmap.CompressFormat.PNG, 100, it) }
        return archivo.absolutePath
    }

    fun borrar(ruta: String?) { ruta?.let { runCatching { File(it).delete() } } }

    private fun sellar(b: Bitmap, etiqueta: String, sucursal: String?, pos: Posicion?, ahora: Long) {
        val g = Canvas(b)
        val fs = maxOf(13f, b.width / 52f)
        val coords = pos?.let { String.format(Locale.US, "%.4f, %.4f", it.lat, it.lng) } ?: "sin ubicación"
        val lineas = listOf("${Formatos.sello(ahora)}${if (etiqueta.isNotBlank()) "  ·  $etiqueta" else ""}", "$coords${if (!sucursal.isNullOrBlank()) "  ·  $sucursal" else ""}")
        val alto = fs * 1.35f * lineas.size + fs * 0.9f
        val y0 = b.height - alto * 1.4f
        val sombra = Paint().apply { shader = LinearGradient(0f, y0, 0f, b.height.toFloat(), intArrayOf(0x00000000, 0x8C000000.toInt(), 0xBF000000.toInt()), floatArrayOf(0f, .3f, 1f), Shader.TileMode.CLAMP) }
        g.drawRect(0f, y0, b.width.toFloat(), b.height.toFloat(), sombra)
        val letra = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.WHITE; textSize = fs
            typeface = runCatching { ResourcesCompat.getFont(ctx, R.font.ibm_plex_mono_bold) }.getOrNull() ?: Typeface.MONOSPACE
        }
        lineas.forEachIndexed { i, t -> g.drawText(t, fs * 0.7f, b.height - alto + fs * 0.45f + fs * 1.35f * (i + 1) - fs * 0.25f, letra) }
    }

    companion object {
        fun reducir(b: Bitmap, max: Int): Bitmap {
            val lado = maxOf(b.width, b.height)
            if (lado <= max) return b
            val f = max.toFloat() / lado
            return Bitmap.createScaledBitmap(b, (b.width * f).toInt().coerceAtLeast(1), (b.height * f).toInt().coerceAtLeast(1), true)
        }
    }
}
