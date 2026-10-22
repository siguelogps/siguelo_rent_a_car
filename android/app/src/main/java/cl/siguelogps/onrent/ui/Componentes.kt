// Piezas de pantalla con el estilo del CRM Síguelo Gestión: botón principal amarillo «btn primario», chips «chip»,
// tarjetas «tarjeta», patentes «pat», montos y folios en IBM Plex Mono.
package cl.siguelogps.onrent.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cl.siguelogps.onrent.core.Formatos

@Composable
fun Txt(
    texto: String, modifier: Modifier = Modifier, color: Color = c.tinta, size: TextUnit = 14.sp, peso: FontWeight = FontWeight.Normal,
    familia: FontFamily = Plex, alinear: TextAlign? = null, lineas: Int = Int.MAX_VALUE, alto: TextUnit = TextUnit.Unspecified,
) = Text(texto, modifier, color = color, fontSize = size, fontWeight = peso, fontFamily = familia, textAlign = alinear, maxLines = lineas,
    overflow = if (lineas < Int.MAX_VALUE) TextOverflow.Ellipsis else TextOverflow.Clip, lineHeight = alto)

@Composable fun Mono(texto: String, modifier: Modifier = Modifier, color: Color = c.tinta, size: TextUnit = 14.sp, peso: FontWeight = FontWeight.Medium) =
    Txt(texto, modifier, color, size, peso, PlexMono)

@Composable fun Muted(texto: String, modifier: Modifier = Modifier, size: TextUnit = 13.sp, lineas: Int = Int.MAX_VALUE) = Txt(texto, modifier, c.gris, size, lineas = lineas)

enum class TipoBoton { PRIMARIO, NORMAL, PELIGRO, OSCURO }

@Composable
fun Boton(texto: String, modifier: Modifier = Modifier, tipo: TipoBoton = TipoBoton.NORMAL, habilitado: Boolean = true, cargando: Boolean = false, alto: Dp = 50.dp, icono: (@Composable () -> Unit)? = null, onClick: () -> Unit) {
    val (fondo, borde, letra) = when (tipo) {
        TipoBoton.PRIMARIO -> Triple(c.marca, c.marca, c.sobreMarca)
        TipoBoton.NORMAL -> Triple(c.tarjeta, if (c.oscuro) Color(0xFF3A424D) else Color(0xFFC9CED6), c.tinta)
        TipoBoton.PELIGRO -> Triple(c.tarjeta, if (c.oscuro) Color(0xFF6B2A26) else Color(0xFFF1B5AE), c.rojo)
        TipoBoton.OSCURO -> Triple(if (c.oscuro) c.marcaSuave else c.tinta, if (c.oscuro) Color(0xFF5C5218) else c.tinta, if (c.oscuro) c.marcaTexto else Color.White)
    }
    val activo = habilitado && !cargando
    Row(
        modifier.heightIn(min = alto).clip(RoundedCornerShape(10.dp)).background(if (activo) fondo else fondo.copy(alpha = .5f))
            .border(1.dp, if (activo) borde else borde.copy(alpha = .5f), RoundedCornerShape(10.dp))
            .clickable(enabled = activo, role = Role.Button, onClick = onClick).padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
    ) {
        if (cargando) { CircularProgressIndicator(Modifier.size(18.dp), color = letra, strokeWidth = 2.dp); Spacer(Modifier.width(10.dp)) }
        else if (icono != null) { icono(); Spacer(Modifier.width(8.dp)) }
        Txt(texto, color = if (activo) letra else letra.copy(alpha = .6f), size = 15.sp, peso = FontWeight.SemiBold, alinear = TextAlign.Center)
    }
}

@Composable
fun Tarjeta(modifier: Modifier = Modifier, relleno: PaddingValues = PaddingValues(14.dp), borde: Color = c.linea, fondo: Color = c.tarjeta, onClick: (() -> Unit)? = null, contenido: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(fondo).border(1.dp, borde, RoundedCornerShape(12.dp))
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier).padding(relleno),
        content = contenido,
    )
}

