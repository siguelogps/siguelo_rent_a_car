// Avisos push (Firebase): «Reserva nueva». Solo funciona si la app se compiló con google-services.json; si no, Firebase
// no se inicia y este servicio nunca recibe nada. El token del teléfono se registra con la sesión (POST /api/app/dispositivo):
// el servidor saca la empresa y el usuario de la sesión.
package cl.siguelogps.onrent.push

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import cl.siguelogps.onrent.Config
import cl.siguelogps.onrent.MainActivity
import cl.siguelogps.onrent.OnRentApp
import cl.siguelogps.onrent.R
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

class ServicioAvisos : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        val app = application as OnRentApp
        app.alcance.launch { registrar(app, token) }
    }

    override fun onMessageReceived(m: RemoteMessage) {
        val titulo = m.notification?.title ?: m.data["titulo"] ?: return
        val cuerpo = m.notification?.body ?: m.data["cuerpo"].orEmpty()
        mostrar(this, titulo, cuerpo, m.data["reserva_id"]?.toLongOrNull())
    }

    companion object {
        private fun firebaseListo(ctx: Context) = runCatching { FirebaseApp.getApps(ctx).isNotEmpty() }.getOrDefault(false)

        /** Después de ingresar (y al abrir la app): pide el token a Firebase (si está) y lo registra. */
        suspend fun registrarSiSePuede(app: OnRentApp) {
            if (!firebaseListo(app)) return
            val token = runCatching { FirebaseMessaging.getInstance().token.await() }.getOrNull() ?: return
            registrar(app, token)
        }

        private suspend fun registrar(app: OnRentApp, fcm: String) {
            val repo = app.contenedor.repo
            if (!repo.conSesion) return
            val r = repo.api.registrarDispositivo(fcm, Config.version)
            if (r.status in 200..299) repo.sesion.fcm = fcm
        }

        fun mostrar(ctx: Context, titulo: String, cuerpo: String, reservaId: Long?) {
            if (android.os.Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
            val intento = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP).apply { reservaId?.let { putExtra(Config.EXTRA_RESERVA, it) } }
            val abrir = PendingIntent.getActivity(ctx, (reservaId ?: 0L).toInt(), intento, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val n = NotificationCompat.Builder(ctx, Config.CANAL_RESERVAS)
                .setSmallIcon(R.drawable.ic_notificacion)
                .setContentTitle(titulo)
                .setContentText(cuerpo)
                .setStyle(NotificationCompat.BigTextStyle().bigText(cuerpo))
                .setAutoCancel(true)
                .setContentIntent(abrir)
                .build()
            NotificationManagerCompat.from(ctx).notify((System.currentTimeMillis() % 100000).toInt(), n)
        }
    }
}
