// Trabajo de WorkManager que sube la cola. Corre con señal (restricción CONNECTED), aunque la app esté cerrada, y
// WorkManager lo reintenta con espera creciente (30 s, 1 min, 2 min…) si no alcanzó a subir todo.
package cl.siguelogps.onrent.datos

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import cl.siguelogps.onrent.OnRentApp
import cl.siguelogps.onrent.core.Vuelta

class SubidaWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val repo = (applicationContext as OnRentApp).contenedor.repo
        return when (repo.subir()) {
            Vuelta.Listo -> Result.success()
            // Sesión vencida: no sirve reintentar; la cola sigue guardada y se sube al volver a ingresar.
            Vuelta.Sesion -> Result.success()
            is Vuelta.Rechazo -> Result.success()
            Vuelta.Red -> if (runAttemptCount < 60) Result.retry() else Result.failure()
        }
    }
}