enum class Tono { NEUTRO, OK, AVISO, ERROR, INFO, MORADO, MARCA }

@Composable
fun Chip(texto: String, tono: Tono = Tono.NEUTRO, modifier: Modifier = Modifier) {
    val (fondo, letra) = when (tono) {
        Tono.OK -> c.verdeSuave to c.verde
        Tono.AVISO -> c.ambarSuave to c.ambar
        Tono.ERROR -> c.rojoSuave to c.rojo
        Tono.INFO -> c.azulSuave to c.azul
        Tono.MORADO -> c.moradoSuave to c.morado
        Tono.MARCA -> c.marca to c.sobreMarca
        Tono.NEUTRO -> c.linea2 to c.tinta2
    }
    Box(modifier.clip(RoundedCornerShape(999.dp)).background(fondo).padding(horizontal = 10.dp, vertical = 3.dp)) {
        Txt(texto, color = letra, size = 12.5.sp, peso = FontWeight.SemiBold, lineas = 1)
    }
}

fun tonoReserva(estado: String) = when (estado) {
    "confirmada" -> Tono.INFO; "en_curso" -> Tono.OK; "devuelta" -> Tono.MORADO; "cotizacion" -> Tono.AVISO
    "cancelada", "no_show" -> Tono.ERROR; else -> Tono.NEUTRO
}
fun tonoVehiculo(estado: String) = when (estado) {
    "disponible" -> Tono.OK; "arrendado" -> Tono.INFO; "reservado" -> Tono.MORADO; "mantencion" -> Tono.AVISO; "fuera_servicio" -> Tono.ERROR; else -> Tono.NEUTRO
}
fun tonoIncidente(estado: String) = when (estado) {
    "reportado" -> Tono.ERROR; "presupuestado", "cobrado_cliente", "en_seguro" -> Tono.AVISO; "pagado", "cerrado" -> Tono.OK; else -> Tono.NEUTRO
}
fun tonoContrato(estado: String) = when (estado) { "firmado" -> Tono.OK; "pendiente_firma" -> Tono.AVISO; "anulado" -> Tono.ERROR; else -> Tono.NEUTRO }

/** Patente como placa: blanca con borde y letras negras (en los dos temas, como en la calle). */
@Composable
fun Pat(patente: String?, modifier: Modifier = Modifier, grande: Boolean = false) {
    Box(modifier.clip(RoundedCornerShape(5.dp)).background(Color.White).border(1.5.dp, Color(0xFF15181D), RoundedCornerShape(5.dp)).padding(horizontal = 7.dp, vertical = 1.dp)) {
        Mono(Formatos.patente(patente), color = Color(0xFF15181D), size = if (grande) 16.sp else 13.sp, peso = FontWeight.Bold)
    }
}

@Composable
fun Campo(
    valor: String, onCambio: (String) -> Unit, modifier: Modifier = Modifier, etiqueta: String? = null, ayuda: String? = null, error: String? = null,
    teclado: KeyboardType = KeyboardType.Text, clave: Boolean = false, lineas: Int = 1, mono: Boolean = false,
) {
    Column(modifier.fillMaxWidth()) {
        if (etiqueta != null) { Txt(etiqueta, color = c.tinta2, size = 13.sp, peso = FontWeight.Medium); Spacer(Modifier.height(5.dp)) }
        BasicTextField(
            value = valor, onValueChange = onCambio, singleLine = lineas == 1, minLines = lineas,
            textStyle = TextStyle(fontFamily = if (mono) PlexMono else Plex, fontSize = 16.sp, color = c.tinta),
            cursorBrush = SolidColor(c.tinta),
            keyboardOptions = KeyboardOptions(keyboardType = teclado),
            visualTransformation = if (clave) PasswordVisualTransformation() else VisualTransformation.None,
            modifier = Modifier.fillMaxWidth().semantics { if (etiqueta != null) contentDescription = etiqueta },
            decorationBox = { interno ->
                Box(
                    Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(10.dp)).background(c.tarjeta)
                        .border(1.dp, if (error != null) c.rojo else if (c.oscuro) Color(0xFF3A424D) else Color(0xFFC9CED6), RoundedCornerShape(10.dp))
                        .padding(horizontal = 12.dp, vertical = 12.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    if (valor.isEmpty() && ayuda != null) Txt(ayuda, color = c.gris, size = 16.sp, lineas = 1)
                    interno()
                }
            },
        )
        if (error != null) { Spacer(Modifier.height(4.dp)); Txt(error, color = c.rojo, size = 13.sp) }
    }
}

