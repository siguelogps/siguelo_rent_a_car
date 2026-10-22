// Pantalla principal con cuatro pestañas abajo: Agenda (entregas y devoluciones de hoy), Vehículos (con km y
// combustible de la plataforma GPS), Incidentes y Más (cuenta, módulos del computador y páginas legales).
package cl.siguelogps.onrent.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cl.siguelogps.onrent.core.Formatos
import cl.siguelogps.onrent.core.Incidente
import cl.siguelogps.onrent.core.Patio
import cl.siguelogps.onrent.core.Tarea
import cl.siguelogps.onrent.core.Tareas
import cl.siguelogps.onrent.core.Vehiculo
import cl.siguelogps.onrent.core.Web
import cl.siguelogps.onrent.core.Yo
import cl.siguelogps.onrent.datos.Lectura

// ── Barra de pestañas ──
@Composable
fun BarraPestanas(actual: Pestana, avisos: Int, onPestana: (Pestana) -> Unit) {
    Row(Modifier.fillMaxWidth().background(c.tarjeta).border(1.dp, c.linea).navigationBarsPadding().padding(vertical = 6.dp)) {
        for (p in Pestana.entries) {
            val sel = p == actual
            Column(
                Modifier.weight(1f).clickable(role = Role.Tab) { onPestana(p) }.padding(vertical = 4.dp).semantics { contentDescription = p.titulo },
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(Modifier.clip(RoundedCornerShape(999.dp)).background(if (sel) c.marca else Color.Transparent).padding(horizontal = 18.dp, vertical = 4.dp)) {
                    IconoPestana(p, if (sel) c.sobreMarca else c.gris)
                    if (p == Pestana.MAS && avisos > 0) Box(Modifier.align(Alignment.TopEnd).size(8.dp).clip(CircleShape).background(c.rojo))
                }
                Spacer(Modifier.height(3.dp))
                Txt(p.titulo, color = if (sel) c.tinta else c.gris, size = 12.sp, peso = if (sel) FontWeight.SemiBold else FontWeight.Medium)
            }
        }
    }
}

@Composable
private fun IconoPestana(p: Pestana, color: Color) = Canvas(Modifier.size(22.dp)) {
    val s = size.width / 24f
    val trazo = Stroke(1.8f * s, cap = StrokeCap.Round, join = StrokeJoin.Round)
    fun linea(x1: Float, y1: Float, x2: Float, y2: Float) = drawLine(color, Offset(x1 * s, y1 * s), Offset(x2 * s, y2 * s), 1.8f * s, StrokeCap.Round)
    when (p) {
        Pestana.AGENDA -> {
            drawRoundRect(color, Offset(4 * s, 5 * s), Size(16 * s, 15 * s), androidx.compose.ui.geometry.CornerRadius(2 * s), style = trazo)
            linea(4f, 10f, 20f, 10f); linea(8f, 3f, 8f, 7f); linea(16f, 3f, 16f, 7f)
        }
        Pestana.FLOTA -> auto(color, s, trazo)
        Pestana.INCIDENTES -> {
            val t = Path().apply { moveTo(12 * s, 4 * s); lineTo(21 * s, 19.5f * s); lineTo(3 * s, 19.5f * s); close() }
            drawPath(t, color, style = trazo); linea(12f, 10f, 12f, 14f); drawCircle(color, 1.1f * s, Offset(12 * s, 16.8f * s))
        }
        Pestana.MAS -> { linea(5f, 7f, 19f, 7f); linea(5f, 12f, 19f, 12f); linea(5f, 17f, 19f, 17f) }
    }
}

