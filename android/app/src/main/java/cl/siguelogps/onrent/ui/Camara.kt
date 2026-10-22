// Cámara dentro de la app (CameraX): las fotos de la entrega, la devolución, los daños y los incidentes se sacan aquí, nunca desde la galería, así llevan la
// fecha, hora y ubicación del momento.
package cl.siguelogps.onrent.ui

import android.graphics.Bitmap
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat

@Composable
fun Camara(onFoto: (Bitmap, Int) -> Unit, onCancelar: () -> Unit, onError: (String) -> Unit) {
    val ctx = LocalContext.current
    val ciclo = LocalLifecycleOwner.current
    val captura = remember { ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY).build() }
    var sacando by remember { mutableStateOf(false) }
    val vista = remember { PreviewView(ctx).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }
    DisposableEffect(ciclo) {
        val futuro = ProcessCameraProvider.getInstance(ctx)
        var proveedor: ProcessCameraProvider? = null
        futuro.addListener({
            try {
                proveedor = futuro.get()
                val preview = Preview.Builder().build().also { it.surfaceProvider = vista.surfaceProvider }
                proveedor?.unbindAll()
                proveedor?.bindToLifecycle(ciclo, CameraSelector.DEFAULT_BACK_CAMERA, preview, captura)
            } catch (e: Exception) { onError("No se pudo abrir la cámara: ${e.message}") }
        }, ContextCompat.getMainExecutor(ctx))
        onDispose { runCatching { proveedor?.unbindAll() } }
    }
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        AndroidView({ vista }, Modifier.fillMaxSize())
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(12.dp)) {
            Box(Modifier.clip(CircleShape).background(Color.Black.copy(alpha = .5f)).clickable(role = Role.Button, onClick = onCancelar).padding(horizontal = 16.dp, vertical = 10.dp)) {
                Txt("Cancelar", color = Color.White, size = 15.sp)
            }
        }
        Row(Modifier.align(Alignment.BottomCenter).fillMaxWidth().navigationBarsPadding().padding(bottom = 28.dp), horizontalArrangement = Arrangement.Center) {
            Box(
                Modifier.size(76.dp).clip(CircleShape).background(if (sacando) Color.Gray else Color.White).border(4.dp, Color.White.copy(alpha = .5f), CircleShape)
                    .semantics { contentDescription = "Sacar la foto" }
                    .clickable(enabled = !sacando, role = Role.Button) {
                        sacando = true
                        captura.takePicture(ContextCompat.getMainExecutor(ctx), object : ImageCapture.OnImageCapturedCallback() {
                            override fun onCaptureSuccess(image: ImageProxy) {
                                val rot = image.imageInfo.rotationDegrees
                                val bmp = runCatching { image.toBitmap() }.getOrNull()
                                image.close()
                                sacando = false
                                if (bmp != null) onFoto(bmp, rot) else onError("No se pudo leer la foto")
                            }
                            override fun onError(exception: ImageCaptureException) { sacando = false; onError("No se pudo sacar la foto: ${exception.message}") }
                        })
                    },
            )
        }
    }
}