/** Cabecera oscura de las pantallas internas: «‹ volver», título y la patente a la derecha. */
@Composable
fun Cabecera(titulo: String, volver: String? = null, onVolver: (() -> Unit)? = null, patente: String? = null, sub: (@Composable () -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().background(c.cabecera).statusBarsPadding().padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            if (onVolver != null) {
                Box(Modifier.weight(1f).clip(RoundedCornerShape(6.dp)).clickable(role = Role.Button, onClick = onVolver).padding(vertical = 6.dp).semantics { contentDescription = "Volver" }) {
                    Txt("‹ ${volver ?: "Volver"}", color = c.cabeceraTenue, size = 14.sp, lineas = 1)
                }
            } else Spacer(Modifier.weight(1f))
            if (patente != null) Pat(patente)
        }
        Spacer(Modifier.height(4.dp))
        Txt(titulo, color = c.sobreCabecera, size = 21.sp, peso = FontWeight.SemiBold)
        if (sub != null) { Spacer(Modifier.height(10.dp)); sub() }
    }
}

/** Indicador de la cola: «✓ al día», «sin señal · 3 por subir», «1 con error · revisar». */
@Composable
fun BarraCola(porSubir: Int, conError: Int, enLinea: Boolean, onClick: (() -> Unit)? = null) {
    if (porSubir == 0 && conError == 0 && enLinea) return
    val (fondo, letra, texto) = when {
        conError > 0 -> Triple(c.rojoSuave, c.rojo, "$conError con error · revisar")
        !enLinea && porSubir > 0 -> Triple(c.ambarSuave, c.ambar, "Sin señal · $porSubir por subir")
        !enLinea -> Triple(c.ambarSuave, c.ambar, "Sin señal · se muestra lo guardado")
        else -> Triple(c.azulSuave, c.azul, "Subiendo · $porSubir por subir")
    }
    Box(Modifier.fillMaxWidth().background(fondo).then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(horizontal = 16.dp, vertical = 8.dp)) {
        Txt(texto, color = letra, size = 13.sp, peso = FontWeight.SemiBold)
    }
}

@Composable
fun FilaDato(etiqueta: String, valor: String, mono: Boolean = false, colorValor: Color = c.tinta) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Txt(etiqueta, Modifier.weight(1f), color = c.gris, size = 14.sp)
        Spacer(Modifier.width(12.dp))
        if (mono) Mono(valor, color = colorValor, size = 14.sp) else Txt(valor, color = colorValor, size = 14.sp, peso = FontWeight.Medium, alinear = TextAlign.End)
    }
}

/** Barra de combustible en octavos (E … F). Sin dato: todas apagadas y «—». */
@Composable
fun NivelCombustible(octavos: Int?, modifier: Modifier = Modifier, alto: Dp = 12.dp, onToque: ((Int) -> Unit)? = null) {
    Column(modifier) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            for (i in 1..8) {
                val on = octavos != null && i <= octavos
                Box(Modifier.weight(1f).height(alto).clip(RoundedCornerShape(2.dp)).background(if (on) c.tinta else c.linea)
                    .then(if (onToque != null) Modifier.clickable { onToque(if (octavos == i) i - 1 else i) } else Modifier))
            }
        }
        Row(Modifier.fillMaxWidth()) { Muted("E", size = 11.sp); Spacer(Modifier.weight(1f)); Muted("F", size = 11.sp) }
    }
}

