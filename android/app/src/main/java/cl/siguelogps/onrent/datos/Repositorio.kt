// Todo lo que la app lee y escribe pasa por aquí. Lecturas: primero el servidor; si no hay señal, lo último guardado
// (con el aviso «sin señal»). Escrituras de terreno (entrega, devolución, incidentes): a la cola local, que sube
// WorkManager cuando hay señal, aunque la app esté cerrada. Las acciones de oficina (confirmar una reserva, generar
// un contrato, enviar el enlace de firma) necesitan señal y lo dicen.
package cl.siguelogps.onrent.datos

import android.content.Context
import android.graphics.Bitmap
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import cl.siguelogps.onrent.core.ApiOnRent
import cl.siguelogps.onrent.core.BorradorInspeccion
import cl.siguelogps.onrent.core.EnvioIncidente
import cl.siguelogps.onrent.core.EnvioInspeccion
import cl.siguelogps.onrent.core.EstadoPatio
import cl.siguelogps.onrent.core.FichaContrato
import cl.siguelogps.onrent.core.FichaIncidente
import cl.siguelogps.onrent.core.FichaReserva
import cl.siguelogps.onrent.core.JsonOnRent
import cl.siguelogps.onrent.core.ListaIncidentes
import cl.siguelogps.onrent.core.RespuestaApi
import cl.siguelogps.onrent.core.SubidaIncidente
import cl.siguelogps.onrent.core.SubidaInspeccion
import cl.siguelogps.onrent.core.Tareas
import cl.siguelogps.onrent.core.Vehiculo
import cl.siguelogps.onrent.core.VersionAndroid
import cl.siguelogps.onrent.core.Vuelta
import cl.siguelogps.onrent.core.Yo
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Resultado de una lectura: los datos (del servidor o guardados), si vienen de lo guardado y el aviso. */
data class Lectura<T>(val datos: T?, val guardado: Boolean = false, val aviso: String? = null, val cuando: Long? = null)

