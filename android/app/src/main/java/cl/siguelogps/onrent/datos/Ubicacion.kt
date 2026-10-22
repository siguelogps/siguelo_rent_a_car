// Ubicación del teléfono, solo mientras la app está abierta (sin ubicación en segundo plano). Va en el sello de las fotos:
// queda en la foto (sello) y en la entrega o devolución. Si no se puede, se dice por qué: no se inventa.
package cl.siguelogps.onrent.datos

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull

data class LecturaUbicacion(val pos: Posicion?, val motivo: String?)

class Ubicacion(private val ctx: Context) {
    fun tienePermiso() = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    suspend fun leer(esperaMs: Long = 10_000): LecturaUbicacion {
        if (!tienePermiso()) return LecturaUbicacion(null, "Sin permiso de ubicación: las fotos quedan «sin ubicación»")
        val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        if (!lm.isLocationEnabled) return LecturaUbicacion(null, "La ubicación del teléfono está apagada")
        val token = CancellationTokenSource()
        return try {
            val l = withTimeoutOrNull(esperaMs) {
                LocationServices.getFusedLocationProviderClient(ctx).getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, token.token).await()
            }
            if (l == null) LecturaUbicacion(null, "No se pudo leer la ubicación del teléfono")
            else LecturaUbicacion(Posicion(l.latitude, l.longitude, if (l.hasAccuracy()) l.accuracy.toDouble() else null), null)
        } catch (e: Exception) {
            LecturaUbicacion(null, "No se pudo leer la ubicación del teléfono")
        } finally { token.cancel() }
    }
}
data class Posicion(val lat: Double, val lng: Double, val precision: Double? = null)
