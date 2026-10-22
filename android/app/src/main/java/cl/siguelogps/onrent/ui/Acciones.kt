// Salidas del sistema: abrir una página del sistema web en el navegador y abrir o compartir un documento descargado.
// Como abrirArchivo() de public/nativa.js: el PDF se descarga con la sesión a la carpeta privada de la app y se entrega
// a otra app con un permiso temporal (FileProvider). Nunca un enlace público al archivo.
package cl.siguelogps.onrent.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File

object Acciones {
    fun abrirWeb(ctx: Context, url: String): Boolean = try {
        ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true
    } catch (e: ActivityNotFoundException) { false }

    fun abrirArchivo(ctx: Context, archivo: File, mime: String = "application/pdf"): Boolean {
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.archivos", archivo)
        val ver = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        return try { ctx.startActivity(ver); true } catch (e: ActivityNotFoundException) { compartirArchivo(ctx, archivo, mime) }
    }

    fun compartirArchivo(ctx: Context, archivo: File, mime: String = "application/pdf"): Boolean {
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.archivos", archivo)
        val enviar = Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        return try { ctx.startActivity(Intent.createChooser(enviar, "Compartir ${archivo.name}").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true } catch (e: ActivityNotFoundException) { false }
    }

    fun llamar(ctx: Context, telefono: String) = runCatching { ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${telefono.filter { it.isDigit() || it == '+' }}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.isSuccess
}
