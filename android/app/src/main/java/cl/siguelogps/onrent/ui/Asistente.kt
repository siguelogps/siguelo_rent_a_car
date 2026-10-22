// Asistente de entrega (check-out) y devolución (check-in), el mismo recorrido de la web (public/js/patio-asistente.js):
//   1 Km y combustible (+ checklist) · 2 Fotos guiadas · 3 Daños · 4 Checklist y observaciones · 5 Firma.
// Todo se guarda en el teléfono a cada toque (sin señal también) y al firmar pasa a la cola, que sube las fotos, los
// daños y la firma cuando hay señal. Nada se inventa: sin lectura de la plataforma GPS el km se escribe a mano.
package cl.siguelogps.onrent.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cl.siguelogps.onrent.core.BorradorInspeccion
import cl.siguelogps.onrent.core.Checklist
import cl.siguelogps.onrent.core.Dano
import cl.siguelogps.onrent.core.DanoPendiente
import cl.siguelogps.onrent.core.EstadoPatio
import cl.siguelogps.onrent.core.Formatos
import cl.siguelogps.onrent.core.Patio
import cl.siguelogps.onrent.core.declaracionFirma
import cl.siguelogps.onrent.core.validarKm
import kotlinx.coroutines.delay

private val PASOS = listOf("Km y combustible", "Fotos", "Daños", "Checklist", "Firma")
private val TITULOS = listOf("Km, combustible y checklist", "Fotos obligatorias", "Esquema de daños", "Checklist y observaciones", "Firma del cliente")

/** Lo que el asistente le pide a la app. */
data class AccionesAsistente(
    val paso: (Int) -> Unit = {},
    val cambiar: ((BorradorInspeccion) -> BorradorInspeccion) -> Unit = {},
    val camara: (DestinoFoto) -> Unit = {},
    val marcarDano: (Double, Double, String) -> Unit = { _, _, _ -> },
    val editarDano: (DanoPendiente) -> Unit = {},
    val firmar: (EstadoFirma, String) -> Unit = { _, _ -> },
    val volver: () -> Unit = {},
    val descartar: () -> Unit = {},
)

