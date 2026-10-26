// Pantallas de apoyo: inspección ya hecha (solo lectura), incidente (ficha y reporte nuevo con fotos), envíos del
// teléfono, eliminar la cuenta y «Actualiza la app».
package cl.siguelogps.onrent.ui

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cl.siguelogps.onrent.core.Checklist
import cl.siguelogps.onrent.core.EnvioIncidente
import cl.siguelogps.onrent.core.EnvioInspeccion
import cl.siguelogps.onrent.core.EstadoPatio
import cl.siguelogps.onrent.core.FichaIncidente
import cl.siguelogps.onrent.core.Formatos
import cl.siguelogps.onrent.core.JsonOnRent
import cl.siguelogps.onrent.core.Patio
import cl.siguelogps.onrent.core.Vehiculo
import cl.siguelogps.onrent.datos.Lectura
import cl.siguelogps.onrent.datos.Pendiente

// ── Inspección hecha (lectura) ──
@Composable
fun PantallaVerInspeccion(lectura: Lectura<EstadoPatio>?, onVolver: () -> Unit, onWeb: () -> Unit) {
    val e = lectura?.datos
    Column(Modifier.fillMaxSize().background(c.fondo)) {
        Cabecera(if (e?.tipo == "entrega") "Entrega registrada" else "Devolución registrada", e?.reserva?.folio ?: "Volver", onVolver, e?.reserva?.patente)
        if (lectura == null) { Cargando(); return@Column }
        if (e == null) { Column(Modifier.padding(16.dp)) { Aviso(lectura.aviso ?: "No se pudo cargar", Tono.ERROR) }; return@Column }
        val i = e.inspeccion
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (lectura.aviso != null) Aviso(lectura.aviso, Tono.AVISO)
            if (i == null) { Vacio("Esta ${if (e.tipo == "entrega") "entrega" else "devolución"} no se registró en el sistema."); return@Column }
            Tarjeta {
                FilaDato("Estado", if (i.estado == "completa") "Completa" else "Empezada (sin firmar)")
                FilaDato("Km", Formatos.km(i.km), mono = true)
                FilaDato("Combustible", Formatos.octavos(i.combustible), mono = true)
                FilaDato("Fecha", Formatos.fechaHora(i.completadoEn), mono = true)
                i.firmanteNombre?.let { FilaDato("Firmó", it) }
                FilaDato("Checklist", "${Checklist.desde(i.checklist).contar()} de ${Checklist.ITEMS.size}")
                i.observaciones?.let { FilaDato("Observaciones", it) }
            }
            val ent = e.entrega
            val kmD = i.km; val kmE = ent?.km
            if (e.tipo == "devolucion" && ent != null) Tarjeta {
                Titulo("COMPARACIÓN CON LA ENTREGA")
                FilaDato("Km recorridos", if (kmD != null && kmE != null) "+${Formatos.miles(kmD - kmE)}" else Formatos.SIN_DATO, mono = true)
                FilaDato("Combustible", "${Formatos.octavos(ent.combustible)} → ${Formatos.octavos(i.combustible)}", mono = true)
                FilaDato("Daños nuevos", "${e.danosNuevos.size}")
            }
            Titulo("FOTOS · ${e.fotos.size}")
            e.fotos.chunked(3).forEach { fila ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    fila.forEach { f -> Box(Modifier.weight(1f).aspectRatio(1.25f).clip(RoundedCornerShape(10.dp))) { ImagenLlena(null, f.archivoId, Patio.nombrePosicion(f.posicion)) } }
                    repeat(3 - fila.size) { Spacer(Modifier.weight(1f)) }
                }
            }
            if (e.danosPrevios.isNotEmpty() || e.danosNuevos.isNotEmpty()) {
                var n = 0
                Tarjeta(relleno = PaddingValues(8.dp)) { Esquema((e.danosPrevios.map { MarcaDano(it.x, it.y, ++n, it.tipo, false, "p${it.id}") } + e.danosNuevos.map { MarcaDano(it.x, it.y, ++n, it.tipo, e.tipo == "devolucion", "s${it.id}") }), editable = false) }
            }
            Enlace("Ver la comparación completa en el navegador ↗") { onWeb() }
        }
    }
}