@Composable
fun PuntoGps(activo: Boolean) = Box(Modifier.size(8.dp).clip(CircleShape).background(if (activo) Color(0xFF1E7B3A) else c.gris))

@Composable
fun Cargando(texto: String = "Cargando…") = Box(Modifier.fillMaxSize().padding(40.dp), contentAlignment = Alignment.TopCenter) {
    Row(verticalAlignment = Alignment.CenterVertically) { CircularProgressIndicator(Modifier.size(20.dp), color = c.tinta, strokeWidth = 2.dp); Spacer(Modifier.width(10.dp)); Muted(texto, size = 14.sp) }
}

@Composable
fun Vacio(texto: String, modifier: Modifier = Modifier) = Tarjeta(modifier) { Muted(texto, Modifier.fillMaxWidth().padding(vertical = 10.dp), size = 14.sp) }

@Composable
fun Aviso(texto: String, tono: Tono = Tono.NEUTRO, modifier: Modifier = Modifier) {
    val (fondo, letra) = when (tono) { Tono.ERROR -> c.rojoSuave to c.rojo; Tono.OK -> c.verdeSuave to c.verde; Tono.AVISO -> c.ambarSuave to c.ambar; Tono.INFO -> c.azulSuave to c.azul; else -> c.suave to c.tinta2 }
    Box(modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(fondo).border(1.dp, c.linea, RoundedCornerShape(10.dp)).padding(12.dp)) { Txt(texto, color = letra, size = 14.sp) }
}

@Composable fun Titulo(texto: String, modifier: Modifier = Modifier) = Txt(texto, modifier, size = 13.sp, peso = FontWeight.SemiBold, color = c.gris)

/** Pie fijo de las pantallas con acciones (Anterior / Siguiente). */
@Composable
fun Pie(contenido: @Composable RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth().background(c.tarjeta).border(BorderStroke(1.dp, c.linea)).padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), content = contenido)
}

// ── Íconos dibujados (sin bibliotecas de íconos) ──
@Composable
fun IconoCamara(color: Color = c.tinta, tam: Dp = 20.dp) = Canvas(Modifier.size(tam)) {
    val s = size.width / 24f
    val p = androidx.compose.ui.graphics.Path().apply { moveTo(4 * s, 8 * s); lineTo(7 * s, 8 * s); lineTo(9 * s, 5 * s); lineTo(15 * s, 5 * s); lineTo(17 * s, 8 * s); lineTo(20 * s, 8 * s); lineTo(20 * s, 19 * s); lineTo(4 * s, 19 * s); close() }
    drawPath(p, color, style = Stroke(1.8f * s, cap = StrokeCap.Round, join = StrokeJoin.Round))
    drawCircle(color, 3.5f * s, Offset(12 * s, 13 * s), style = Stroke(1.8f * s))
}

@Composable
fun IconoCheck(color: Color, tam: Dp = 14.dp) = Canvas(Modifier.size(tam)) {
    val s = size.width / 24f
    val p = androidx.compose.ui.graphics.Path().apply { moveTo(5 * s, 12 * s); lineTo(9 * s, 16 * s); lineTo(19 * s, 7 * s) }
    drawPath(p, color, style = Stroke(3.2f * s, cap = StrokeCap.Round, join = StrokeJoin.Round))
}

/** Caja del checklist: ✓ negra/amarilla si está en orden, ✕ roja si no. */
@Composable
fun CajaCheck(ok: Boolean) {
    Box(Modifier.size(24.dp).clip(RoundedCornerShape(6.dp)).background(if (ok) c.tinta else c.rojoSuave).border(1.5.dp, if (ok) c.tinta else c.rojo, RoundedCornerShape(6.dp)), contentAlignment = Alignment.Center) {
        if (ok) IconoCheck(c.marca) else Txt("✕", color = c.rojo, size = 13.sp, peso = FontWeight.Bold)
    }
}