@Composable
fun PantallaAsistente(e: EstadoPatio, b: BorradorInspeccion, enviando: Boolean, a: AccionesAsistente, firma: EstadoFirma = remember { EstadoFirma() }, fotoInicial: String? = null) {
    val esE = b.esEntrega
    var corregir by remember { mutableStateOf(false) }
    var verPrevio by remember { mutableStateOf<Dano?>(null) }
    var descartar by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(c.fondo).imePadding()) {
        Cabecera(TITULOS[b.paso - 1], "${if (esE) "Entrega" else "Devolución"} · ${e.reserva.folio}", a.volver, e.reserva.patente) {
            Column {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    for (i in 1..5) Box(Modifier.weight(1f).height(4.dp).clip(RoundedCornerShape(2.dp)).background(if (i < b.paso) c.marca else if (i == b.paso) Color.White else Color.White.copy(alpha = .22f)).clickable { a.paso(i) })
                }
                Spacer(Modifier.height(8.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    PASOS.forEachIndexed { i, t -> Txt(t, Modifier.clickable(role = Role.Tab) { a.paso(i + 1) }, color = if (i + 1 == b.paso) c.marca else c.cabeceraTenue, size = 11.5.sp, peso = if (i + 1 == b.paso) FontWeight.SemiBold else FontWeight.Normal) }
                }
            }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            when (b.paso) {
                1 -> Paso1(e, b, a) { corregir = true }
                2 -> Paso2(e, b, a, fotoInicial)
                3 -> Paso3(e, b, a) { verPrevio = it }
                4 -> Paso4(e, b, a)
                else -> Paso5(e, b, a, firma)
            }
        }
        Pie {
            when (b.paso) {
                1 -> { Boton("Descartar", Modifier.weight(1f)) { descartar = true }; Boton("Siguiente", Modifier.weight(1f), TipoBoton.PRIMARIO, habilitado = b.confirmado) { a.paso(2) } }
                2 -> {
                    val sel = b.siguienteFoto(e.fotos)
                    if (sel != null) Boton("Tomar foto", Modifier.weight(1f), TipoBoton.PRIMARIO, icono = { IconoCamara(c.sobreMarca) }) { a.camara(DestinoFoto.Posicion(sel)) }
                    else { Boton("Anterior", Modifier.weight(1f)) { a.paso(1) }; Boton("Siguiente", Modifier.weight(1f), TipoBoton.PRIMARIO) { a.paso(3) } }
                }
                5 -> {
                    val falta = b.falta(e.fotos)
                    Boton(if (esE) "Firmar y entregar llaves" else "Firmar y recibir vehículo", Modifier.weight(1f), TipoBoton.PRIMARIO, habilitado = falta.isEmpty() && !enviando, cargando = enviando) {
                        a.firmar(firma, b.firmante)
                    }
                }
                else -> { Boton("Anterior", Modifier.weight(1f)) { a.paso(b.paso - 1) }; Boton("Siguiente", Modifier.weight(1f), TipoBoton.PRIMARIO) { a.paso(b.paso + 1) } }
            }
        }
    }
    if (corregir) DialogoKm(e, b, onCerrar = { corregir = false }) { km, comb -> a.cambiar { it.copy(km = km, combustible = comb, confirmado = true) }; corregir = false }
    verPrevio?.let { d ->
        AlertDialog(onDismissRequest = { verPrevio = null }, containerColor = c.tarjeta,
            title = { Txt("Daño ${d.n ?: ""} · preexistente", size = 18.sp, peso = FontWeight.SemiBold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Txt(d.titulo ?: Patio.tituloDano(d.tipo, d.vista, d.x, d.y, d.descripcion), peso = FontWeight.SemiBold)
                    Muted("${d.reservaFolio?.let { "Registrado en la ${if (d.inspeccionTipo == "devolucion") "devolución" else "entrega"} de $it" } ?: "Registrado en la ficha del vehículo"} · ${Formatos.fecha(d.creadoEn)}${d.incidenteFolio?.let { " · incidente $it" } ?: ""}")
                    if (d.archivoId != null) Box(Modifier.fillMaxWidth().aspectRatio(4f / 3f).clip(RoundedCornerShape(10.dp))) { ImagenLlena(null, d.archivoId, "Foto del daño") }
                    else Muted("Sin foto")
                }
            },
            confirmButton = { TextButton({ verPrevio = null }) { Txt("Cerrar", peso = FontWeight.SemiBold) } })
    }
    if (descartar) AlertDialog(onDismissRequest = { descartar = false }, containerColor = c.tarjeta,
        title = { Txt("¿Descartar lo hecho en el teléfono?", size = 18.sp, peso = FontWeight.SemiBold) },
        text = { Txt("Se borran las fotos, daños y datos de esta ${if (esE) "entrega" else "devolución"} que no se han enviado.") },
        confirmButton = { TextButton({ descartar = false; a.descartar() }) { Txt("Descartar", color = c.rojo, peso = FontWeight.SemiBold) } },
        dismissButton = { TextButton({ descartar = false }) { Txt("Seguir", color = c.gris) } })
}