private fun DrawScope.auto(color: Color, s: Float, trazo: Stroke) {
    val p = Path().apply {
        moveTo(4 * s, 16 * s); lineTo(4 * s, 12 * s); lineTo(6.5f * s, 6.5f * s); quadraticTo(7 * s, 5 * s, 8.6f * s, 5 * s)
        lineTo(15.4f * s, 5 * s); quadraticTo(17 * s, 5 * s, 17.5f * s, 6.5f * s); lineTo(20 * s, 12 * s); lineTo(20 * s, 16 * s); close()
    }
    drawPath(p, color, style = trazo)
    drawLine(color, Offset(4 * s, 12 * s), Offset(20 * s, 12 * s), 1.8f * s)
    drawCircle(color, 1.3f * s, Offset(8 * s, 14 * s)); drawCircle(color, 1.3f * s, Offset(16 * s, 14 * s))
    drawLine(color, Offset(6 * s, 16 * s), Offset(6 * s, 19 * s), 1.8f * s, StrokeCap.Round); drawLine(color, Offset(18 * s, 16 * s), Offset(18 * s, 19 * s), 1.8f * s, StrokeCap.Round)
}

/** Cabecera de las pestañas: marca y nombre de la empresa (de la sesión). */
@Composable
fun CabeceraPrincipal(titulo: String, empresa: String?, accion: (@Composable () -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().background(c.cabecera).statusBarsPadding().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            MarcaOnRent(Modifier.weight(1f))
            if (empresa != null) Txt(empresa, color = c.cabeceraTenue, size = 13.sp, lineas = 1)
        }
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Txt(titulo, Modifier.weight(1f), color = c.sobreCabecera, size = 22.sp, peso = FontWeight.SemiBold)
            accion?.invoke()
        }
    }
}

