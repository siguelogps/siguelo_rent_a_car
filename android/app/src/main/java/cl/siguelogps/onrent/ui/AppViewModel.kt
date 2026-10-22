// Estado de la app y lo que hace cada botón. La navegación es una pila de rutas (atrás = sacar una).
// El asistente de entrega/devolución y el incidente nuevo viven aquí, así la cámara (que es otra pantalla) les
// entrega la foto, y se guardan en el teléfono a cada toque.
package cl.siguelogps.onrent.ui

import android.app.Application
import android.graphics.Bitmap
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import cl.siguelogps.onrent.OnRentApp
import cl.siguelogps.onrent.core.BorradorInspeccion
import cl.siguelogps.onrent.core.DanoPendiente
import cl.siguelogps.onrent.core.EnvioIncidente
import cl.siguelogps.onrent.core.EstadoPatio
import cl.siguelogps.onrent.core.FotoPendiente
import cl.siguelogps.onrent.core.Formatos
import cl.siguelogps.onrent.core.Patio
import cl.siguelogps.onrent.core.RespuestaApi
import cl.siguelogps.onrent.core.Versiones
import cl.siguelogps.onrent.core.Yo
import cl.siguelogps.onrent.Config
import cl.siguelogps.onrent.datos.Pendiente
import cl.siguelogps.onrent.push.ServicioAvisos
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

sealed interface Ruta {
    data object Ingreso : Ruta
    data class Principal(val pestana: Pestana = Pestana.AGENDA) : Ruta
    data class Reserva(val id: Long) : Ruta
    data class Contrato(val id: Long) : Ruta
    data class Asistente(val reservaId: Long, val tipo: String?) : Ruta
    data class VerInspeccion(val reservaId: Long, val tipo: String) : Ruta
    data class Incidente(val id: Long) : Ruta
    data object NuevoIncidente : Ruta
    data object Cola : Ruta
    data object EliminarCuenta : Ruta
    data class Actualizar(val mensaje: String?) : Ruta
}

enum class Pestana(val titulo: String) { AGENDA("Agenda"), FLOTA("Vehículos"), INCIDENTES("Incidentes"), MAS("Más") }

/** Para quién es la foto que se está sacando. */
sealed interface DestinoFoto {
    data class Posicion(val posicion: String) : DestinoFoto
    data object Dano : DestinoFoto
    data object Incidente : DestinoFoto
}

data class AsistenteEstado(val estado: EstadoPatio, val borrador: BorradorInspeccion, val enviando: Boolean = false)

data class IncidenteBorrador(
    val uuid: String,
    val tipo: String = "dano",
    val patente: String = "",
    val reservaId: Long? = null,
    val reservaFolio: String? = null,
    val descripcion: String = "",
    val fotos: List<String> = emptyList(),
)