// ── Paso 1: km, combustible y checklist ──
@Composable
private fun Paso1(e: EstadoPatio, b: BorradorInspeccion, a: AccionesAsistente, onCorregir: () -> Unit) {
    val l = e.lectura
    val gps = l?.esGps == true
    val origen = if (gps) "Plataforma GPS · ${Formatos.hace(l?.minutos)}" else "Registro manual"
    val corregido = b.confirmado && gps && (b.km != l?.km || b.combustible != l?.combustible)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Tarjeta(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) { PuntoGps(gps); Spacer(Modifier.width(5.dp)); Txt(origen, color = if (gps) c.verde else c.gris, size = 11.5.sp, peso = FontWeight.SemiBold, lineas = 2) }
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.Bottom) { Mono(if (b.km == null) Formatos.SIN_DATO else Formatos.miles(b.km), size = 24.sp, peso = FontWeight.Bold); Spacer(Modifier.width(4.dp)); Muted("km") }
            Muted(if (b.confirmado) (if (corregido) "Corregido (GPS: ${Formatos.miles(l?.km)})" else "Confirmado con el tablero") else "Odómetro del tablero: confirmar", size = 12.sp)
        }
        Tarjeta(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) { PuntoGps(gps); Spacer(Modifier.width(5.dp)); Txt(origen, color = if (gps) c.verde else c.gris, size = 11.5.sp, peso = FontWeight.SemiBold, lineas = 2) }
            Spacer(Modifier.height(6.dp))
            Mono(Formatos.octavos(b.combustible), size = 24.sp, peso = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            NivelCombustible(b.combustible)
        }
    }
    val ent = e.entrega
    if (!b.esEntrega && ent != null) Muted("En la entrega: ${Formatos.km(ent.km)} · ${Formatos.octavos(ent.combustible)}", size = 13.sp)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (b.confirmado) Box(Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).background(if (corregido) c.ambarSuave else c.verdeSuave).padding(14.dp)) {
            Txt(if (corregido) "✓ Corregido en patio" else "✓ Coincide con el tablero", color = if (corregido) c.ambar else c.verde, peso = FontWeight.SemiBold)
        } else Boton("Coincide con el tablero", Modifier.weight(1f), TipoBoton.PRIMARIO, icono = { IconoCheck(c.sobreMarca, 16.dp) }, habilitado = b.km != null && b.combustible != null && validarKm(b.km, if (b.esEntrega) null else ent?.km) == null) {
            a.cambiar { it.copy(confirmado = true) }
        }
        Boton("Corregir", onClick = onCorregir)
    }
    val base = if (!b.esEntrega) Checklist.desde(e.entrega?.checklist) else Checklist()
    Tarjeta(relleno = PaddingValues(horizontal = 12.dp, vertical = 4.dp)) {
        Checklist.ITEMS.forEachIndexed { i, it ->
            val ok = b.checklist.itemOk(it, base)
            val nota = b.checklist.notas[it.clave]
            Row(Modifier.fillMaxWidth().then(if (it.tipo == "si") Modifier.clickable(role = Role.Checkbox) { a.cambiar { x -> x.copy(checklist = x.checklist.alternar(it.clave)) } } else Modifier).padding(vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
                CajaCheck(ok); Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Txt(if (it.tipo == "n") "${it.nombre} (${b.checklist.triangulos})" else it.nombre, size = 15.sp)
                    if (nota != null) Muted(nota, size = 12.sp)
                }
                when (it.tipo) {
                    "n" -> Row(verticalAlignment = Alignment.CenterVertically) {
                        BotonChico("−", "Uno menos") { a.cambiar { x -> x.copy(checklist = x.checklist.conTriangulos(x.checklist.triangulos - 1)) } }
                        Mono("${b.checklist.triangulos}", Modifier.padding(horizontal = 10.dp), size = 16.sp, peso = FontWeight.Bold)
                        BotonChico("+", "Uno más") { a.cambiar { x -> x.copy(checklist = x.checklist.conTriangulos(x.checklist.triangulos + 1)) } }
                    }
                    "limpieza" -> Row(Modifier.clip(RoundedCornerShape(8.dp)).background(c.linea2).padding(3.dp)) {
                        for ((v, t) in listOf("ok" to "Limpio", "sucio" to "Sucio")) {
                            val sel = (b.checklist.limpieza == "sucio") == (v == "sucio")
                            Box(Modifier.clip(RoundedCornerShape(6.dp)).background(if (sel) c.tarjeta else Color.Transparent).clickable { a.cambiar { x -> x.copy(checklist = x.checklist.conLimpieza(v)) } }.padding(horizontal = 10.dp, vertical = 6.dp)) {
                                Txt(t, size = 13.sp, peso = if (sel) FontWeight.SemiBold else FontWeight.Normal)
                            }
                        }
                    }
                }
            }
            if (i < Checklist.ITEMS.size - 1) Box(Modifier.fillMaxWidth().height(1.dp).background(c.linea2))
        }
    }
}

@Composable
private fun BotonChico(t: String, desc: String, onClick: () -> Unit) =
    Box(Modifier.size(34.dp).clip(RoundedCornerShape(8.dp)).border(1.dp, c.linea, RoundedCornerShape(8.dp)).clickable(role = Role.Button, onClick = onClick).semantics { contentDescription = desc }, contentAlignment = Alignment.Center) {
        Txt(t, size = 18.sp, peso = FontWeight.SemiBold)
    }