@Composable
fun Segmentos(opciones: List<Pair<String, Int?>>, actual: Int, onCambio: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        opciones.forEachIndexed { i, (t, n) ->
            val sel = i == actual
            Row(
                Modifier.clip(RoundedCornerShape(999.dp)).background(if (sel) c.tinta else c.tarjeta).border(1.dp, if (sel) c.tinta else c.linea, RoundedCornerShape(999.dp))
                    .clickable(role = Role.Tab) { onCambio(i) }.padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Txt(t, color = if (sel) c.fondo else c.tinta, size = 14.sp, peso = FontWeight.SemiBold)
                if (n != null) {
                    Spacer(Modifier.width(8.dp))
                    Box(Modifier.clip(RoundedCornerShape(6.dp)).background(if (sel) c.fondo.copy(alpha = .18f) else c.linea2).padding(horizontal = 6.dp)) {
                        Mono("$n", color = if (sel) c.fondo else c.tinta2, size = 12.sp, peso = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

@Composable
fun Busqueda(valor: String, onCambio: (String) -> Unit, ayuda: String) = Campo(valor, onCambio, ayuda = "⌕  $ayuda")

// ── Agenda ──
@Composable
fun ContenidoAgenda(
    lectura: Lectura<Tareas>?, puedePatio: Boolean, porSubir: Set<Long>, borradores: Set<Long>,
    onTarea: (Tarea, String) -> Unit, onReserva: (Long) -> Unit, onRecargar: () -> Unit,
) {
    var seg by rememberSaveable { mutableStateOf(0) }
    var q by rememberSaveable { mutableStateOf("") }
    if (!puedePatio) { Column(Modifier.padding(16.dp)) { Vacio("Tu rol no tiene acceso a Entregas y devoluciones. Pide el permiso al administrador de tu empresa.") }; return }
    if (lectura == null) { Cargando(); return }
    val t = lectura.datos
    if (t == null) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { Aviso(lectura.aviso ?: "No se pudo cargar la agenda", Tono.ERROR); Boton("Reintentar", Modifier.fillMaxWidth()) { onRecargar() } }; return }
    val listas = listOf(t.entregas, t.devoluciones, t.recientes)
    val textos = listOf(
        "Reservas confirmadas que se retiran hoy o mañana (y las que ya debieron salir).",
        "Arriendos en curso que vuelven hoy o están atrasados.",
        "Devoluciones de los últimos 10 días.",
    )
    val filtro = q.trim().uppercase().filter { it.isLetterOrDigit() || it == ' ' }
    val lista = listas[seg].filter { x -> filtro.isBlank() || listOfNotNull(x.patente, x.folio.replace("-", ""), x.cliente?.uppercase()).any { it.uppercase().contains(filtro.replace(" ", "")) || it.contains(filtro) } }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (lectura.aviso != null) item { Aviso(lectura.aviso + (lectura.cuando?.let { " (${Formatos.sello(it).dropLast(3)})" } ?: ""), Tono.AVISO) }
        item { Busqueda(q, { q = it }, "Buscar patente, folio o cliente") }
        item { Segmentos(listOf("Entregas" to t.entregas.size, "Devoluciones" to t.devoluciones.size, "Recibidas" to t.recientes.size), seg) { seg = it } }
        item { Muted(textos[seg]) }
        if (lista.isEmpty()) item { Vacio(if (q.isNotBlank()) "Nada coincide con «$q»." else listOf("No hay entregas pendientes.", "No hay devoluciones pendientes.", "No hay devoluciones recientes.")[seg]) }
        items(lista, key = { it.id }) { x ->
            val tipo = if (seg == 0) "entrega" else "devolucion"
            TarjetaTarea(x, seg, x.id in porSubir, x.id in borradores, onClick = { onTarea(x, tipo) }, onReserva = { onReserva(x.id) })
        }
    }
}

@Composable
fun TarjetaTarea(x: Tarea, seg: Int, porSubir: Boolean, borrador: Boolean, onClick: () -> Unit, onReserva: () -> Unit) {
    val cuando = if (seg == 0) x.inicio else if (seg == 1) x.fin else x.devolucionReal ?: x.fin
    val donde = if (seg == 0) "retiro en ${x.sucursalRetiro ?: Formatos.SIN_DATO}" else "devolución en ${x.sucursalDevolucion ?: Formatos.SIN_DATO}"
    Tarjeta(onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Pat(x.patente); Spacer(Modifier.width(8.dp))
            Chip(Formatos.ESTADOS_RESERVA[x.estado] ?: x.estado, tonoReserva(x.estado))
            Spacer(Modifier.weight(1f)); Mono(x.folio, color = c.gris, size = 13.sp)
        }
        Spacer(Modifier.height(10.dp))
        Txt(x.cliente?.takeIf { it.isNotBlank() } ?: Formatos.SIN_DATO, size = 17.sp, peso = FontWeight.SemiBold, lineas = 1)
        Muted(listOfNotNull(x.marca, x.modelo, x.color).joinToString(" · ").ifBlank { Formatos.SIN_DATO }, size = 14.sp)
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Mono(Formatos.hora(cuando), size = 17.sp, peso = FontWeight.Bold)
            Spacer(Modifier.width(8.dp))
            Muted("${Formatos.diaRelativo(cuando)} · $donde", Modifier.weight(1f), size = 13.sp, lineas = 1)
            Txt("›", color = c.gris, size = 20.sp)
        }
        val chips = buildList {
            if (porSubir) add("Por subir" to Tono.AVISO)
            else if (borrador) add("Empezada en el teléfono" to Tono.MARCA)
            else if (x.inspeccionEstado == "borrador") add("Empezada · ${x.fotos ?: 0} de 11 fotos" to Tono.MARCA)
            if (x.atrasada) add("Atrasada" to Tono.ERROR)
            if (x.vencida) add("Debió salir" to Tono.ERROR)
        }
        if (chips.isNotEmpty() || seg != 2) {
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                chips.forEach { (t, tono) -> Chip(t, tono) }
                Spacer(Modifier.weight(1f))
                Txt("Ver reserva", Modifier.clip(RoundedCornerShape(6.dp)).clickable(role = Role.Button, onClick = onReserva).padding(6.dp), color = c.tinta2, size = 13.sp, peso = FontWeight.SemiBold)
            }
        }
    }
}

// ── Vehículos ──
@Composable
fun ContenidoFlota(lectura: Lectura<List<Vehiculo>>?, puedeIncidente: Boolean, onRecargar: () -> Unit, onReserva: (Long) -> Unit, onIncidente: (Vehiculo) -> Unit) {
    var q by rememberSaveable { mutableStateOf("") }
    var seg by rememberSaveable { mutableStateOf(0) }
    if (lectura == null) { Cargando(); return }
    val lista = lectura.datos
    if (lista == null) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { Aviso(lectura.aviso ?: "No se pudo cargar la flota", Tono.ERROR); Boton("Reintentar", Modifier.fillMaxWidth()) { onRecargar() } }; return }
    val estados = listOf(null, "disponible", "arrendado", "reservado", "mantencion")
    val nombres = listOf("Todos", "Disponibles", "Arrendados", "Reservados", "En mantención")
    val filtro = q.uppercase().filter { it.isLetterOrDigit() }
    val vista = lista.filter { (estados[seg] == null || it.estado == estados[seg]) && (filtro.isBlank() || it.patente.contains(filtro) || "${it.marca} ${it.modelo}".uppercase().filter { ch -> ch.isLetterOrDigit() }.contains(filtro)) }
    var abierto by remember { mutableStateOf<Long?>(null) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (lectura.aviso != null) item { Aviso(lectura.aviso, Tono.AVISO) }
        item { Busqueda(q, { q = it }, "Buscar patente o modelo") }
        item { Segmentos(nombres.mapIndexed { i, n -> n to lista.count { estados[i] == null || it.estado == estados[i] } }, seg) { seg = it } }
        if (vista.isEmpty()) item { Vacio("No hay vehículos con ese filtro.") }
        items(vista, key = { it.id }) { v -> TarjetaVehiculo(v, abierto == v.id, puedeIncidente, { abierto = if (abierto == v.id) null else v.id }, onReserva, onIncidente) }
    }
}

