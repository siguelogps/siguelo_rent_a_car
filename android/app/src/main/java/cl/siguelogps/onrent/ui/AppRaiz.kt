// Raíz de la app: elige la pantalla según la ruta, carga sus datos (servidor o lo guardado) y conecta los botones.
package cl.siguelogps.onrent.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import cl.siguelogps.onrent.Config
import cl.siguelogps.onrent.core.FichaReserva
import cl.siguelogps.onrent.core.Formatos
import cl.siguelogps.onrent.core.JsonOnRent
import cl.siguelogps.onrent.core.Vehiculo
import cl.siguelogps.onrent.datos.Lectura
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun AppRaiz(vm: AppViewModel, camara: @Composable () -> Unit, actualizarApp: () -> Unit, llamar: (String) -> Unit) {
    val e by vm.estado.collectAsStateWithLifecycle()
    val yo by vm.yo.collectAsStateWithLifecycle()
    val enLinea by vm.enLinea.collectAsStateWithLifecycle()
    val pendientes by vm.pendientes.collectAsStateWithLifecycle()
    val version by vm.version.collectAsStateWithLifecycle()
    val trabajando by vm.trabajando.collectAsStateWithLifecycle()
    val porSubir = pendientes.count { it.estado == "por_enviar" }
    val conError = pendientes.count { it.estado == "error" }
    val reservasPorSubir = pendientes.filter { it.estado == "por_enviar" && it.tipo == "inspeccion" }.mapNotNull { it.reservaId }.toSet()

    Box(Modifier.fillMaxSize().background(c.fondo)) {
        if (e.camara != null) { camara(); return@Box }
        when (val r = e.ruta) {
            Ruta.Ingreso -> {
                val cargando by vm.ingresando.collectAsStateWithLifecycle()
                val error by vm.errorIngreso.collectAsStateWithLifecycle()
                PantallaIngreso(vm.repo.sesion.correo, cargando, error, vm::ingresar, vm::abrirWeb)
            }
            is Ruta.Actualizar -> PantallaActualizar(r.mensaje, actualizarApp)
            is Ruta.Principal -> {
                var salir by remember { mutableStateOf(false) }
                Column(Modifier.fillMaxSize()) {
                    CabeceraPrincipal(when (r.pestana) { Pestana.AGENDA -> "Entregas y devoluciones"; Pestana.FLOTA -> "Vehículos"; Pestana.INCIDENTES -> "Incidentes"; Pestana.MAS -> "Más" }, yo?.empresa?.nombre)
                    BarraCola(porSubir, conError, enLinea) { vm.ir(Ruta.Cola) }
                    Box(Modifier.weight(1f)) {
                        when (r.pestana) {
                            Pestana.AGENDA -> {
                                val l by produceState<Lectura<cl.siguelogps.onrent.core.Tareas>?>(null, version) { value = vm.repo.agenda() }
                                val borradores by produceState(emptySet<Long>(), version) { value = l?.datos?.let { t -> (t.entregas + t.devoluciones).filter { x -> vm.repo.borrador(x.id, if (x.estado == "confirmada") "entrega" else "devolucion") != null }.map { it.id }.toSet() } ?: emptySet() }
                                ContenidoAgenda(l, yo?.puede("patio") != false, reservasPorSubir, borradores,
                                    onTarea = { t, tipo -> if (tipo == "devolucion" && t.estado != "en_curso") vm.ir(Ruta.VerInspeccion(t.id, "devolucion")) else if (t.id in reservasPorSubir) vm.ir(Ruta.Cola) else vm.abrirAsistente(t.id, tipo) },
                                    onReserva = { vm.ir(Ruta.Reserva(it)) }, onRecargar = { vm.version.value++ })
                            }
                            Pestana.FLOTA -> {
                                val l by produceState<Lectura<List<Vehiculo>>?>(null, version) { value = vm.repo.flota() }
                                ContenidoFlota(l, yo?.puede("incidentes", "editar") == true, { vm.version.value++ }, { vm.ir(Ruta.Reserva(it)) }, { v -> vm.abrirNuevoIncidente(v.patente) })
                            }
                            Pestana.INCIDENTES -> {
                                val l by produceState<Lectura<cl.siguelogps.onrent.core.ListaIncidentes>?>(null, version) { value = vm.repo.incidentes() }
                                if (yo?.puede("incidentes") == false) Column(Modifier.padding(16.dp)) { Vacio("Tu rol no tiene acceso a Incidentes y daños.") }
                                else ListaIncidentes(l, pendientes, yo?.puede("incidentes", "editar") == true, { vm.abrirNuevoIncidente() }, { vm.ir(Ruta.Incidente(it.id)) }, { vm.ir(Ruta.Cola) }, { vm.version.value++ })
                            }
                            Pestana.MAS -> ContenidoMas(yo, porSubir, conError, Config.version, { vm.ir(Ruta.Cola) }, vm::abrirWeb, { vm.ir(Ruta.EliminarCuenta) }, { salir = true })
                        }
                    }
                    BarraPestanas(r.pestana, conError, vm::pestana)
                }
                if (salir) {
                    val sinEnviar = porSubir + conError
                    AlertDialog(onDismissRequest = { salir = false }, containerColor = c.tarjeta,
                        title = { Txt("¿Cerrar sesión?", size = 18.sp, peso = FontWeight.SemiBold) },
                        text = { Txt(if (sinEnviar > 0) "Hay $sinEnviar envío(s) sin subir en este teléfono. Si cierras la sesión, se pierden. Espera a tener señal para que se suban." else "Para volver a entrar necesitarás tu correo y tu clave.") },
                        confirmButton = { TextButton({ salir = false; vm.salir(descartarCola = true) }) { Txt(if (sinEnviar > 0) "Cerrar y perderlos" else "Cerrar sesión", color = c.rojo, peso = FontWeight.SemiBold) } },
                        dismissButton = { TextButton({ salir = false }) { Txt("Volver", color = c.gris) } })
                }
            }
            is Ruta.Reserva -> {
                val l by produceState<Lectura<FichaReserva>?>(null, r.id, version) { value = vm.repo.reserva(r.id) }
                val f = l?.datos
                PantallaReserva(l, yo?.puede("patio", "editar") == true, yo?.puede("reservas", "editar") == true, yo?.puede("contratos") == true, yo?.puede("incidentes", "editar") == true,
                    r.id in reservasPorSubir, trabajando, { vm.atras() }, AccionesReserva(
                        entregar = { tipo -> vm.abrirAsistente(r.id, tipo) },
                        verInspeccion = { tipo -> vm.ir(Ruta.VerInspeccion(r.id, tipo)) },
                        cambiarEstado = { est -> vm.accion("Cambiar el estado", { _ -> "Reserva actualizada" }, { vm.repo.cambiarEstadoReserva(r.id, est, null) }) },
                        generarContrato = { vm.accion("Generar contrato", { c -> "Contrato ${c.folio} generado" }, { vm.repo.generarContrato(r.id) }) { c -> vm.ir(Ruta.Contrato(c.id)) } },
                        abrirContrato = { vm.ir(Ruta.Contrato(it)) },
                        incidente = { vm.abrirNuevoIncidente(f?.vehiculo?.patente, r.id, f?.reserva?.folio) },
                        llamar = llamar,
                        web = { vm.abrirWeb("/reservas/${r.id}") },
                    ))
            }
            is Ruta.Contrato -> {
                val l by produceState<Lectura<cl.siguelogps.onrent.core.FichaContrato>?>(null, r.id, version) { value = vm.repo.contrato(r.id) }
                val f = l?.datos
                PantallaContrato(l, yo?.puede("contratos", "editar") == true, trabajando, { vm.atras() }, AccionesContrato(
                    pdf = { f?.let { vm.descargarContrato(it.contrato.id, it.contrato.folio, false) } },
                    compartir = { f?.let { vm.descargarContrato(it.contrato.id, it.contrato.folio, true) } },
                    enviarEnlace = { vm.accion("Enviar el enlace", { s -> if (s.salidas.any { it.estado == "retenida" }) "Enlace preparado (marcha blanca: queda retenido)" else "Enlace de firma enviado" }, { vm.repo.enviarEnlaceFirma(r.id) }) },
                    reenviar = { vm.accion("Reenviar", { _ -> "Contrato reenviado al cliente" }, { vm.repo.reenviarContrato(r.id) }) },
                    reserva = { vm.ir(Ruta.Reserva(it)) },
                    web = { vm.abrirWeb("/contratos/${r.id}") },
                ))
            }
            is Ruta.Asistente -> {
                val a by vm.asistente.collectAsStateWithLifecycle()
                val hoja by vm.danoHoja.collectAsStateWithLifecycle()
                val firma = remember(r) { EstadoFirma() }
                val x = a
                if (x == null) Column(Modifier.fillMaxSize()) { Cabecera("Preparando…", "Volver", { vm.atras() }); Cargando() }
                else {
                    PantallaAsistente(x.estado, x.borrador, x.enviando, AccionesAsistente(
                        paso = { n -> if (n > 1 && !x.borrador.confirmado) vm.avisar("Confirma el kilometraje y el combustible", true) else vm.irPaso(n) },
                        cambiar = vm::cambiarBorrador,
                        camara = { vm.camara(it) },
                        marcarDano = vm::nuevoDano,
                        editarDano = vm::editarDano,
                        firmar = { f, nombre ->
                            if (f.puntos < 8) vm.avisar("Falta la firma del cliente", true)
                            else vm.firmar(f.aBitmap(), nombre)
                        },
                        volver = { vm.atras() },
                        descartar = { vm.descartarAsistente() },
                    ), firma)
                    hoja?.let { d ->
                        val nuevo = x.borrador.danos.none { it.uuid == d.uuid }
                        HojaDano(d, x.borrador.esEntrega, nuevo, { vm.danoHoja.value = it }, { vm.camara(DestinoFoto.Dano) }, vm::guardarDano, { vm.borrarDano(d) }, { vm.danoHoja.value = null })
                    }
                }
            }
            is Ruta.VerInspeccion -> {
                val l by produceState<Lectura<cl.siguelogps.onrent.core.EstadoPatio>?>(null, r) { value = vm.repo.estadoPatio(r.reservaId, r.tipo) }
                PantallaVerInspeccion(l, { vm.atras() }, { vm.abrirWeb("/patio/${r.reservaId}") })
            }
            is Ruta.Incidente -> {
                val l by produceState<Lectura<cl.siguelogps.onrent.core.FichaIncidente>?>(null, r.id) { value = vm.repo.incidente(r.id) }
                PantallaIncidente(l, { vm.atras() }, { vm.ir(Ruta.Reserva(it)) }, { vm.abrirWeb("/incidentes/${r.id}") })
            }
            Ruta.NuevoIncidente -> {
                val i by vm.incidenteNuevo.collectAsStateWithLifecycle()
                val flota by produceState(emptyList<Vehiculo>()) { value = vm.repo.flota().datos.orEmpty() }
                i?.let { b -> PantallaNuevoIncidente(b, flota, { vm.incidenteNuevo.value = it }, { vm.camara(DestinoFoto.Incidente) }, { ruta -> vm.repo.fotos.borrar(ruta); vm.incidenteNuevo.value = b.copy(fotos = b.fotos - ruta) }, vm::enviarIncidente, { vm.atras() }) }
            }
            Ruta.Cola -> PantallaCola(pendientes, enLinea, { vm.atras() }, vm::reintentar, vm::descartar)
            Ruta.EliminarCuenta -> {
                val eliminando by vm.eliminando.collectAsStateWithLifecycle()
                PantallaEliminarCuenta(eliminando, { vm.atras() }, vm::eliminarCuenta, { vm.abrirWeb("/privacidad#eliminar-cuenta") })
            }
        }
        e.aviso?.let { texto ->
            LaunchedEffect(texto) { delay(if (e.avisoError) 6000 else 4000); vm.cerrarAviso() }
            Box(Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(start = 16.dp, end = 16.dp, bottom = 84.dp).fillMaxWidth()
                .clip(RoundedCornerShape(10.dp)).background(if (e.avisoError) Color(0xFF7A1A12) else Color(0xFF2B323C)).clickable { vm.cerrarAviso() }.padding(14.dp)) {
                Txt(texto, color = Color.White, size = 14.sp)
            }
        }
    }
}