@Composable
private fun DialogoKm(e: EstadoPatio, b: BorradorInspeccion, onCerrar: () -> Unit, onGuardar: (Long, Int) -> Unit) {
    var km by remember { mutableStateOf((b.km ?: e.lectura?.km)?.toString().orEmpty()) }
    var comb by remember { mutableStateOf(b.combustible ?: e.lectura?.combustible ?: 8) }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(onDismissRequest = onCerrar, containerColor = c.tarjeta,
        title = { Txt("Corregir km y combustible", size = 18.sp, peso = FontWeight.SemiBold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Campo(km, { km = it.filter { ch -> ch.isDigit() }.take(7) }, etiqueta = "Kilometraje del tablero", teclado = KeyboardType.Number, mono = true, error = error)
                Txt("Combustible (octavos)", color = c.tinta2, size = 13.sp, peso = FontWeight.Medium)
                NivelCombustible(comb, alto = 30.dp) { comb = it }
                Mono("$comb/8", Modifier.fillMaxWidth(), size = 14.sp)
                val lec = e.lectura
                if (lec?.esGps == true) Muted("Plataforma GPS: ${Formatos.km(lec.km)} · ${Formatos.octavos(lec.combustible)}. Si el tablero muestra otra cosa, registra lo del tablero.", size = 12.sp)
            }
        },
        confirmButton = { TextButton({
            val n = km.toLongOrNull()
            error = validarKm(n, if (b.esEntrega) null else e.entrega?.km)
            if (error == null && n != null) onGuardar(n, comb)
        }) { Txt("Guardar", peso = FontWeight.SemiBold) } },
        dismissButton = { TextButton(onCerrar) { Txt("Cancelar", color = c.gris) } })
}

// ── Paso 2: fotos guiadas ──
@Composable
private fun Paso2(e: EstadoPatio, b: BorradorInspeccion, a: AccionesAsistente, fotoInicial: String?) {
    val hechas = b.fotosHechas(e.fotos)
    val sig = b.siguienteFoto(e.fotos)
    var sel by remember { mutableStateOf(fotoInicial ?: sig ?: "frente") }
    LaunchedEffect(hechas.size) { if (sel in hechas && sig != null && fotoInicial == null) sel = sig }
    val local = b.fotos.firstOrNull { it.posicion == sel }
    val serv = e.fotos.firstOrNull { it.posicion == sel }
    val def = Patio.POSICIONES.firstOrNull { it.clave == sel }
    var reloj by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(1000); reloj = System.currentTimeMillis() } }
    Box(Modifier.fillMaxWidth().aspectRatio(4f / 3f).clip(RoundedCornerShape(14.dp)).background(Color(0xFF8C939D))) {
        if (local != null || serv != null) {
            ImagenLlena(local?.ruta, serv?.archivoId, Patio.nombrePosicion(sel))
            Box(Modifier.align(Alignment.TopStart).padding(10.dp).clip(RoundedCornerShape(6.dp)).background(Color(0xCC15181D)).padding(horizontal = 8.dp, vertical = 3.dp)) { Txt("✓ ${Patio.nombrePosicion(sel)}", color = Color.White, size = 13.sp, peso = FontWeight.SemiBold) }
            Box(Modifier.align(Alignment.BottomEnd).padding(10.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xCCFFFFFF)).clickable { a.camara(DestinoFoto.Posicion(sel)) }.padding(horizontal = 10.dp, vertical = 6.dp)) { Txt("Repetir foto", color = Color(0xFF15181D), size = 13.sp, peso = FontWeight.SemiBold) }
        } else {
            Box(Modifier.fillMaxSize().padding(start = 22.dp, end = 22.dp, top = 38.dp, bottom = 22.dp).drawBehind { drawRoundRect(Color(0xFFFFD500), style = Stroke(2.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(14f, 10f))), cornerRadius = CornerRadius(10.dp.toPx())) })
            Txt(def?.guia ?: "Foto adicional", Modifier.align(Alignment.TopCenter).padding(top = 8.dp), color = Color.White, size = 13.sp, peso = FontWeight.SemiBold)
            Column(Modifier.align(Alignment.BottomStart).padding(12.dp).clip(RoundedCornerShape(6.dp)).background(Color(0x9915181D)).padding(horizontal = 8.dp, vertical = 4.dp)) {
                Mono(Formatos.sello(reloj), color = Color.White, size = 11.sp)
                Mono("${e.sucursal?.nombre ?: ""}", color = Color.White, size = 11.sp)
            }
            Box(Modifier.align(Alignment.Center).size(64.dp).clip(CircleShape).background(Color(0x66FFFFFF)).clickable(role = Role.Button) { a.camara(DestinoFoto.Posicion(sel)) }, contentAlignment = Alignment.Center) { IconoCamara(Color.White, 30.dp) }
        }
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Txt("${Patio.OBLIGATORIAS.count { it in hechas }} de ${Patio.OBLIGATORIAS.size} fotos", size = 15.sp, peso = FontWeight.SemiBold)
        Spacer(Modifier.width(10.dp)); Muted("Fecha, hora y ubicación quedan estampadas", Modifier.weight(1f), size = 12.sp, lineas = 1)
    }
    val extras = (b.fotos.map { it.posicion } + e.fotos.map { it.posicion }).filter { it.startsWith("extra_") }.distinct().sorted()
    val tiles = Patio.OBLIGATORIAS + extras + listOf("nueva_extra")
    tiles.chunked(3).forEach { fila ->
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            fila.forEach { p ->
                val l = b.fotos.firstOrNull { it.posicion == p }; val s = e.fotos.firstOrNull { it.posicion == p }
                val hecha = l != null || s != null
                val esSig = p == sig
                Box(
                    Modifier.weight(1f).aspectRatio(1.25f).clip(RoundedCornerShape(10.dp))
                        .background(if (hecha) Color(0xFF8C939D) else if (esSig) c.marcaSuave else c.tarjeta)
                        .border(if (p == sel || esSig) 2.dp else 1.dp, if (p == sel) c.tinta else if (esSig) c.marca else c.linea, RoundedCornerShape(10.dp))
                        .clickable(role = Role.Button) {
                            if (p == "nueva_extra") a.camara(DestinoFoto.Posicion(b.nuevaExtra(e.fotos)))
                            else { sel = p; if (!hecha) a.camara(DestinoFoto.Posicion(p)) }
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    if (hecha) {
                        ImagenLlena(l?.ruta, s?.archivoId, Patio.nombrePosicion(p))
                        Box(Modifier.align(Alignment.TopStart).padding(4.dp).clip(RoundedCornerShape(4.dp)).background(Color(0xCC15181D)).padding(horizontal = 5.dp, vertical = 1.dp)) { Txt(Patio.nombrePosicion(p), color = Color.White, size = 10.sp, peso = FontWeight.SemiBold, lineas = 1) }
                        Box(Modifier.align(Alignment.TopEnd).padding(4.dp).size(18.dp).clip(CircleShape).background(Color(0xFF1E7B3A)), contentAlignment = Alignment.Center) { IconoCheck(Color.White, 11.dp) }
                        if (l == null) Box(Modifier.align(Alignment.BottomStart).padding(4.dp)) { Txt("en el sistema", color = Color.White, size = 9.sp) }
                    } else Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        IconoCamara(c.gris, 18.dp)
                        Txt(if (p == "nueva_extra") "+ Foto extra" else Patio.nombrePosicion(p), color = c.tinta2, size = 11.sp, peso = FontWeight.Medium, lineas = 1)
                    }
                }
            }
            repeat(3 - fila.size) { Spacer(Modifier.weight(1f)) }
        }
    }
}