@Composable
fun TarjetaVehiculo(v: Vehiculo, abierto: Boolean, puedeIncidente: Boolean, onClick: () -> Unit, onReserva: (Long) -> Unit, onIncidente: (Vehiculo) -> Unit) {
    val gps = v.gpsActualizadoEn != null
    val km = v.gpsKm ?: v.km
    val comb = v.gpsCombustible ?: v.combustibleNivel
    Tarjeta(onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Pat(v.patente); Spacer(Modifier.width(8.dp))
            Txt(listOfNotNull(v.marca, v.modelo, v.anio?.toString()).joinToString(" "), Modifier.weight(1f), size = 15.sp, peso = FontWeight.SemiBold, lineas = 1)
            Chip(Formatos.ESTADOS_VEHICULO[v.estado] ?: v.estado, tonoVehiculo(v.estado))
        }
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            PuntoGps(gps); Spacer(Modifier.width(6.dp))
            Muted(if (gps) "Plataforma GPS · ${Formatos.hace(Formatos.minutosDesde(v.gpsActualizadoEn))}" else if (v.gpsUnidadId != null) "Plataforma GPS · sin lectura" else "Registro manual", size = 12.sp)
        }
        Spacer(Modifier.height(4.dp))
        Row(verticalAlignment = Alignment.Bottom) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.Bottom) {
                    Mono(if (km == null) Formatos.SIN_DATO else Formatos.miles(km), size = 22.sp, peso = FontWeight.Bold)
                    if (km != null) { Spacer(Modifier.width(4.dp)); Muted("km", size = 13.sp) }
                }
                if (km == null) Muted("sin dato", size = 12.sp)
            }
            Column(Modifier.width(130.dp)) {
                Row { Muted("Combustible", Modifier.weight(1f), size = 12.sp); Mono(Formatos.octavos(comb), size = 13.sp, peso = FontWeight.Bold) }
                Spacer(Modifier.height(4.dp))
                NivelCombustible(comb, alto = 9.dp)
            }
        }
        val vencen = v.vencimientos.filter { it.dias != null && it.dias!! <= 30 }
        if (v.reservaFolio != null || (v.danosActivos ?: 0) > 0 || vencen.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                v.reservaFolio?.let { Chip("En arriendo · $it", if (v.atrasado == true) Tono.ERROR else Tono.INFO) }
                if ((v.danosActivos ?: 0) > 0) Chip("${v.danosActivos} daño(s)", Tono.AVISO)
                vencen.forEach { Chip("${it.nombre}: ${if (it.dias!! < 0) "vencido" else "vence ${Formatos.fecha(it.fecha)}"}", if (it.dias!! < 0) Tono.ERROR else Tono.AVISO) }
            }
        }
        if (abierto) {
            Spacer(Modifier.height(10.dp))
            FilaDato("Categoría", v.categoria ?: Formatos.SIN_DATO)
            FilaDato("Sucursal", v.sucursal ?: Formatos.SIN_DATO)
            FilaDato("Próxima reserva", v.proximaFolio?.let { "$it · ${Formatos.fechaHora(v.proximaInicio)}" } ?: "Sin reservas")
            v.vencimientos.forEach { FilaDato(it.nombre, Formatos.fecha(it.fecha), mono = true, colorValor = if ((it.dias ?: 99) < 0) c.rojo else c.tinta) }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                v.reservaId?.let { id -> Boton("Ver arriendo", Modifier.weight(1f), alto = 44.dp) { onReserva(id) } }
                if (puedeIncidente) Boton("Reportar incidente", Modifier.weight(1f), alto = 44.dp) { onIncidente(v) }
            }
        }
    }
}

