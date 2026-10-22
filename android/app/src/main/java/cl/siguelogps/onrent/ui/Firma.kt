// Firma con el dedo (como el canvas de la web): trazos negros; se entrega como PNG de 600×300 sobre blanco.
package cl.siguelogps.onrent.ui

import android.graphics.Bitmap
import android.graphics.Canvas as LienzoAndroid
import android.graphics.Paint
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

class EstadoFirma {
    /** Trazos en proporción del recuadro (0..1), así el PNG sale igual en cualquier pantalla. */
    val trazos = mutableStateListOf<List<Offset>>()
    private val actual = mutableStateListOf<Offset>()
    val puntos: Int get() = trazos.sumOf { it.size } + actual.size
    val enCurso: List<Offset> get() = actual

    fun empezar(p: Offset) { actual.clear(); actual += p }
    fun seguir(p: Offset) { actual += p }
    fun terminar() { if (actual.isNotEmpty()) trazos += actual.toList(); actual.clear() }
    fun borrar() { trazos.clear(); actual.clear() }

    fun aBitmap(ancho: Int = 600, alto: Int = 300): Bitmap {
        val bmp = Bitmap.createBitmap(ancho, alto, Bitmap.Config.ARGB_8888)
        val c = LienzoAndroid(bmp)
        c.drawColor(android.graphics.Color.WHITE)
        val pincel = Paint().apply { color = 0xFF15181D.toInt(); strokeWidth = 4f; style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND; isAntiAlias = true }
        for (t in trazos + listOf(actual.toList())) {
            if (t.isEmpty()) continue
            val p = android.graphics.Path()
            p.moveTo(t[0].x * ancho, t[0].y * alto)
            t.drop(1).forEach { p.lineTo(it.x * ancho, it.y * alto) }
            if (t.size == 1) p.lineTo(t[0].x * ancho + 0.5f, t[0].y * alto)
            c.drawPath(p, pincel)
        }
        return bmp
    }
}

@Composable
fun PanelFirma(estado: EstadoFirma) {
    Canvas(
        Modifier.fillMaxWidth().height(180.dp).clip(RoundedCornerShape(12.dp)).background(Color.White)
            .drawBehind { drawRoundRect(Color(0xFFC9CED6), style = Stroke(1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 6f))), cornerRadius = CornerRadius(12.dp.toPx())) }
            .semantics { contentDescription = "Firma con el dedo" }
            .pointerInput(Unit) {
                fun rel(o: Offset) = Offset((o.x / size.width).coerceIn(0f, 1f), (o.y / size.height).coerceIn(0f, 1f))
                detectDragGestures(
                    onDragStart = { estado.empezar(rel(it)) },
                    onDrag = { cambio, _ -> estado.seguir(rel(cambio.position)) },
                    onDragEnd = { estado.terminar() },
                    onDragCancel = { estado.terminar() },
                )
            },
    ) {
        for (t in estado.trazos + listOf(estado.enCurso.toList())) {
            if (t.size < 2) continue
            val p = Path().apply { moveTo(t[0].x * size.width, t[0].y * size.height); t.drop(1).forEach { lineTo(it.x * size.width, it.y * size.height) } }
            drawPath(p, Color(0xFF15181D), style = Stroke(3.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
    }
}