// ── Paso 3: daños ──
@Composable
private fun Paso3(e: EstadoPatio, b: BorradorInspeccion, a: AccionesAsistente, onPrevio: (Dano) -> Unit) {
    var tipo by remember { mutableStateOf("raya") }
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Patio.TIPOS_DANO.forEach { (k, t) ->
            val sel = k == tipo
            Row(Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).background(if (sel) c.tinta else c.tarjeta).border(1.dp, if (sel) c.tinta else c.linea, RoundedCornerShape(8.dp)).clickable(role = Role.RadioButton) { tipo = k }.padding(vertical = 9.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(9.dp).clip(CircleShape).background(COLOR_DANO.getValue(k))); Spacer(Modifier.width(5.dp))
                Txt(t, color = if (sel) c.fondo else c.tinta, size = 12.sp, peso = FontWeight.SemiBold, lineas = 1)
            }
        }
    }
    val previos = e.danosPrevios
    val delServidor = e.danosNuevos
    var n = 0
    val marcas = previos.map { MarcaDano(it.x, it.y, ++n, it.tipo, false, "p${it.id}") } +
        delServidor.map { MarcaDano(it.x, it.y, ++n, it.tipo, !b.esEntrega, "s${it.id}") } +
        b.danos.map { MarcaDano(it.x, it.y, ++n, it.tipo, !b.esEntrega, "l${it.uuid}") }
    Tarjeta(relleno = PaddingValues(8.dp)) {
        Esquema(marcas, onMarcar = { x, y -> a.marcarDano(x, y, tipo) }, onTocar = { m ->
            when (m.clave[0]) {
                'p' -> previos.firstOrNull { "p${it.id}" == m.clave }?.let(onPrevio)
                's' -> delServidor.firstOrNull { "s${it.id}" == m.clave }?.let(onPrevio)
                else -> b.danos.firstOrNull { "l${it.uuid}" == m.clave }?.let(a.editarDano)
            }
        })
    }
    Muted("Toca el auto donde está el daño y agrega foto y nota", Modifier.fillMaxWidth(), size = 13.sp)
    var k = previos.size + delServidor.size
    b.danos.forEach { d ->
        k++
        FilaDano(k, d.tipo, Patio.tituloDano(d.tipo, d.vista, d.x, d.y, d.descripcion), if (b.esEntrega) "Preexistente · marcado en esta entrega" else "Nuevo · genera un incidente al recibir", !b.esEntrega, d.fotoRuta, null) { a.editarDano(d) }
    }
    delServidor.forEachIndexed { i, d -> FilaDano(previos.size + i + 1, d.tipo, d.titulo ?: Patio.tituloDano(d.tipo, d.vista, d.x, d.y, d.descripcion), "Marcado en el sistema", !b.esEntrega, null, d.archivoId) { onPrevio(d) } }
    previos.forEachIndexed { i, d ->
        FilaDano(i + 1, d.tipo, d.titulo ?: Patio.tituloDano(d.tipo, d.vista, d.x, d.y, d.descripcion), "Preexistente${d.reservaFolio?.let { " · ${if (d.inspeccionTipo == "devolucion") "devolución" else "entrega"} $it" } ?: " · registrado ${Formatos.fecha(d.creadoEn)}"}", false, null, d.archivoId) { onPrevio(d) }
    }
    if (marcas.isEmpty()) Vacio("Sin daños registrados en este vehículo.")
}