// ── Incidentes ──
@Composable
fun ListaIncidentes(
    lectura: Lectura<cl.siguelogps.onrent.core.ListaIncidentes>?, locales: List<cl.siguelogps.onrent.datos.Pendiente>, puedeEditar: Boolean,
    onNuevo: () -> Unit, onAbrir: (Incidente) -> Unit, onCola: () -> Unit, onRecargar: () -> Unit,
) {
    var seg by rememberSaveable { mutableStateOf(0) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (puedeEditar) item { Boton("Reportar incidente", Modifier.fillMaxWidth(), TipoBoton.PRIMARIO, icono = { IconoCamara(c.sobreMarca) }) { onNuevo() } }
        items(locales.filter { it.tipo == "incidente" && it.estado != "enviado" }, key = { it.uuid }) { p ->
            Tarjeta(onClick = onCola) {
                Row(verticalAlignment = Alignment.CenterVertically) { Txt(p.titulo, Modifier.weight(1f), size = 15.sp, peso = FontWeight.SemiBold); Chip(if (p.estado == "error") "Con error" else "Por subir", if (p.estado == "error") Tono.ERROR else Tono.AVISO) }
                if (p.error != null) { Spacer(Modifier.height(4.dp)); Txt(p.error, color = c.rojo, size = 13.sp) }
            }
        }
        if (lectura == null) { item { Cargando() }; return@LazyColumn }
        val l = lectura.datos
        if (l == null) { item { Aviso(lectura.aviso ?: "No se pudieron cargar los incidentes", Tono.ERROR) }; item { Boton("Reintentar", Modifier.fillMaxWidth()) { onRecargar() } }; return@LazyColumn }
        if (lectura.aviso != null) item { Aviso(lectura.aviso, Tono.AVISO) }
        val abiertos = l.incidentes.filter { it.estado !in setOf("cerrado", "anulado") }
        item { Segmentos(listOf("Abiertos" to abiertos.size, "Todos" to l.incidentes.size), seg) { seg = it } }
        val vista = if (seg == 0) abiertos else l.incidentes
        if (vista.isEmpty()) item { Vacio(if (seg == 0) "No hay incidentes abiertos." else "Todavía no hay incidentes.") }
        items(vista, key = { it.id }) { i ->
            Tarjeta(onClick = { onAbrir(i) }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Mono(i.folio, size = 14.sp, peso = FontWeight.Bold); Spacer(Modifier.width(8.dp))
                    Chip(Patio.ESTADOS_INCIDENTE[i.estado] ?: i.estado, tonoIncidente(i.estado)); Spacer(Modifier.weight(1f))
                    Pat(i.patente)
                }
                Spacer(Modifier.height(8.dp))
                Txt("${Patio.TIPOS_INCIDENTE[i.tipo] ?: i.tipo}${i.reservaFolio?.let { " · reserva $it" } ?: ""}", size = 15.sp, peso = FontWeight.SemiBold)
                Muted(i.descripcion ?: Formatos.SIN_DATO, size = 14.sp, lineas = 2)
                Spacer(Modifier.height(6.dp))
                Muted("${Formatos.fechaHora(i.creadoEn)}${i.clienteNombre?.let { " · $it" } ?: ""}", size = 12.sp, lineas = 1)
            }
        }
    }
}