// ── Incidente ──
@Composable
fun PantallaIncidente(lectura: Lectura<FichaIncidente>?, onVolver: () -> Unit, onReserva: (Long) -> Unit, onWeb: () -> Unit) {
    val f = lectura?.datos
    Column(Modifier.fillMaxSize().background(c.fondo)) {
        Cabecera(f?.folio?.let { "Incidente $it" } ?: "Incidente", "Volver", onVolver, f?.patente)
        if (lectura == null) { Cargando(); return@Column }
        if (f == null) { Column(Modifier.padding(16.dp)) { Aviso(lectura.aviso ?: "No se pudo cargar el incidente", Tono.ERROR) }; return@Column }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (lectura.aviso != null) Aviso(lectura.aviso, Tono.AVISO)
            Row { Chip(Patio.ESTADOS_INCIDENTE[f.estado] ?: f.estado, tonoIncidente(f.estado)); Spacer(Modifier.width(6.dp)); Chip(Patio.TIPOS_INCIDENTE[f.tipo] ?: f.tipo) }
            Tarjeta {
                Txt(f.descripcion ?: Formatos.SIN_DATO, size = 15.sp)
                Spacer(Modifier.height(8.dp))
                FilaDato("Vehículo", listOfNotNull(f.marca, f.modelo).joinToString(" ").ifBlank { Formatos.SIN_DATO })
                FilaDato("Cliente", f.clienteNombre ?: Formatos.SIN_DATO)
                FilaDato("Reserva", f.reservaFolio ?: Formatos.SIN_DATO, mono = true)
                FilaDato("Reportado", Formatos.fechaHora(f.creadoEn), mono = true)
                FilaDato("Presupuesto", Formatos.clp(f.presupuesto), mono = true)
                FilaDato("Deducible", Formatos.clp(f.deducible), mono = true)
                FilaDato("Monto al cliente", Formatos.clp(f.montoCliente), mono = true)
            }
            val fotos = f.adjuntos.filter { it.mime?.startsWith("image/") == true }
            if (fotos.isNotEmpty()) {
                Titulo("FOTOS · ${fotos.size}")
                fotos.chunked(3).forEach { fila -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { fila.forEach { a -> Box(Modifier.weight(1f).aspectRatio(1f).clip(RoundedCornerShape(10.dp))) { ImagenLlena(null, a.id, a.nombre ?: "Foto") } }; repeat(3 - fila.size) { Spacer(Modifier.weight(1f)) } } }
            }
            if (f.eventos.isNotEmpty()) Tarjeta {
                Titulo("SEGUIMIENTO")
                f.eventos.forEach { ev -> Column(Modifier.padding(vertical = 6.dp)) { Txt(ev.detalle ?: ev.tipo.orEmpty(), size = 14.sp); Muted("${Formatos.fechaHora(ev.creadoEn)}${ev.usuario?.let { " · $it" } ?: ""}", size = 12.sp) } }
            }
            f.reservaId?.let { id -> Boton("Ver reserva ${f.reservaFolio ?: ""}".trim(), Modifier.fillMaxWidth()) { onReserva(id) } }
            Muted("El presupuesto, el cobro al cliente y el seguro se gestionan en el computador.", size = 13.sp)
            Enlace("Abrir el incidente en el navegador ↗") { onWeb() }
        }
    }
}