@Composable
private fun FilaDano(n: Int, tipo: String, titulo: String, sub: String, nuevo: Boolean, fotoLocal: String?, fotoId: Long?, onClick: () -> Unit) {
    Tarjeta(onClick = onClick, relleno = PaddingValues(10.dp), borde = if (nuevo) c.marca else c.linea) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(26.dp).clip(CircleShape).background(COLOR_DANO[tipo] ?: COLOR_DANO.getValue("otro")), contentAlignment = Alignment.Center) { Mono("$n", color = Color.White, size = 12.sp, peso = FontWeight.Bold) }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) { Txt(titulo, size = 14.sp, peso = FontWeight.SemiBold, lineas = 2); Muted(sub, size = 12.sp, lineas = 1) }
            if (fotoLocal != null || fotoId != null) Box(Modifier.size(44.dp).clip(RoundedCornerShape(6.dp))) { ImagenLlena(fotoLocal, fotoId, "Foto") }
        }
    }
}

/** Hoja del daño: tipo, nota y foto. */
@Composable
fun HojaDano(d: DanoPendiente, esEntrega: Boolean, nuevo: Boolean, onCambio: (DanoPendiente) -> Unit, onFoto: () -> Unit, onGuardar: (DanoPendiente) -> Unit, onBorrar: () -> Unit, onCerrar: () -> Unit) {
    AlertDialog(onDismissRequest = onCerrar, containerColor = c.tarjeta,
        title = { Txt(if (nuevo) "Nuevo daño" else "Daño", size = 18.sp, peso = FontWeight.SemiBold) },
        text = { ContenidoHojaDano(d, esEntrega, onCambio, onFoto) },
        confirmButton = { TextButton({ onGuardar(d) }) { Txt(if (nuevo) "Guardar daño" else "Guardar", peso = FontWeight.SemiBold) } },
        dismissButton = { TextButton(if (nuevo) onCerrar else onBorrar) { Txt(if (nuevo) "Cancelar" else "Eliminar", color = if (nuevo) c.gris else c.rojo) } })
}

