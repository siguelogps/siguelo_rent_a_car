// Ficha de la reserva y del contrato: lo que hace falta en el mesón o en el patio, con las acciones clave
// (entregar/recibir, confirmar, cancelar, generar el contrato, enviar el enlace de firma, abrir el PDF).
// Lo demás de la reserva (editar fechas, cobros, liquidación) se abre en el navegador.
package cl.siguelogps.onrent.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cl.siguelogps.onrent.core.FichaContrato
import cl.siguelogps.onrent.core.FichaReserva
import cl.siguelogps.onrent.core.Formatos
import cl.siguelogps.onrent.datos.Lectura

data class AccionesReserva(
    val entregar: (String) -> Unit = {},
    val verInspeccion: (String) -> Unit = {},
    val cambiarEstado: (String) -> Unit = {},
    val generarContrato: () -> Unit = {},
    val abrirContrato: (Long) -> Unit = {},
    val incidente: () -> Unit = {},
    val llamar: (String) -> Unit = {},
    val web: () -> Unit = {},
)

@Composable
fun PantallaReserva(
    lectura: Lectura<FichaReserva>?, puedePatio: Boolean, puedeReservas: Boolean, puedeContratos: Boolean, puedeIncidentes: Boolean,
    porSubir: Boolean, trabajando: Boolean, onVolver: () -> Unit, a: AccionesReserva,
) {
    val f = lectura?.datos
    val r = f?.reserva
    Column(Modifier.fillMaxSize().background(c.fondo)) {
        Cabecera(r?.let { "Reserva ${it.folio}" } ?: "Reserva", "Volver", onVolver, f?.vehiculo?.patente)
        if (lectura == null) { Cargando(); return@Column }
        if (f == null || r == null) { Column(Modifier.padding(16.dp)) { Aviso(lectura.aviso ?: "No se pudo cargar la reserva", Tono.ERROR) }; return@Column }
        var confirmar by remember { mutableStateOf<String?>(null) }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (lectura.aviso != null) Aviso(lectura.aviso, Tono.AVISO)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Chip(Formatos.ESTADOS_RESERVA[r.estado] ?: r.estado, tonoReserva(r.estado))
                if (porSubir) { Spacer(Modifier.width(6.dp)); Chip("Entrega/devolución por subir", Tono.AVISO) }
            }
            // Acción principal según el estado (como Entregas y devoluciones de la web).
            if (puedePatio && !porSubir) when (r.estado) {
                "confirmada" -> Boton("Iniciar entrega", Modifier.fillMaxWidth(), TipoBoton.PRIMARIO) { a.entregar("entrega") }
                "en_curso" -> Boton("Recibir vehículo", Modifier.fillMaxWidth(), TipoBoton.PRIMARIO) { a.entregar("devolucion") }
                "devuelta", "cerrada" -> Boton("Ver entrega y devolución", Modifier.fillMaxWidth()) { a.verInspeccion("devolucion") }
            }
            Tarjeta {
                Titulo("CLIENTE")
                Spacer(Modifier.height(4.dp))
                Txt(f.cliente?.nombreCompleto?.ifBlank { null } ?: Formatos.SIN_DATO, size = 17.sp, peso = FontWeight.SemiBold)
                Mono(Formatos.documento(f.cliente?.documentoTipo, f.cliente?.documento), color = c.gris, size = 13.sp)
                f.cliente?.telefono?.let { tel -> Spacer(Modifier.height(8.dp)); Boton("Llamar · $tel", Modifier.fillMaxWidth(), alto = 42.dp) { a.llamar(tel) } }
            }
            Tarjeta {
                Titulo("ARRIENDO")
                FilaDato("Vehículo", f.vehiculo?.let { listOfNotNull(it.marca, it.modelo, it.anio?.toString()).joinToString(" ") } ?: "Sin asignar")
                FilaDato("Retiro", Formatos.fechaHora(r.inicio), mono = true)
                FilaDato("Sucursal de retiro", f.sucursalRetiro?.nombre ?: Formatos.SIN_DATO)
                FilaDato("Devolución", Formatos.fechaHora(r.fin), mono = true)
                FilaDato("Sucursal de devolución", f.sucursalDevolucion?.nombre ?: Formatos.SIN_DATO)
                r.retiroReal?.let { FilaDato("Entregado", Formatos.fechaHora(it), mono = true) }
                r.devolucionReal?.let { FilaDato("Recibido", Formatos.fechaHora(it), mono = true) }
                FilaDato("Kilometraje", r.kmIncluidos?.let { "${Formatos.miles(it)} km incluidos" } ?: "Libre")
                FilaDato("Total", Formatos.clp(r.total), mono = true)
                FilaDato("Garantía", Formatos.clp(r.garantia), mono = true)
            }
            f.gps?.let { g ->
                Tarjeta {
                    Row(verticalAlignment = Alignment.CenterVertically) { PuntoGps(g.esGps); Spacer(Modifier.width(6.dp)); Muted(if (g.esGps) "Plataforma GPS · ${Formatos.hace(Formatos.minutosDesde(g.actualizadoEn))}" else "Registro manual", size = 12.sp) }
                    FilaDato("Kilometraje", Formatos.km(g.km), mono = true)
                    FilaDato("Combustible", Formatos.octavos(g.combustible), mono = true)
                }
            }
            if (puedeContratos) Tarjeta {
                Titulo("CONTRATO")
                Spacer(Modifier.height(4.dp))
                val vigentes = f.contratos.filter { it.estado != "anulado" }
                if (vigentes.isEmpty()) {
                    Muted("Todavía no hay contrato.")
                    if (r.estado in setOf("confirmada", "en_curso")) { Spacer(Modifier.height(8.dp)); Boton("Generar contrato", Modifier.fillMaxWidth(), cargando = trabajando, alto = 44.dp) { a.generarContrato() } }
                }
                vigentes.forEach { ct ->
                    Tarjeta(onClick = { a.abrirContrato(ct.id) }, relleno = androidx.compose.foundation.layout.PaddingValues(12.dp), fondo = c.suave) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Mono(ct.folio, size = 14.sp, peso = FontWeight.Bold); Spacer(Modifier.width(8.dp))
                            Chip(Formatos.ESTADOS_CONTRATO[ct.estado] ?: ct.estado, tonoContrato(ct.estado)); Spacer(Modifier.weight(1f)); Txt("›", color = c.gris, size = 20.sp)
                        }
                        ct.firmadoEn?.let { Muted("Firmado ${Formatos.fechaHora(it)}${ct.firmanteNombre?.let { n -> " por $n" } ?: ""}", size = 12.sp) }
                    }
                }
            }
            if (puedeReservas && f.transiciones.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                f.transiciones.forEach { t ->
                    Boton(Formatos.ACCIONES_RESERVA[t] ?: t, Modifier.weight(1f), if (t == "confirmada") TipoBoton.OSCURO else TipoBoton.PELIGRO, alto = 44.dp, habilitado = !trabajando) { confirmar = t }
                }
            }
            if (puedeIncidentes && f.vehiculo != null) Boton("Reportar incidente", Modifier.fillMaxWidth(), alto = 44.dp) { a.incidente() }
            Enlace("Abrir la reserva en el navegador ↗") { a.web() }
        }
        confirmar?.let { t ->
            AlertDialog(
                onDismissRequest = { confirmar = null },
                title = { Txt("${Formatos.ACCIONES_RESERVA[t]} · ${r.folio}", size = 18.sp, peso = FontWeight.SemiBold) },
                text = { Txt(when (t) { "confirmada" -> "La reserva queda confirmada y se avisa al cliente (si las comunicaciones están activas)."; "cancelada" -> "La reserva se cancela y el vehículo queda libre."; else -> "Se marca que el cliente no se presentó y el vehículo queda libre." }) },
                confirmButton = { TextButton({ confirmar = null; a.cambiarEstado(t) }) { Txt(Formatos.ACCIONES_RESERVA[t] ?: t, peso = FontWeight.SemiBold) } },
                dismissButton = { TextButton({ confirmar = null }) { Txt("Volver", color = c.gris) } },
                containerColor = c.tarjeta,
            )
        }
    }
}