@Composable
fun PantallaNuevoIncidente(i: IncidenteBorrador, flota: List<Vehiculo>, onCambio: (IncidenteBorrador) -> Unit, onFoto: () -> Unit, onQuitarFoto: (String) -> Unit, onEnviar: () -> Unit, onVolver: () -> Unit) {
    Column(Modifier.fillMaxSize().background(c.fondo).imePadding()) {
        Cabecera("Reportar incidente", "Volver", onVolver, i.patente.ifBlank { null })
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Titulo("TIPO")
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Patio.TIPOS_INCIDENTE.entries.take(3).forEach { (k, t) -> OpcionTipo(t, k == i.tipo, Modifier.weight(1f)) { onCambio(i.copy(tipo = k)) } }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Patio.TIPOS_INCIDENTE.entries.drop(3).forEach { (k, t) -> OpcionTipo(t, k == i.tipo, Modifier.weight(1f)) { onCambio(i.copy(tipo = k)) } }
                Spacer(Modifier.weight(1f))
            }
            if (i.reservaFolio != null) Aviso("Reserva ${i.reservaFolio} · el incidente queda asociado al arriendo y al cliente.", Tono.INFO)
            else {
                Campo(Formatos.patente(i.patente).takeIf { i.patente.isNotBlank() } ?: i.patente, { onCambio(i.copy(patente = it.uppercase().filter { ch -> ch.isLetterOrDigit() }.take(8))) }, etiqueta = "Patente", ayuda = "PBVX-61", mono = true)
                val q = i.patente.uppercase()
                val sugeridas = if (q.length >= 2) flota.filter { it.patente.contains(q) && it.patente != q }.take(4) else emptyList()
                if (sugeridas.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { sugeridas.forEach { v -> Box(Modifier.clickable { onCambio(i.copy(patente = v.patente)) }) { Pat(v.patente) } } }
            }
            Campo(i.descripcion, { onCambio(i.copy(descripcion = it.take(2000))) }, etiqueta = "¿Qué pasó?", ayuda = "Describe lo ocurrido, dónde y cuándo", lineas = 4)
            Titulo("FOTOS · ${i.fotos.size} de 8")
            i.fotos.chunked(3).forEach { fila ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    fila.forEach { r -> Box(Modifier.weight(1f).aspectRatio(1f).clip(RoundedCornerShape(10.dp))) { ImagenLlena(r, null, "Foto"); Box(Modifier.align(Alignment.TopEnd).padding(4.dp).clip(RoundedCornerShape(6.dp)).background(c.tarjeta).clickable { onQuitarFoto(r) }.padding(horizontal = 6.dp)) { Txt("✕", size = 13.sp) } } }
                    repeat(3 - fila.size) { Spacer(Modifier.weight(1f)) }
                }
            }
            if (i.fotos.size < 8) Boton("Agregar foto", Modifier.fillMaxWidth(), icono = { IconoCamara() }) { onFoto() }
            Muted("Sin señal también se puede reportar: queda guardado en el teléfono y se sube solo.", size = 13.sp)
        }
        Pie { Boton("Enviar reporte", Modifier.weight(1f), TipoBoton.PRIMARIO) { onEnviar() } }
    }
}

@Composable
private fun OpcionTipo(t: String, sel: Boolean, modifier: Modifier, onClick: () -> Unit) =
    Box(modifier.clip(RoundedCornerShape(8.dp)).background(if (sel) c.tinta else c.tarjeta).clickable(role = Role.RadioButton, onClick = onClick).padding(vertical = 11.dp), contentAlignment = Alignment.Center) {
        Txt(t, color = if (sel) c.fondo else c.tinta, size = 13.sp, peso = FontWeight.SemiBold, lineas = 1)
    }

// ── Envíos del teléfono (la cola) ──
@Composable
fun PantallaCola(lista: List<Pendiente>, enLinea: Boolean, onVolver: () -> Unit, onReintentar: (String) -> Unit, onDescartar: (String) -> Unit) {
    var descartar by remember { mutableStateOf<Pendiente?>(null) }
    Column(Modifier.fillMaxSize().background(c.fondo)) {
        Cabecera("Envíos del teléfono", "Volver", onVolver)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Muted(if (enLinea) "Las entregas, devoluciones e incidentes hechos en el teléfono se suben solos, en orden, aunque cierres la app." else "Sin señal: lo pendiente se sube solo cuando vuelva la señal, aunque la app esté cerrada.", size = 13.sp)
            if (lista.isEmpty()) Vacio("No hay envíos. Todo está al día.")
            lista.forEach { p ->
                val avance = if (p.tipo == "inspeccion") runCatching { JsonOnRent.decodeFromString(EnvioInspeccion.serializer(), p.json) }.getOrNull() else null
                val nFotos = if (p.tipo == "incidente") runCatching { JsonOnRent.decodeFromString(EnvioIncidente.serializer(), p.json).fotos.size }.getOrNull() else null
                Tarjeta {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Txt(p.titulo, Modifier.weight(1f), size = 15.sp, peso = FontWeight.SemiBold)
                        when (p.estado) { "enviado" -> Chip("✓ Enviado", Tono.OK); "error" -> Chip("Con error", Tono.ERROR); else -> Chip("Por subir", Tono.AVISO) }
                    }
                    Muted("Hecho el ${Formatos.sello(p.creado).dropLast(3)}", size = 12.sp)
                    if (avance != null && p.estado != "enviado") Muted("Avance: ${avance.pasosHechos} de ${avance.pasosTotales} partes (${avance.fotos.size} fotos, ${avance.danos.size} daño(s), firma)", size = 12.sp)
                    if (nFotos != null && p.estado != "enviado") Muted("$nFotos foto(s)", size = 12.sp)
                    p.resultado?.let { Txt(it, color = c.verde, size = 13.sp) }
                    p.error?.let { Spacer(Modifier.height(4.dp)); Txt(it, color = c.rojo, size = 13.sp) }
                    if (p.estado == "error") {
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Boton("Reintentar", Modifier.weight(1f), alto = 42.dp) { onReintentar(p.uuid) }
                            Boton("Descartar", Modifier.weight(1f), TipoBoton.PELIGRO, alto = 42.dp) { descartar = p }
                        }
                    }
                }
            }
        }
    }
    descartar?.let { p ->
        androidx.compose.material3.AlertDialog(onDismissRequest = { descartar = null }, containerColor = c.tarjeta,
            title = { Txt("¿Descartar «${p.titulo}»?", size = 18.sp, peso = FontWeight.SemiBold) },
            text = { Txt("Lo que no se alcanzó a subir se pierde. Hazlo solo si ya se registró de otra forma.") },
            confirmButton = { androidx.compose.material3.TextButton({ descartar = null; onDescartar(p.uuid) }) { Txt("Descartar", color = c.rojo, peso = FontWeight.SemiBold) } },
            dismissButton = { androidx.compose.material3.TextButton({ descartar = null }) { Txt("Volver", color = c.gris) } })
    }
}

