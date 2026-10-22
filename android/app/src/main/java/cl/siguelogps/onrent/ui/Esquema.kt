// Esquema del auto para marcar daños: el mismo dibujo de public/esquema.js (SVG de 360×470 con cinco vistas) y las
// mismas coordenadas, así un daño marcado en el teléfono cae en el mismo lugar en la web, la liquidación y el PDF.
package cl.siguelogps.onrent.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.sp

/** Marca de un daño en el esquema. */
data class MarcaDano(val x: Double, val y: Double, val n: Int, val tipo: String, val nuevo: Boolean, val clave: String)

private fun ruta(d: String): Path = PathParser().parsePathString(d).toPath()

private val CUERPO = ruta("M0,-14 Q0,-30 14,-33 L70,-38 L100,-62 Q106,-68 116,-68 L196,-68 Q206,-68 214,-60 L250,-38 L288,-34 Q300,-32 300,-18 L300,-12 L0,-12 Z")
private val VIDRIOS = ruta("M78,-40 L102,-62 L150,-62 L150,-40 Z M156,-62 L196,-62 Q204,-62 210,-56 L236,-40 L156,-40 Z")
private val FRENTE = ruta("M70,178 L70,142 Q72,126 90,121 L110,90 Q114,84 122,84 L198,84 Q206,84 210,90 L230,121 Q248,126 250,142 L250,178 Z")
private val PARABRISAS = ruta("M116,119 L127,93 L193,93 L204,119 Z")
private val TECHO_CUERPO = ruta("M140,96 Q180,78 220,96 L236,132 L238,348 Q236,380 220,386 L140,386 Q124,380 122,348 L124,132 Z")
private val TECHO_PARABRISAS = ruta("M136,168 Q180,153 224,168 L217,204 L143,204 Z")
private val TECHO_LUNETA = ruta("M143,312 L217,312 L223,342 Q180,352 137,342 Z")
private val TECHO_CAPO = ruta("M150,104 Q180,96 210,104")

private val TRAZO = Color(0xFF3A414C)
private val VIDRIO = Color(0xFFEEF0F3)

@Composable
fun Esquema(marcas: List<MarcaDano>, modifier: Modifier = Modifier, editable: Boolean = true, onMarcar: (Double, Double) -> Unit = { _, _ -> }, onTocar: (MarcaDano) -> Unit = {}) {
    val medidor = rememberTextMeasurer()
    val etiqueta = remember { TextStyle(fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF5B6370)) }
    val numero = remember { TextStyle(fontFamily = PlexMono, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color.White) }
    Canvas(
        modifier.fillMaxWidth().aspectRatio(360f / 470f)
            .semantics { contentDescription = "Esquema del vehículo con ${marcas.size} daño(s). Toca donde está el daño." }
            .pointerInput(marcas, editable) {
                detectTapGestures { p ->
                    val k = size.width / 360f
                    val x = p.x / k; val y = p.y / k
                    val cerca = marcas.minByOrNull { (it.x - x) * (it.x - x) + (it.y - y) * (it.y - y) }
                    if (cerca != null && (cerca.x - x) * (cerca.x - x) + (cerca.y - y) * (cerca.y - y) < 16.0 * 16.0) onTocar(cerca)
                    else if (editable) onMarcar(x.toDouble(), y.toDouble())
                }
            },
    ) {
        val k = size.width / 360f
        // El dibujo, en coordenadas del SVG (360×470) escaladas al ancho.
        scale(k, k, pivot = Offset.Zero) {
            frente(-10f, false); frente(392f, true)
            withTransform({ translate(22f, 92f); rotate(90f, Offset.Zero) }) { cuerpoLateral() }
            withTransform({ translate(338f, 392f); rotate(-90f, Offset.Zero); translate(300f, 0f); scale(-1f, 1f, Offset.Zero) }) { cuerpoLateral() }
            techo()
        }
        // Textos y marcas, en píxeles (así la letra no se agranda con el dibujo).
        fun texto(x: Float, y: Float, t: String) {
            val m = medidor.measure(t, etiqueta)
            drawText(m, topLeft = Offset(x * k - m.size.width / 2f, y * k - m.size.height + 3f))
        }
        texto(180f, 12f, "FRENTE"); texto(180f, 462f, "ATRÁS"); texto(52f, 76f, "IZQUIERDO"); texto(308f, 76f, "DERECHO"); texto(180f, 262f, "TECHO")
        for (m in marcas) {
            val o = Offset(m.x.toFloat() * k, m.y.toFloat() * k)
            if (m.nuevo) drawCircle(Color(0xFFFFD500).copy(alpha = .9f), 15f * k, o)
            drawCircle(COLOR_DANO[m.tipo] ?: COLOR_DANO.getValue("otro"), 10.5f * k, o)
            drawCircle(Color.White, 10.5f * k, o, style = Stroke(2f * k))
            val t = medidor.measure("${m.n}", numero)
            drawText(t, topLeft = Offset(o.x - t.size.width / 2f, o.y - t.size.height / 2f))
        }
    }
}