@Composable
fun ContenidoHojaDano(d: DanoPendiente, esEntrega: Boolean, onCambio: (DanoPendiente) -> Unit, onFoto: () -> Unit) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) { Chip(Patio.zonaDano(d.vista, d.x, d.y)); Spacer(Modifier.width(8.dp)); Muted(if (esEntrega) "Queda como preexistente" else "Daño nuevo: crea un incidente", size = 12.sp) }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Patio.TIPOS_DANO.forEach { (k, t) ->
                        val sel = k == d.tipo
                        Box(Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).background(if (sel) c.tinta else c.tarjeta).border(1.dp, if (sel) c.tinta else c.linea, RoundedCornerShape(8.dp)).clickable { onCambio(d.copy(tipo = k)) }.padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
                            Txt(t, color = if (sel) c.fondo else c.tinta, size = 11.5.sp, peso = FontWeight.SemiBold, lineas = 1)
                        }
                    }
                }
                Campo(d.descripcion.orEmpty(), { onCambio(d.copy(descripcion = it.take(300))) }, etiqueta = "Nota", ayuda = "Ej: 8 cm, golpe en estacionamiento", lineas = 2)
                Box(Modifier.fillMaxWidth().height(140.dp).clip(RoundedCornerShape(10.dp)).background(c.suave), contentAlignment = Alignment.Center) {
                    if (d.fotoRuta != null) ImagenLlena(d.fotoRuta, null, "Foto del daño") else Muted("Sin foto del daño")
                }
                Boton(if (d.fotoRuta != null) "Cambiar foto" else "Agregar foto", Modifier.fillMaxWidth(), alto = 44.dp, icono = { IconoCamara() }) { onFoto() }
            }
}

// ── Paso 4: checklist y observaciones ──
@Composable
private fun Paso4(e: EstadoPatio, b: BorradorInspeccion, a: AccionesAsistente) {
    val base = if (!b.esEntrega) Checklist.desde(e.entrega?.checklist) else Checklist()
    val ent = e.entrega
    if (!b.esEntrega && ent != null) {
        val kmE = ent.km; val combE = ent.combustible; val km = b.km; val comb = b.combustible
        val rec = if (km != null && kmE != null) km - kmE else null
        val oct = if (comb != null && combE != null) combE - comb else 0
        val incl = e.reserva.kmIncluidos
        val nuevos = b.danos.size + e.danosNuevos.size
        val nDif = b.checklist.diferenciasCon(base)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Diferencia("Km recorridos", rec?.let { "+${Formatos.miles(it)}" } ?: Formatos.SIN_DATO, if (incl == null) "Kilometraje libre" else if ((rec ?: 0) > incl) "${Formatos.miles(rec!! - incl)} km sobre los ${Formatos.miles(incl)}" else "Incluye ${Formatos.miles(incl)} km", incl != null && (rec ?: 0) > incl, Modifier.weight(1f))
            Diferencia("Combustible", "${Formatos.octavos(combE)} → ${Formatos.octavos(b.combustible)}", if (oct > 0) "Faltan $oct/8" else "Sin diferencia", oct > 0, Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Diferencia("Daños", "${e.danosPrevios.size} → ${e.danosPrevios.size + nuevos}", if (nuevos > 0) "$nuevos nuevo(s)" else "Sin daños nuevos", nuevos > 0, Modifier.weight(1f))
            Diferencia("Checklist", "$nDif", if (nDif > 0) "diferencia(s) con la entrega" else "Igual que en la entrega", nDif > 0, Modifier.weight(1f))
        }
    }
    Tarjeta(relleno = PaddingValues(horizontal = 12.dp, vertical = 6.dp)) {
        Checklist.ITEMS.forEach { it ->
            val ok = b.checklist.itemOk(it, base)
            val estado = when (it.tipo) { "si" -> if (ok) "Sí" else "No"; "n" -> "${b.checklist.triangulos}"; else -> if (b.checklist.limpieza == "sucio") "Sucio" else "Limpio" }
            Column(Modifier.padding(vertical = 8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) { CajaCheck(ok); Spacer(Modifier.width(10.dp)); Txt(it.nombre, size = 14.sp); Muted(" · $estado", size = 13.sp) }
                Spacer(Modifier.height(6.dp))
                Campo(b.checklist.notas[it.clave].orEmpty(), { v -> a.cambiar { x -> x.copy(checklist = x.checklist.conNota(it.clave, v)) } },
                    ayuda = if (ok) (if (it.clave == "extintor") "Nota (opcional): ej. vence 08-2027" else "Nota (opcional)") else "Describe la observación")
            }
        }
    }
    Campo(b.observaciones, { v -> a.cambiar { it.copy(observaciones = v.take(2000)) } }, etiqueta = "Observaciones generales", ayuda = "Ej: cliente indica ruido en frenos", lineas = 3)
    if (!b.esEntrega) Tarjeta {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Txt("Enviar a mantención", peso = FontWeight.SemiBold); Muted("El vehículo queda «En mantención» en vez de disponible", size = 12.sp) }
            Switch(b.checklist.mantencion, { v -> a.cambiar { it.copy(checklist = it.checklist.copy(mantencion = v)) } }, colors = SwitchDefaults.colors(checkedTrackColor = c.marca, checkedThumbColor = c.sobreMarca))
        }
    }
}