// ── Eliminar mi cuenta (exigido por Google Play) ──
@Composable
fun PantallaEliminarCuenta(eliminando: Boolean, onVolver: () -> Unit, onEliminar: (String) -> Unit, onWeb: () -> Unit) {
    var clave by remember { mutableStateOf("") }
    var seguro by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(c.fondo).imePadding()) {
        Cabecera("Eliminar mi cuenta", "Volver", onVolver)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Txt("Al eliminar tu cuenta:", size = 15.sp, peso = FontWeight.SemiBold)
            Txt("• Se borran tu nombre, correo, teléfono y clave, y se cierran todas tus sesiones.\n• Las reservas, contratos e inspecciones que registraste quedan en la empresa (son registros del arriendo), sin tus datos personales.\n• No se puede deshacer. Para volver a usar el sistema, el administrador de tu empresa tiene que crearte un usuario nuevo.", color = c.tinta2, size = 14.sp, alto = 21.sp)
            Aviso("Si eres el único administrador de la empresa, antes deja a otra persona como administradora (Configuración → Usuarios).", Tono.AVISO)
            Campo(clave, { clave = it }, etiqueta = "Escribe tu clave para confirmar", teclado = KeyboardType.Password, clave = true)
            Row(Modifier.clickable { seguro = !seguro }, verticalAlignment = Alignment.CenterVertically) { CajaCheck(seguro); Spacer(Modifier.width(10.dp)); Txt("Entiendo que no se puede deshacer", size = 14.sp) }
            Boton("Eliminar mi cuenta", Modifier.fillMaxWidth(), TipoBoton.PELIGRO, habilitado = seguro && clave.isNotBlank(), cargando = eliminando) { onEliminar(clave) }
            Enlace("Ver la política de privacidad ↗") { onWeb() }
        }
    }
}

// ── Actualiza la app (versión mínima) ──
@Composable
fun PantallaActualizar(mensaje: String?, onActualizar: () -> Unit) {
    Column(Modifier.fillMaxSize().background(c.cabecera).statusBarsPadding().navigationBarsPadding().padding(24.dp), verticalArrangement = Arrangement.Center) {
        MarcaOnRent(apilado = true)
        Spacer(Modifier.height(24.dp))
        Txt("Actualiza la app", color = c.sobreCabecera, size = 28.sp, peso = FontWeight.Bold)
        Spacer(Modifier.height(10.dp))
        Txt(mensaje ?: "Hay una versión nueva de Síguelo On Rent que es necesaria para seguir trabajando.", color = c.cabeceraTenue, size = 16.sp, alto = 23.sp)
        Spacer(Modifier.height(10.dp))
        Txt("Lo que está guardado en el teléfono no se pierde: se sube después de actualizar.", color = c.cabeceraTenue, size = 14.sp)
        Spacer(Modifier.height(28.dp))
        Boton("Actualizar desde Google Play", Modifier.fillMaxWidth(), TipoBoton.PRIMARIO) { onActualizar() }
    }
}