data class EstadoApp(
    val pila: List<Ruta> = listOf(Ruta.Ingreso),
    val aviso: String? = null,
    val avisoError: Boolean = false,
    val camara: DestinoFoto? = null,
) { val ruta: Ruta get() = pila.last() }

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val cont = (app as OnRentApp).contenedor
    val repo = cont.repo
    val imagenes get() = cont.imagenes

    private val _estado = MutableStateFlow(EstadoApp(pila = listOf(if (repo.conSesion) Ruta.Principal() else Ruta.Ingreso)))
    val estado: StateFlow<EstadoApp> = _estado.asStateFlow()
    val yo: StateFlow<Yo?> = repo.yo
    val enLinea: StateFlow<Boolean> = repo.enLinea
    val pendientes = MutableStateFlow<List<Pendiente>>(emptyList())

    val asistente = MutableStateFlow<AsistenteEstado?>(null)
    /** Daño que se está marcando o editando (hoja del daño). */
    val danoHoja = MutableStateFlow<DanoPendiente?>(null)
    val incidenteNuevo = MutableStateFlow<IncidenteBorrador?>(null)
    /** Cambia cada vez que la cola termina algo: las pantallas recargan. */
    val version = MutableStateFlow(0)

    init {
        viewModelScope.launch { repo.pendientes.collect { lista -> val antes = pendientes.value.count { it.estado == "enviado" }; pendientes.value = lista; if (lista.count { it.estado == "enviado" } != antes) version.update { it + 1 } } }
        viewModelScope.launch { repo.sesionVencida.collect { if (it && repo.conSesion) avisar("Tu sesión terminó. Vuelve a ingresar: lo que está por subir queda guardado.", true) } }
        if (repo.conSesion) alEntrar()
        revisarVersion()
    }

    // ── Navegación ──
    fun ir(r: Ruta) = _estado.update { it.copy(pila = it.pila + r) }
    fun reemplazar(r: Ruta) = _estado.update { it.copy(pila = it.pila.dropLast(1) + r) }
    fun pestana(p: Pestana) = _estado.update { it.copy(pila = listOf(Ruta.Principal(p))) }
    /** Atrás. Devuelve false si no hay a dónde volver (se cierra la app). */
    fun atras(): Boolean {
        val e = _estado.value
        if (e.camara != null) { cerrarCamara(); return true }
        if (danoHoja.value != null) { danoHoja.value = null; return true }
        if (e.pila.size <= 1) {
            val r = e.ruta
            if (r is Ruta.Principal && r.pestana != Pestana.AGENDA) { pestana(Pestana.AGENDA); return true }
            return false
        }
        if (e.ruta is Ruta.Asistente) asistente.value = null
        _estado.update { it.copy(pila = it.pila.dropLast(1)) }
        return true
    }

    fun avisar(texto: String, error: Boolean = false) = _estado.update { it.copy(aviso = texto, avisoError = error) }
    fun cerrarAviso() = _estado.update { it.copy(aviso = null) }

    /** Desde un aviso push: abrir la reserva. */
    fun abrirReserva(id: Long) { if (repo.conSesion) _estado.update { it.copy(pila = listOf(Ruta.Principal(), Ruta.Reserva(id))) } }

    fun alVolver() { if (repo.conSesion) { repo.programarSubida(); viewModelScope.launch { repo.actualizarYo() } }; revisarVersion() }

    private fun revisarVersion() = viewModelScope.launch {
        val v = repo.versionMinima() ?: return@launch
        if (Versiones.debeActualizar(Config.version, v.minima)) _estado.update { it.copy(pila = listOf(Ruta.Actualizar(v.mensaje))) }
    }

    // ── Sesión ──
    val ingresando = MutableStateFlow(false)
    val errorIngreso = MutableStateFlow<String?>(null)
    fun ingresar(correo: String, clave: String) = viewModelScope.launch {
        ingresando.value = true; errorIngreso.value = null
        val err = repo.ingresar(correo, clave)
        ingresando.value = false
        if (err != null) errorIngreso.value = err
        else { _estado.update { it.copy(pila = listOf(Ruta.Principal())) }; alEntrar() }
    }

    private fun alEntrar() = viewModelScope.launch {
        repo.actualizarYo()
        ServicioAvisos.registrarSiSePuede(getApplication())
    }

    fun salir(descartarCola: Boolean) = viewModelScope.launch {
        repo.salir(descartarCola)
        asistente.value = null
        _estado.update { EstadoApp(pila = listOf(Ruta.Ingreso)) }
    }

    val eliminando = MutableStateFlow(false)
    fun eliminarCuenta(clave: String) = viewModelScope.launch {
        eliminando.value = true
        val err = repo.eliminarCuenta(clave)
        eliminando.value = false
        if (err != null) avisar(err, true)
        else { _estado.update { EstadoApp(pila = listOf(Ruta.Ingreso)) }; avisar("Tu cuenta quedó eliminada. Gracias por usar Síguelo On Rent.") }
    }

    // ── Asistente de entrega y devolución ──
    val cargandoAsistente = MutableStateFlow(false)
    fun abrirAsistente(reservaId: Long, tipo: String?) = viewModelScope.launch {
        cargandoAsistente.value = true
        asistente.value = null
        ir(Ruta.Asistente(reservaId, tipo))
        val l = repo.estadoPatio(reservaId, tipo)
        cargandoAsistente.value = false
        val e = l.datos ?: run { avisar(l.aviso ?: "No se pudo abrir la reserva", true); atras(); return@launch }
        if (e.modo == "lectura") { reemplazar(Ruta.VerInspeccion(reservaId, e.tipo)); return@launch }
        val b = repo.borrador(reservaId, e.tipo) ?: BorradorInspeccion.nuevo(repo.nuevoUuid(), e)
        asistente.value = AsistenteEstado(e, b)
        if (l.guardado) avisar("Sin señal: trabajas con lo guardado. Todo queda en el teléfono y se sube después.")
    }

    fun cambiarBorrador(f: (BorradorInspeccion) -> BorradorInspeccion) {
        val a = asistente.value ?: return
        val b = f(a.borrador)
        asistente.value = a.copy(borrador = b)
        viewModelScope.launch { repo.guardarBorrador(b) }
    }

    fun irPaso(n: Int) = cambiarBorrador { it.copy(paso = n.coerceIn(1, 5)) }

    fun firmar(firma: Bitmap, nombre: String) {
        val a = asistente.value ?: return
        if (nombre.isBlank()) { avisar("Indica el nombre de quien firma", true); return }
        asistente.value = a.copy(enviando = true)
        viewModelScope.launch {
            val envio = repo.firmarYEncolar(a.borrador.copy(firmante = nombre.trim()), a.estado, firma)
            asistente.value = null
            val esE = a.borrador.esEntrega
            avisar(if (repo.enLinea.value) "${if (esE) "Entrega" else "Devolución"} registrada. Subiendo fotos y firma…" else "Sin señal: la ${if (esE) "entrega" else "devolución"} quedó guardada y se sube sola al volver la señal.")
            _estado.update { it.copy(pila = it.pila.dropLast(1)) }
            version.update { it + 1 }
            check(envio.uuid.isNotBlank())
        }
    }

    fun descartarAsistente() = viewModelScope.launch {
        asistente.value?.let { repo.descartarBorrador(it.borrador) }
        asistente.value = null
        atras()
    }

    // ── Cámara ──
    /** Lo pone la Activity: pide el permiso de cámara si falta y después abre la cámara. */
    var pedirCamara: ((DestinoFoto) -> Unit)? = null
    /** Desde las pantallas: pasa por el permiso. */
    fun camara(d: DestinoFoto) { pedirCamara?.invoke(d) ?: abrirCamara(d) }
    fun abrirCamara(d: DestinoFoto) = _estado.update { it.copy(camara = d) }
    fun cerrarCamara() = _estado.update { it.copy(camara = null) }

    fun fotoTomada(bmp: Bitmap, rotacion: Int) {
        val d = _estado.value.camara ?: return
        cerrarCamara()
        viewModelScope.launch {
            val pos = repo.ubicacion.leer(5_000).pos
            val a = asistente.value
            val etiqueta = when (d) {
                is DestinoFoto.Posicion -> "${if (a?.borrador?.esEntrega == true) "Entrega" else "Devolución"} ${a?.estado?.reserva?.folio.orEmpty()} · ${Patio.nombrePosicion(d.posicion)}"
                DestinoFoto.Dano -> danoHoja.value?.let { "Daño · ${Patio.zonaDano(it.vista, it.x, it.y)}" } ?: "Daño"
                DestinoFoto.Incidente -> "Incidente ${incidenteNuevo.value?.patente?.let { Formatos.patente(it) }.orEmpty()}".trim()
            }
            val ruta = withContext(Dispatchers.IO) { repo.fotos.guardar(bmp, rotacion, etiqueta, a?.estado?.sucursal?.nombre, pos) }
            val ahora = Formatos.iso(System.currentTimeMillis())
            when (d) {
                is DestinoFoto.Posicion -> cambiarBorrador { b ->
                    b.fotos.firstOrNull { it.posicion == d.posicion }?.let { repo.fotos.borrar(it.ruta) }
                    b.conFoto(FotoPendiente(d.posicion, ruta, ahora, pos?.lat, pos?.lng))
                }
                DestinoFoto.Dano -> danoHoja.value?.let { h -> h.fotoRuta?.let { repo.fotos.borrar(it) }; danoHoja.value = h.copy(fotoRuta = ruta) }
                DestinoFoto.Incidente -> incidenteNuevo.update { it?.copy(fotos = it.fotos + ruta) }
            }
        }
    }

    // ── Daños ──
    fun nuevoDano(x: Double, y: Double, tipo: String) {
        val (xa, ya) = Patio.ajustarPunto(x, y)
        danoHoja.value = DanoPendiente(repo.nuevoUuid(), Patio.vistaDe(xa, ya), xa, ya, tipo)
    }
    fun editarDano(d: DanoPendiente) { danoHoja.value = d }
    fun guardarDano(d: DanoPendiente) { cambiarBorrador { it.conDano(d) }; danoHoja.value = null }
    fun borrarDano(d: DanoPendiente) { repo.fotos.borrar(d.fotoRuta); cambiarBorrador { it.sinDano(d.uuid) }; danoHoja.value = null }

    // ── Incidente nuevo ──
    fun abrirNuevoIncidente(patente: String? = null, reservaId: Long? = null, folio: String? = null) {
        incidenteNuevo.value = IncidenteBorrador(repo.nuevoUuid(), patente = patente.orEmpty(), reservaId = reservaId, reservaFolio = folio)
        ir(Ruta.NuevoIncidente)
    }
    fun enviarIncidente() {
        val i = incidenteNuevo.value ?: return
        if (i.patente.isBlank() && i.reservaId == null) { avisar("Indica la patente del vehículo", true); return }
        if (i.descripcion.isBlank()) { avisar("Describe lo ocurrido", true); return }
        viewModelScope.launch {
            repo.encolarIncidente(EnvioIncidente(i.uuid, i.tipo, i.patente.uppercase().filter { it.isLetterOrDigit() }.ifBlank { null }, i.reservaId, i.descripcion.trim(), i.fotos))
            incidenteNuevo.value = null
            atras()
            avisar(if (repo.enLinea.value) "Incidente reportado. Subiendo…" else "Sin señal: el incidente quedó guardado y se sube solo al volver la señal.")
        }
    }

    // ── Cola ──
    fun reintentar(uuid: String) = viewModelScope.launch { repo.reintentar(uuid) }
    fun descartar(uuid: String) = viewModelScope.launch { repo.descartar(uuid) }

    // ── Acciones de oficina (con señal) ──
    val trabajando = MutableStateFlow(false)
    fun <T> accion(texto: String, ok: (T) -> String, hacer: suspend () -> RespuestaApi<T>, despues: (T) -> Unit = {}) = viewModelScope.launch {
        trabajando.value = true
        val r = hacer()
        trabajando.value = false
        when (r) {
            is RespuestaApi.Ok -> { avisar(ok(r.datos)); version.update { it + 1 }; despues(r.datos) }
            is RespuestaApi.SinRed -> avisar("Sin señal: «$texto» necesita conexión. Inténtalo de nuevo con señal.", true)
            is RespuestaApi.Error -> avisar(r.mensaje, true)
        }
    }

    fun descargarContrato(id: Long, folio: String, compartir: Boolean) = viewModelScope.launch {
        trabajando.value = true
        val (f, err) = repo.pdfContrato(id, folio)
        trabajando.value = false
        val ctx = getApplication<Application>()
        if (f == null) { avisar(err ?: "No se pudo descargar el contrato", true); return@launch }
        val ok = if (compartir) Acciones.compartirArchivo(ctx, f) else Acciones.abrirArchivo(ctx, f)
        if (!ok) avisar("No hay una app para abrir PDF en este teléfono.", true)
    }

    fun abrirWeb(ruta: String) {
        if (!Acciones.abrirWeb(getApplication(), repo.api.web(ruta))) avisar("No hay un navegador en este teléfono.", true)
    }

    val resumenCola = combine(pendientes, enLinea) { p, l -> Triple(p.count { it.estado == "por_enviar" }, p.count { it.estado == "error" }, l) }
}
