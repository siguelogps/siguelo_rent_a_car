// La única pantalla de Android: dibuja la app en Compose y se encarga de lo que necesita la Activity (permisos de
// cámara, ubicación y avisos; actualizaciones desde Google Play; el aviso push que abre una reserva).
package cl.siguelogps.onrent

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.CompositionLocalProvider
import androidx.core.content.ContextCompat
import cl.siguelogps.onrent.ui.Acciones
import cl.siguelogps.onrent.ui.AppRaiz
import cl.siguelogps.onrent.ui.AppViewModel
import cl.siguelogps.onrent.ui.Camara
import cl.siguelogps.onrent.ui.DestinoFoto
import cl.siguelogps.onrent.ui.FuenteImagenes
import cl.siguelogps.onrent.ui.LocalImagenes
import cl.siguelogps.onrent.ui.TemaOnRent
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability
import com.google.firebase.FirebaseApp

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()
    private var fotoPendiente: DestinoFoto? = null
    private var ubicacionPedida = false
    private val actualizador by lazy { AppUpdateManagerFactory.create(this) }

    private val permisoCamara = registerForActivityResult(ActivityResultContracts.RequestPermission()) { si ->
        val d = fotoPendiente
        fotoPendiente = null
        if (si && d != null) vm.abrirCamara(d)
        else if (!si) vm.avisar("Sin permiso de cámara no se pueden sacar las fotos. Actívalo en Ajustes del teléfono.", true)
    }
    private val permisoUbicacion = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { }
    private val permisoAvisos = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }
    private val flujoActualizar = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        abrirDesdeAviso(intent)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (!vm.atras()) finish() }
        })
        val fuente = FuenteImagenes(vm.imagenes)
        setContent {
            TemaOnRent {
                CompositionLocalProvider(LocalImagenes provides fuente) {
                    AppRaiz(
                        vm,
                        camara = { Camara(onFoto = vm::fotoTomada, onCancelar = vm::cerrarCamara, onError = { vm.cerrarCamara(); vm.avisar(it, true) }) },
                        actualizarApp = ::actualizar,
                        llamar = { Acciones.llamar(this, it) },
                    )
                }
            }
        }
        pedirPermisosDeTrabajo()
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); abrirDesdeAviso(intent) }

    private fun abrirDesdeAviso(i: Intent?) {
        val id = i?.getLongExtra(Config.EXTRA_RESERVA, 0L) ?: 0L
        if (id > 0) vm.abrirReserva(id)
    }

    override fun onResume() {
        super.onResume()
        vm.alVolver()
        // Una actualización de Play que quedó a medio instalar se termina al volver; las que llevan 3 días se ofrecen.
        actualizador.appUpdateInfo.addOnSuccessListener { info ->
            if (info.installStatus() == InstallStatus.DOWNLOADED) actualizador.completeUpdate()
            else if (info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS)
                runCatching { actualizador.startUpdateFlowForResult(info, flujoActualizar, AppUpdateOptions.defaultOptions(AppUpdateType.IMMEDIATE)) }
            else if (info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE && (info.clientVersionStalenessDays() ?: 0) >= 3 && info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE))
                runCatching { actualizador.startUpdateFlowForResult(info, flujoActualizar, AppUpdateOptions.defaultOptions(AppUpdateType.FLEXIBLE)) }
        }
        // La cámara se pide al abrirla (ver vm.abrirCamara vía pedirCamara).
        vm.pedirCamara = ::pedirCamara
    }

    private fun pedirCamara(d: DestinoFoto) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) vm.abrirCamara(d)
        else { fotoPendiente = d; permisoCamara.launch(Manifest.permission.CAMERA) }
    }

    /** Ubicación (para el sello de las fotos) mientras se usa la app; avisos solo si la app trae Firebase. */
    private fun pedirPermisosDeTrabajo() {
        if (!ubicacionPedida && ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            ubicacionPedida = true
            permisoUbicacion.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
        }
        if (Build.VERSION.SDK_INT >= 33 && runCatching { FirebaseApp.getApps(this).isNotEmpty() }.getOrDefault(false) &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) permisoAvisos.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    /** «Actualizar»: la actualización dentro de la app de Google Play; si no se puede, la ficha de la app en Play. */
    private fun actualizar() {
        actualizador.appUpdateInfo.addOnSuccessListener { info ->
            if (info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE && info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE))
                actualizador.startUpdateFlowForResult(info, flujoActualizar, AppUpdateOptions.defaultOptions(AppUpdateType.IMMEDIATE))
            else abrirPlay()
        }.addOnFailureListener { abrirPlay() }
    }

    private fun abrirPlay() {
        val id = packageName.removeSuffix(".prueba")
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$id"))) }
            .onFailure { runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$id"))) } }
    }
}