class Repositorio(
    private val ctx: Context,
    val api: ApiOnRent,
    private val bd: Bd,
    val sesion: Sesion,
    val fotos: Fotos,
    val ubicacion: Ubicacion,
) {
    val enLinea = MutableStateFlow(true)
    val yo = MutableStateFlow<Yo?>(null)
    val sesionVencida = MutableStateFlow(false)
    val pendientes: Flow<List<Pendiente>> = bd.pendiente().todos()
    private val subiendo = Mutex()

    init {
        api.token = sesion.token
        yo.value = sesion.yo?.let { runCatching { JsonOnRent.decodeFromString(Yo.serializer(), it) }.getOrNull() }
    }

    val conSesion: Boolean get() = !sesion.token.isNullOrBlank()

    // ── Sesión ──
    /** Devuelve null si entró, o el mensaje de error. */
    suspend fun ingresar(correo: String, clave: String): String? {
        if (correo.isBlank() || clave.isBlank()) return "Escribe tu correo y tu clave."
        return when (val r = api.ingresar(correo, clave)) {
            is RespuestaApi.SinRed -> "Sin señal: para ingresar la primera vez hace falta conexión."
            is RespuestaApi.Error -> r.mensaje
            is RespuestaApi.Ok -> {
                val token = r.datos.token ?: return "El servidor no entregó la sesión de la app. Actualiza la app."
                api.token = token
                sesion.token = token
                sesion.correo = correo.trim().lowercase()
                sesionVencida.value = false
                when (val y = api.yo()) {
                    is RespuestaApi.Ok -> {
                        if (y.datos.siguelo && y.datos.empresa == null) {
                            salirLocal()
                            return "El equipo Síguelo entra desde la web (backoffice). En la app se ingresa con un usuario de la empresa."
                        }
                        guardarYo(y.datos)
                    }
                    else -> { salirLocal(); return "No se pudo leer tu usuario. Inténtalo de nuevo." }
                }
                programarSubida()
                null
            }
        }
    }

    private fun guardarYo(y: Yo) { yo.value = y; sesion.yo = JsonOnRent.encodeToString(Yo.serializer(), y) }

    suspend fun actualizarYo() {
        when (val r = api.yo()) {
            is RespuestaApi.Ok -> guardarYo(r.datos)
            is RespuestaApi.Error -> if (r.status == 401) sesionVencida.value = true
            else -> Unit
        }
    }

    suspend fun cantidadSinEnviar() = bd.pendiente().sinEnviar()

    /** Cierra la sesión. La cola sin enviar se descarta solo si [descartarCola] (se pregunta antes en pantalla). */
    suspend fun salir(descartarCola: Boolean) {
        sesion.fcm?.let { runCatching { api.borrarDispositivo(it) } }
        runCatching { api.salir() }
        if (descartarCola) bd.pendiente().porEnviar().forEach { bd.pendiente().borrar(it.uuid) }
        salirLocal()
    }

    private suspend fun salirLocal() {
        api.token = null
        sesion.cerrar()
        yo.value = null
        bd.guardado().borrarTodo()
    }

    suspend fun eliminarCuenta(clave: String): String? = when (val r = api.eliminarCuenta(clave)) {
        is RespuestaApi.Ok -> { salirLocal(); null }
        is RespuestaApi.SinRed -> "Sin señal: para eliminar la cuenta hace falta conexión."
        is RespuestaApi.Error -> r.mensaje
    }

    // ── Lecturas con respaldo local ──
    private suspend fun <T> leer(clave: String, ser: KSerializer<T>, pedir: suspend () -> RespuestaApi<T>): Lectura<T> {
        val r = pedir()
        val guardado = bd.guardado().leer(clave)
        fun local() = guardado?.let { runCatching { JsonOnRent.decodeFromString(ser, it.json) }.getOrNull() }
        return when (r) {
            is RespuestaApi.Ok -> {
                enLinea.value = true
                bd.guardado().guardar(Guardado(clave, JsonOnRent.encodeToString(ser, r.datos), System.currentTimeMillis()))
                Lectura(r.datos)
            }
            is RespuestaApi.SinRed -> { enLinea.value = false; Lectura(local(), true, "Sin señal · se muestra lo guardado", guardado?.actualizado) }
            is RespuestaApi.Error -> {
                if (r.status == 401) sesionVencida.value = true
                Lectura(local(), guardado != null, r.mensaje, guardado?.actualizado)
            }
        }
    }

    suspend fun agenda() = leer("agenda", Tareas.serializer()) { api.tareas() }
    suspend fun flota() = leer("flota", ListSerializer(Vehiculo.serializer())) { api.vehiculos() }
    suspend fun reserva(id: Long) = leer("reserva:$id", FichaReserva.serializer()) { api.reserva(id) }
    suspend fun contrato(id: Long) = leer("contrato:$id", FichaContrato.serializer()) { api.contrato(id) }
    suspend fun incidentes() = leer("incidentes", ListaIncidentes.serializer()) { api.incidentes() }
    suspend fun incidente(id: Long) = leer("incidente:$id", FichaIncidente.serializer()) { api.incidente(id) }
    suspend fun estadoPatio(reservaId: Long, tipo: String? = null) = leer("patio:$reservaId:${tipo ?: ""}", EstadoPatio.serializer()) { api.estadoPatio(reservaId, tipo) }

    suspend fun versionMinima(): VersionAndroid? = api.versionMinima().let { (it as? RespuestaApi.Ok)?.datos?.android }

    // ── Borradores de entrega y devolución ──
    private fun claveBorrador(reservaId: Long, tipo: String) = "borrador:$reservaId:$tipo"
    suspend fun borrador(reservaId: Long, tipo: String): BorradorInspeccion? =
        bd.guardado().leer(claveBorrador(reservaId, tipo))?.let { runCatching { JsonOnRent.decodeFromString(BorradorInspeccion.serializer(), it.json) }.getOrNull() }
    suspend fun guardarBorrador(b: BorradorInspeccion) =
        bd.guardado().guardar(Guardado(claveBorrador(b.reservaId, b.tipo), JsonOnRent.encodeToString(BorradorInspeccion.serializer(), b), System.currentTimeMillis()))
    suspend fun descartarBorrador(b: BorradorInspeccion) {
        b.fotos.forEach { fotos.borrar(it.ruta) }; b.danos.forEach { fotos.borrar(it.fotoRuta) }
        bd.guardado().borrar(claveBorrador(b.reservaId, b.tipo))
    }
    fun nuevoUuid() = UUID.randomUUID().toString()

    /** Firma: el borrador pasa a la cola con la firma y la ubicación, y se sube apenas haya señal. */
    suspend fun firmarYEncolar(b: BorradorInspeccion, e: EstadoPatio, firma: Bitmap): EnvioInspeccion {
        val ruta = fotos.guardarFirma(firma)
        val pos = ubicacion.leer(6_000).pos
        val envio = b.aEnvio(e.reserva.folio, e.reserva.patente, ruta, pos?.lat, pos?.lng)
        val titulo = "${if (b.esEntrega) "Entrega" else "Devolución"} ${e.reserva.folio}"
        bd.pendiente().guardar(Pendiente(envio.uuid, "inspeccion", titulo, JsonOnRent.encodeToString(EnvioInspeccion.serializer(), envio), reservaId = e.reserva.id))
        bd.guardado().borrar(claveBorrador(b.reservaId, b.tipo))
        programarSubida()
        return envio
    }

    suspend fun encolarIncidente(i: EnvioIncidente) {
        val titulo = "Incidente ${i.patente?.let { cl.siguelogps.onrent.core.Formatos.patente(it) } ?: ""}".trim()
        bd.pendiente().guardar(Pendiente(i.uuid, "incidente", titulo, JsonOnRent.encodeToString(EnvioIncidente.serializer(), i), reservaId = i.reservaId))
        programarSubida()
    }

    suspend fun reintentar(uuid: String) {
        bd.pendiente().leer(uuid)?.let { bd.pendiente().guardar(it.copy(estado = "por_enviar", error = null, actualizado = System.currentTimeMillis())) }
        programarSubida()
    }

    suspend fun descartar(uuid: String) = bd.pendiente().borrar(uuid)

    /** Sube la cola en orden. Lo usa el trabajo de WorkManager. */
    suspend fun subir(): Vuelta = subiendo.withLock {
        if (!conSesion) return Vuelta.Sesion
        for (p in bd.pendiente().porEnviar()) {
            val v = when (p.tipo) {
                "inspeccion" -> {
                    val envio = JsonOnRent.decodeFromString(EnvioInspeccion.serializer(), p.json)
                    val (v, fin) = SubidaInspeccion(api) { avance -> bd.pendiente().guardar(p.copy(json = JsonOnRent.encodeToString(EnvioInspeccion.serializer(), avance), actualizado = System.currentTimeMillis())) }.subir(envio)
                    if (v == Vuelta.Listo) {
                        bd.pendiente().guardar(p.copy(json = JsonOnRent.encodeToString(EnvioInspeccion.serializer(), fin), estado = "enviado", resultado = fin.incidentes.takeIf { it.isNotEmpty() }?.let { "Se creó ${it.joinToString(", ")}" }, actualizado = System.currentTimeMillis()))
                        (fin.fotos.map { it.ruta } + fin.danos.mapNotNull { it.fotoRuta } + fin.firmaRuta).forEach { fotos.borrar(it) }
                    }
                    v
                }
                "incidente" -> {
                    val i = JsonOnRent.decodeFromString(EnvioIncidente.serializer(), p.json)
                    val (v, folio) = SubidaIncidente(api).subir(i)
                    if (v == Vuelta.Listo) {
                        bd.pendiente().guardar(p.copy(estado = "enviado", resultado = folio?.let { "Quedó como $it" }, actualizado = System.currentTimeMillis()))
                        i.fotos.forEach { fotos.borrar(it) }
                    }
                    v
                }
                else -> Vuelta.Listo
            }
            when (v) {
                Vuelta.Listo -> Unit
                is Vuelta.Rechazo -> bd.pendiente().leer(p.uuid)?.let { bd.pendiente().guardar(it.copy(estado = "error", error = v.mensaje, actualizado = System.currentTimeMillis())) }
                Vuelta.Sesion -> { sesionVencida.value = true; return Vuelta.Sesion }
                Vuelta.Red -> { enLinea.value = false; return Vuelta.Red }
            }
        }
        bd.pendiente().limpiarEnviados(System.currentTimeMillis() - 3 * 86_400_000L)
        Vuelta.Listo
    }

    fun programarSubida() {
        val pedido = OneTimeWorkRequestBuilder<SubidaWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        runCatching { WorkManager.getInstance(ctx).enqueueUniqueWork("subida", ExistingWorkPolicy.KEEP, pedido) }
    }

    // ── Acciones de oficina (con señal) ──
    suspend fun cambiarEstadoReserva(id: Long, estado: String, motivo: String?) = api.cambiarEstadoReserva(id, estado, motivo)
    suspend fun generarContrato(reservaId: Long) = api.generarContrato(reservaId)
    suspend fun enviarEnlaceFirma(contratoId: Long) = api.enviarEnlaceFirma(contratoId)
    suspend fun reenviarContrato(contratoId: Long) = api.reenviarContrato(contratoId)

    /** Descarga el PDF del contrato a la caché de la app (se abre con «Compartir / Abrir con»). */
    suspend fun pdfContrato(id: Long, folio: String): Pair<File?, String?> {
        val f = File(File(ctx.cacheDir, "documentos").apply { mkdirs() }, "Contrato-$folio.pdf")
        val error = api.descargar("/contratos/$id/pdf", f)
        return if (error == null) f to null else null to error
    }
}