data class AccionesContrato(val pdf: () -> Unit = {}, val compartir: () -> Unit = {}, val enviarEnlace: () -> Unit = {}, val reenviar: () -> Unit = {}, val reserva: (Long) -> Unit = {}, val web: () -> Unit = {})

@Composable
fun PantallaContrato(lectura: Lectura<FichaContrato>?, puedeEditar: Boolean, trabajando: Boolean, onVolver: () -> Unit, a: AccionesContrato) {
    val f = lectura?.datos
    Column(Modifier.fillMaxSize().background(c.fondo)) {
        Cabecera(f?.contrato?.folio?.let { "Contrato $it" } ?: "Contrato", "Volver", onVolver, f?.reserva?.patente)
        if (lectura == null) { Cargando(); return@Column }
        if (f == null) { Column(Modifier.padding(16.dp)) { Aviso(lectura.aviso ?: "No se pudo cargar el contrato", Tono.ERROR) }; return@Column }
        val ct = f.contrato
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (lectura.aviso != null) Aviso(lectura.aviso, Tono.AVISO)
            Chip(Formatos.ESTADOS_CONTRATO[ct.estado] ?: ct.estado, tonoContrato(ct.estado))
            Tarjeta {
                FilaDato("Cliente", f.reserva?.cliente ?: Formatos.SIN_DATO)
                FilaDato("Reserva", f.reserva?.folio ?: Formatos.SIN_DATO, mono = true)
                FilaDato("Vehículo", f.reserva?.let { listOfNotNull(it.marca, it.modelo).joinToString(" ") } ?: Formatos.SIN_DATO)
                FilaDato("Período", f.reserva?.let { "${Formatos.fecha(it.inicio)} → ${Formatos.fecha(it.fin)}" } ?: Formatos.SIN_DATO, mono = true)
                FilaDato("Total", Formatos.clp(f.reserva?.total), mono = true)
                FilaDato("Creado", Formatos.fechaHora(ct.creadoEn), mono = true)
                ct.firmadoEn?.let { FilaDato("Firmado", Formatos.fechaHora(it), mono = true) }
                ct.firmanteNombre?.let { FilaDato("Firmó", it) }
                ct.codigoVerificacion?.let { FilaDato("Código de verificación", it, mono = true) }
                ct.anuladoMotivo?.let { FilaDato("Motivo de anulación", it, colorValor = c.rojo) }
            }
            f.enlace?.vence?.let { Aviso("Enlace de firma vigente hasta el ${Formatos.fechaHora(it)}.", Tono.INFO) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Boton("Ver PDF", Modifier.weight(1f), TipoBoton.PRIMARIO, cargando = trabajando) { a.pdf() }
                Boton("Compartir", Modifier.weight(1f), habilitado = !trabajando) { a.compartir() }
            }
            if (puedeEditar && ct.estado == "pendiente_firma") Boton("Enviar enlace de firma al cliente", Modifier.fillMaxWidth(), TipoBoton.OSCURO, habilitado = !trabajando) { a.enviarEnlace() }
            if (puedeEditar && ct.estado == "firmado") Boton("Reenviar contrato firmado", Modifier.fillMaxWidth(), habilitado = !trabajando) { a.reenviar() }
            f.reserva?.let { r -> Boton("Ver reserva ${r.folio}", Modifier.fillMaxWidth()) { a.reserva(r.id) } }
            if (f.historial.isNotEmpty()) Tarjeta {
                Titulo("HISTORIAL")
                f.historial.take(8).forEach { h -> FilaDato(h.accion.replace('_', ' ').replaceFirstChar { it.uppercase() }, "${Formatos.fechaHora(h.creadoEn)}${h.usuario?.let { " · $it" } ?: ""}") }
            }
            Enlace("Abrir el contrato en el navegador ↗") { a.web() }
        }
    }
}