@Composable
private fun Diferencia(titulo: String, valor: String, nota: String, mal: Boolean, modifier: Modifier) = Tarjeta(modifier, relleno = PaddingValues(10.dp)) {
    Muted(titulo, size = 12.sp); Mono(valor, size = 16.sp, peso = FontWeight.Bold); Txt(nota, color = if (mal) c.rojo else c.verde, size = 12.sp, peso = FontWeight.SemiBold)
}

// ── Paso 5: firma ──
@Composable
private fun Paso5(e: EstadoPatio, b: BorradorInspeccion, a: AccionesAsistente, firma: EstadoFirma) {
    val esE = b.esEntrega
    val base = if (!esE) Checklist.desde(e.entrega?.checklist) else Checklist()
    val cont = b.checklist.contar(base)
    val obs = b.checklist.observaciones(base)
    val hechas = b.fotosHechas(e.fotos)
    val nf = Patio.OBLIGATORIAS.count { it in hechas }
    val faltan = Patio.OBLIGATORIAS.size - nf
    Tarjeta {
        FilaDato(if (esE) "Km de salida" else "Km de llegada", Formatos.km(b.km), mono = true)
        FilaDato("Combustible", Formatos.octavos(b.combustible), mono = true)
        FilaDato("Fotos", "$nf de ${Patio.OBLIGATORIAS.size}${if (faltan == 0) " ✓" else ""}", colorValor = if (faltan > 0) c.rojo else c.tinta)
        FilaDato(if (esE) "Daños preexistentes" else "Daños", if (esE) "${e.danosPrevios.size + e.danosNuevos.size + b.danos.size} marcados" else "${e.danosPrevios.size} previos · ${e.danosNuevos.size + b.danos.size} nuevo(s)")
        FilaDato("Checklist", "$cont de ${Checklist.ITEMS.size}${if (obs > 0) " · $obs observaci${if (obs == 1) "ón" else "ones"}" else ""}")
        FilaDato(if (esE) "Devolución" else "Devolución pactada", Formatos.fechaHora(e.reserva.fin), mono = true)
    }
    Txt(declaracionFirma(esE, e.reserva.contratoFolio, e.reserva.folio), color = c.tinta2, size = 13.sp)
    Box {
        PanelFirma(firma)
        Box(Modifier.align(Alignment.TopEnd).padding(8.dp).clip(RoundedCornerShape(8.dp)).background(Color.White).border(1.dp, Color(0xFFC9CED6), RoundedCornerShape(8.dp)).clickable { firma.borrar() }.padding(horizontal = 10.dp, vertical = 5.dp)) {
            Txt("Borrar", color = Color(0xFF15181D), size = 13.sp, peso = FontWeight.SemiBold)
        }
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Campo(b.firmante, { v -> a.cambiar { it.copy(firmante = v.take(160)) } }, Modifier.weight(1f), ayuda = "Nombre de quien firma")
        Spacer(Modifier.width(8.dp))
        Mono(Formatos.documento(e.reserva.documentoTipo, e.reserva.documento), color = c.gris, size = 13.sp)
    }
    Aviso(if (esE) "El contrato firmado (PDF con QR) se enviará por correo y WhatsApp al activar las comunicaciones." else "Al recibir, la reserva queda «Devuelta» y se abre la comparación con la entrega para pasar a liquidación.")
    val falta = b.falta(e.fotos)
    if (falta.isNotEmpty()) Txt("No se puede terminar: $falta.", color = c.rojo, size = 14.sp, peso = FontWeight.SemiBold)
    else if (firma.puntos < 8) Muted("Pide al cliente que firme en el recuadro.", size = 13.sp)
}