private fun DrawScope.cuerpoLateral() {
    drawPath(CUERPO, Color.White); drawPath(CUERPO, TRAZO, style = Stroke(1.6f))
    drawPath(VIDRIOS, VIDRIO); drawPath(VIDRIOS, TRAZO, style = Stroke(1.1f))
    drawLine(TRAZO, Offset(150f, -40f), Offset(150f, -12f), 1f)
    for (cx in listOf(55f, 245f)) {
        drawCircle(Color.White, 14f, Offset(cx, -14f)); drawCircle(TRAZO, 14f, Offset(cx, -14f), style = Stroke(1.6f))
        drawCircle(TRAZO, 6f, Offset(cx, -14f), style = Stroke(1f))
    }
}

private fun DrawScope.frente(y: Float, atras: Boolean) {
    withTransform({ translate(130f, y); scale(.3125f, .3125f, Offset.Zero) }) {
        drawPath(FRENTE, Color.White); drawPath(FRENTE, TRAZO, style = Stroke(4f))
        drawPath(PARABRISAS, VIDRIO); drawPath(PARABRISAS, TRAZO, style = Stroke(3f))
        drawOval(TRAZO, Offset(81f, 132f), Size(30f, 16f), style = Stroke(3f))
        drawOval(TRAZO, Offset(209f, 132f), Size(30f, 16f), style = Stroke(3f))
        if (!atras) drawRoundRect(TRAZO, Offset(126f, 134f), Size(68f, 16f), CornerRadius(4f), style = Stroke(3f))
    }
}

private fun DrawScope.techo() {
    for ((x, y) in listOf(112f to 128f, 240f to 128f, 112f to 312f, 240f to 312f)) drawRoundRect(TRAZO, Offset(x, y), Size(8f, 36f), CornerRadius(3f))
    drawPath(TECHO_CUERPO, Color.White); drawPath(TECHO_CUERPO, TRAZO, style = Stroke(1.6f))
    drawPath(TECHO_PARABRISAS, VIDRIO); drawPath(TECHO_PARABRISAS, TRAZO, style = Stroke(1.1f))
    drawRoundRect(Color.White, Offset(144f, 210f), Size(72f, 96f), CornerRadius(8f)); drawRoundRect(TRAZO, Offset(144f, 210f), Size(72f, 96f), CornerRadius(8f), style = Stroke(1.1f))
    drawPath(TECHO_LUNETA, VIDRIO); drawPath(TECHO_LUNETA, TRAZO, style = Stroke(1.1f))
    drawPath(TECHO_CAPO, TRAZO, style = Stroke(1f))
    for (x in listOf(114f, 236f)) { drawRoundRect(Color.White, Offset(x, 170f), Size(10f, 7f), CornerRadius(2f)); drawRoundRect(TRAZO, Offset(x, 170f), Size(10f, 7f), CornerRadius(2f), style = Stroke(1f)) }
}
