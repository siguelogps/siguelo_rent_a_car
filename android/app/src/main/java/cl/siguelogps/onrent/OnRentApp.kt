// Arranque de la app: arma las piezas una sola vez (servidor, base local, sesión, cola, imágenes con sesión) y sigue
// la señal del teléfono para el indicador «sin señal · N por subir».
package cl.siguelogps.onrent

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import androidx.work.Configuration
import cl.siguelogps.onrent.core.ApiOnRent
import cl.siguelogps.onrent.datos.Bd
import cl.siguelogps.onrent.datos.Fotos
import cl.siguelogps.onrent.datos.Repositorio
import cl.siguelogps.onrent.datos.Sesion
import cl.siguelogps.onrent.datos.Ubicacion
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

object Config {
    val apiUrl: String = BuildConfig.API_URL
    val version: String = BuildConfig.VERSION_NAME
    const val CANAL_RESERVAS = "reservas"
    const val EXTRA_RESERVA = "reserva_id"
}

class Contenedor(ctx: Context) {
    val api = ApiOnRent(Config.apiUrl, agente = "SigueloOnRent-Android/${Config.version}")
    val bd = Bd.abrir(ctx)
    val sesion = Sesion(ctx)
    val repo = Repositorio(ctx, api, bd, sesion, Fotos(ctx), Ubicacion(ctx))

    /** Imágenes del servidor (fotos de inspección, daños) con la sesión: nunca una URL pública. */
    val imagenes = cl.siguelogps.onrent.ui.CargadorImagenes(api, ctx.cacheDir)
}

class OnRentApp : Application(), Configuration.Provider {
    lateinit var contenedor: Contenedor
        private set
    val alcance = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override val workManagerConfiguration: Configuration get() = Configuration.Builder().build()

    override fun onCreate() {
        super.onCreate()
        contenedor = Contenedor(this)
        getSystemService(NotificationManager::class.java)
            .createNotificationChannel(NotificationChannel(Config.CANAL_RESERVAS, "Reservas nuevas", NotificationManager.IMPORTANCE_HIGH))
        seguirSenal()
        contenedor.repo.programarSubida()
    }

    private fun seguirSenal() {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return
        val repo = contenedor.repo
        repo.enLinea.value = cm.getNetworkCapabilities(cm.activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
        runCatching {
            cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) { repo.enLinea.value = true; repo.programarSubida() }
                override fun onLost(network: Network) { repo.enLinea.value = false }
            })
        }
    }
}
