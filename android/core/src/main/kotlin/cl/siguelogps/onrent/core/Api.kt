// Cliente de la API de Síguelo On Rent (/api/…). La sesión es el token Bearer que entrega POST /api/ingresar con
// { nativa: true }; el servidor saca la empresa y el usuario de ese token, nunca de lo que mande el teléfono.
// Los errores que se muestran son los que escribe el servidor (en español, sin nombrar proveedores); sin red se dice
// «Sin señal» y la app sigue con lo guardado.
package cl.siguelogps.onrent.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

sealed interface RespuestaApi<out T> {
    data class Ok<T>(val datos: T) : RespuestaApi<T>
    data class SinRed(val mensaje: String = "Sin señal") : RespuestaApi<Nothing>
    data class Error(val status: Int, val mensaje: String, val campo: String? = null) : RespuestaApi<Nothing>
}

fun <T> RespuestaApi<T>.datosONulo(): T? = (this as? RespuestaApi.Ok)?.datos

/** Respuesta cruda: status null = no hubo conexión. */
data class RespuestaEnvio(val status: Int? = null, val cuerpo: String? = null, val error: String? = null)

class ApiOnRent(
    /** Dirección del servidor, p. ej. https://onrent.siguelogps.com (sin la barra final). */
    val baseUrl: String,
    private val agente: String = "SigueloOnRent-Android",
    cliente: OkHttpClient? = null,
) {
    private val api = baseUrl.trimEnd('/') + "/api"
    val http: OkHttpClient = cliente ?: OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS) // una foto puede tardar en subir con poca señal
        .build()
    private val tipoJson = "application/json; charset=utf-8".toMediaType()

    /** Token de la sesión: lo pone la app al entrar y lo saca al salir. */
    @Volatile var token: String? = null

    /** Envío crudo (lo usa la cola): status y cuerpo tal cual, o el error de red. */
    suspend fun enviar(metodo: String, ruta: String, cuerpo: String? = null, idempotencia: String? = null): RespuestaEnvio = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(api + ruta)
            .header("Accept", "application/json")
            .header("User-Agent", agente)
            .apply {
                token?.takeIf { it.isNotBlank() }?.let { header("Authorization", "Bearer $it") }
                if (!idempotencia.isNullOrBlank()) header("Idempotency-Key", idempotencia)
                when (metodo) {
                    "GET" -> get()
                    else -> method(metodo, (cuerpo ?: "{}").toRequestBody(tipoJson))
                }
            }.build()
        try {
            http.newCall(req).execute().use { r -> RespuestaEnvio(status = r.code, cuerpo = r.body?.string()) }
        } catch (e: IOException) {
            RespuestaEnvio(error = e.message ?: "Sin conexión")
        }
    }

    fun <T> interpretar(r: RespuestaEnvio, ser: KSerializer<T>): RespuestaApi<T> {
        val status = r.status ?: return RespuestaApi.SinRed()
        val texto = r.cuerpo.orEmpty()
        if (status in 200..299) {
            return try { RespuestaApi.Ok(JsonOnRent.decodeFromString(ser, texto)) } catch (e: Exception) {
                RespuestaApi.Error(status, "La respuesta del servidor no se pudo leer. Actualiza la app.")
            }
        }
        val err = runCatching { JsonOnRent.decodeFromString(ErrorApi.serializer(), texto) }.getOrNull()
        val mensaje = err?.error?.takeIf { it.isNotBlank() } ?: when (status) {
            401 -> "Tu sesión terminó. Vuelve a ingresar."
            403 -> "Tu rol no tiene permiso para esta acción."
            404 -> "No encontrado"
            in 500..599 -> "El servidor no está disponible. Inténtalo en un rato."
            else -> "Error $status"
        }
        return RespuestaApi.Error(status, mensaje, err?.campo)
    }

    suspend fun <T> pedir(metodo: String, ruta: String, cuerpo: JsonObject?, ser: KSerializer<T>, idempotencia: String? = null): RespuestaApi<T> =
        interpretar(enviar(metodo, ruta, cuerpo?.toString(), idempotencia), ser)

    // ── Sesión ──
    suspend fun ingresar(correo: String, clave: String) =
        pedir("POST", "/ingresar", buildJsonObject { put("correo", correo.trim().lowercase()); put("clave", clave); put("nativa", true) }, Ingreso.serializer())
    suspend fun yo() = pedir("GET", "/yo", null, Yo.serializer())
    suspend fun salir() = enviar("POST", "/salir", "{}")
    suspend fun eliminarCuenta(clave: String) = pedir("POST", "/configuracion/eliminar-mi-cuenta", buildJsonObject { put("clave", clave) }, Ingreso.serializer())

    // ── Lectura ──
    suspend fun tareas(q: String? = null) = pedir("GET", "/patio/tareas" + (q?.takeIf { it.isNotBlank() }?.let { "?q=" + URLEncoder.encode(it, "UTF-8") } ?: ""), null, Tareas.serializer())
    suspend fun estadoPatio(reservaId: Long, tipo: String? = null) = pedir("GET", "/patio/reservas/$reservaId" + (tipo?.let { "?tipo=$it" } ?: ""), null, EstadoPatio.serializer())
    suspend fun vehiculos() = pedir("GET", "/vehiculos", null, kotlinx.serialization.builtins.ListSerializer(Vehiculo.serializer()))
    suspend fun reserva(id: Long) = pedir("GET", "/reservas/$id", null, FichaReserva.serializer())
    suspend fun contrato(id: Long) = pedir("GET", "/contratos/$id", null, FichaContrato.serializer())
    suspend fun incidentes() = pedir("GET", "/incidentes", null, ListaIncidentes.serializer())
    suspend fun incidente(id: Long) = pedir("GET", "/incidentes/$id", null, FichaIncidente.serializer())
    suspend fun versionMinima() = pedir("GET", "/app/version-minima", null, VersionMinima.serializer())

    // ── Acciones (con señal) ──
    suspend fun cambiarEstadoReserva(id: Long, estado: String, motivo: String? = null) =
        pedir("POST", "/reservas/$id/estado", buildJsonObject { put("estado", estado); motivo?.let { put("motivo", it) } }, ReservaDatos.serializer())
    suspend fun generarContrato(reservaId: Long) = pedir("POST", "/reservas/$reservaId/contrato", buildJsonObject { }, ContratoNuevo.serializer())
    suspend fun enviarEnlaceFirma(contratoId: Long, canal: String = "ambos") = pedir("POST", "/contratos/$contratoId/enviar-enlace", buildJsonObject { put("canal", canal) }, RespuestaSalidas.serializer())
    suspend fun reenviarContrato(contratoId: Long) = pedir("POST", "/contratos/$contratoId/reenviar", buildJsonObject { }, RespuestaSalidas.serializer())
    suspend fun registrarDispositivo(fcm: String, version: String) = enviar("POST", "/app/dispositivo",
        buildJsonObject { put("token", fcm); put("plataforma", "android"); put("version_app", version) }.toString())
    suspend fun borrarDispositivo(fcm: String) = enviar("DELETE", "/app/dispositivo", buildJsonObject { put("token", fcm) }.toString())

    /**
     * Descarga un archivo con la sesión (PDF del contrato, foto) a [destino]. Devuelve null si salió bien o el mensaje
     * del error. Como descargar() de la web: nunca una URL pública, siempre con la sesión.
     */
    suspend fun descargar(ruta: String, destino: File): String? = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(api + ruta).header("User-Agent", agente)
            .apply { token?.let { header("Authorization", "Bearer $it") } }.build()
        try {
            http.newCall(req).execute().use { r ->
                if (!r.isSuccessful) return@withContext interpretar(RespuestaEnvio(r.code, r.body?.string()), Ingreso.serializer()).let { (it as? RespuestaApi.Error)?.mensaje ?: "No se pudo descargar" }
                destino.parentFile?.mkdirs()
                r.body?.byteStream()?.use { e -> destino.outputStream().use { s -> e.copyTo(s) } }
                null
            }
        } catch (e: IOException) { "Sin señal: no se pudo descargar" }
    }

    /** Dirección web de una página del sistema, para «Abrir en el navegador». */
    fun web(ruta: String) = baseUrl.trimEnd('/') + ruta
}