// ── Más ──
@Composable
fun ContenidoMas(yo: Yo?, porSubir: Int, conError: Int, version: String, onCola: () -> Unit, onWeb: (String) -> Unit, onEliminar: () -> Unit, onSalir: () -> Unit) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (yo != null) item {
            Tarjeta {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(42.dp).clip(CircleShape).background(c.marca), contentAlignment = Alignment.Center) {
                        Txt(yo.usuario.nombre.split(" ").mapNotNull { it.firstOrNull()?.uppercase() }.take(2).joinToString(""), color = c.sobreMarca, size = 15.sp, peso = FontWeight.Bold)
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Txt(yo.usuario.nombre, size = 16.sp, peso = FontWeight.SemiBold, lineas = 1)
                        Muted("${yo.usuario.rolNombre ?: yo.usuario.rol} · ${yo.empresa?.nombre ?: Formatos.SIN_DATO}", size = 13.sp, lineas = 1)
                    }
                }
                if (yo.empresa?.marchaBlanca == true) { Spacer(Modifier.height(10.dp)); Aviso("Marcha blanca: los correos, WhatsApp y cobros quedan retenidos hasta que la empresa la termine.", Tono.AVISO) }
            }
        }
        item {
            Tarjeta(onClick = onCola) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Txt("Envíos del teléfono", size = 15.sp, peso = FontWeight.SemiBold)
                        Muted(if (conError > 0) "$conError con error · revisar" else if (porSubir > 0) "$porSubir por subir" else "✓ Todo al día", size = 13.sp)
                    }
                    Txt("›", color = c.gris, size = 20.sp)
                }
            }
        }
        item { Spacer(Modifier.height(4.dp)); Titulo("EN EL COMPUTADOR") }
        item { Muted("Estos módulos se usan en la pantalla grande: se abren en el navegador (↗). Ingresa con tu misma cuenta.", size = 13.sp) }
        val mods = yo?.let { Web.disponibles(it) }.orEmpty()
        item {
            Tarjeta(relleno = PaddingValues(horizontal = 14.dp, vertical = 4.dp)) {
                if (mods.isEmpty()) Muted("Tu rol no tiene otros módulos.", Modifier.padding(vertical = 10.dp))
                mods.forEachIndexed { i, m ->
                    Row(Modifier.fillMaxWidth().clickable(role = Role.Button) { onWeb(m.ruta) }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Txt(m.nombre, size = 15.sp, peso = FontWeight.Medium); Muted(m.detalle, size = 12.sp) }
                        Txt("↗", color = c.tinta2, size = 18.sp, peso = FontWeight.SemiBold)
                    }
                    if (i < mods.size - 1) Box(Modifier.fillMaxWidth().height(1.dp).background(c.linea2))
                }
            }
        }
        item { Spacer(Modifier.height(4.dp)); Titulo("CUENTA") }
        item {
            Tarjeta(relleno = PaddingValues(horizontal = 14.dp, vertical = 4.dp)) {
                FilaEnlace("Política de privacidad") { onWeb(Web.PRIVACIDAD) }
                FilaEnlace("Soporte") { onWeb(Web.SOPORTE) }
                FilaEnlace("Eliminar mi cuenta", c.rojo, onEliminar)
            }
        }
        item { Boton("Cerrar sesión", Modifier.fillMaxWidth()) { onSalir() } }
        item { Muted("Síguelo On Rent · versión $version", Modifier.fillMaxWidth().padding(top = 6.dp), size = 12.sp) }
    }
}

@Composable
fun FilaEnlace(texto: String, color: Color = c.tinta, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Txt(texto, Modifier.weight(1f), color = color, size = 15.sp, peso = FontWeight.Medium); Txt("›", color = c.gris, size = 18.sp)
    }
}
