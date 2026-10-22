// Cola de envío de la app: la entrega/devolución y los incidentes se guardan completos en el teléfono y se suben
// cuando hay señal, paso a paso. Cada paso deja anotado su avance, así un corte a la mitad sigue donde quedó.
// Idempotencia: los pasos que crean algo (un daño, el cierre de la inspección, un incidente) mandan «Idempotency-Key»
// con un UUID fijo de ese elemento; el servidor devuelve la misma respuesta si el envío se repite. Las fotos se
// guardan por posición (subir dos veces la misma posición la reemplaza) y «iniciar» devuelve la inspección existente.
package cl.siguelogps.onrent.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File
import java.util.Base64

@Serializable data class FotoPendiente(
    val posicion: String,
    val ruta: String,
    val tomadaEn: String,
    val lat: Double? = null,
    val lng: Double? = null,
    val subida: Boolean = false,
)

@Serializable data class DanoPendiente(
    val uuid: String,
    val vista: String,
    val x: Double,
    val y: Double,
    val tipo: String,
    val descripcion: String? = null,
    val fotoRuta: String? = null,
    val servidorId: Long? = null,
)

/** Todo lo de una entrega o devolución hecha en el teléfono, listo para subir. */
@Serializable data class EnvioInspeccion(
    val uuid: String,
    val reservaId: Long,
    val folio: String,
    val patente: String? = null,
    val tipo: String,
    val km: Long,
    val combustible: Int,
    val kmGps: Long? = null,
    val combustibleGps: Int? = null,
    val checklist: Checklist = Checklist(),
    val observaciones: String? = null,
    val firmante: String,
    val firmaRuta: String,
    val lat: Double? = null,
    val lng: Double? = null,
    val fotos: List<FotoPendiente> = emptyList(),
    val danos: List<DanoPendiente> = emptyList(),
    val inspeccionId: Long? = null,
    val borradorListo: Boolean = false,
    val completada: Boolean = false,
    /** Folios de los incidentes que creó el servidor al recibir con daños nuevos. */
    val incidentes: List<String> = emptyList(),
) {
    val pasosTotales: Int get() = 3 + fotos.size + danos.size
    val pasosHechos: Int get() = (if (inspeccionId != null) 1 else 0) + (if (borradorListo) 1 else 0) + fotos.count { it.subida } + danos.count { it.servidorId != null } + (if (completada) 1 else 0)
}

@Serializable data class EnvioIncidente(
    val uuid: String,
    val tipo: String,
    val patente: String? = null,
    val reservaId: Long? = null,
    val descripcion: String,
    val fotos: List<String> = emptyList(),
    val folio: String? = null,
)

/** Cómo terminó un intento de subida. */
sealed interface Vuelta {
    data object Listo : Vuelta
    /** Sin señal o el servidor no respondió: se reintenta más tarde. */
    data object Red : Vuelta
    /** La sesión terminó: queda guardado y se sube al volver a ingresar. */
    data object Sesion : Vuelta
    /** El servidor lo rechazó (p. ej. la reserva ya no está para entregar): no sirve reintentar; se muestra el motivo. */
    data class Rechazo(val mensaje: String) : Vuelta
}

object Clasificar {
    fun respuesta(r: RespuestaEnvio): Vuelta? {
        val s = r.status ?: return Vuelta.Red
        if (s in 200..299) return null
        if (s == 401) return Vuelta.Sesion
        if (s == 409 && r.cuerpo?.contains("en_proceso") == true) return Vuelta.Red
        if (s == 408 || s == 429 || s >= 500) return Vuelta.Red
        val msg = runCatching { JsonOnRent.decodeFromString(ErrorApi.serializer(), r.cuerpo.orEmpty()).error }.getOrNull()
        return Vuelta.Rechazo(msg?.takeIf { it.isNotBlank() } ?: "El servidor rechazó el envío (error $s)")
    }

    /** Espera antes del siguiente intento (WorkManager usa algo parecido): 30 s, 1 min, 2 min… hasta 1 h. */
    fun espera(intento: Int): Long = (30_000L shl intento.coerceIn(0, 7)).coerceAtMost(3_600_000L)
}

fun dataUrl(ruta: String, mime: String): String? {
    val f = File(ruta)
    if (!f.exists()) return null
    return "data:$mime;base64," + Base64.getEncoder().encodeToString(f.readBytes())
}
private fun mimeDe(ruta: String) = if (ruta.endsWith(".png", true)) "image/png" else "image/jpeg"

/**
 * Sube una entrega o devolución paso a paso. [guardar] se llama después de cada paso que avanza (para persistir el
 * avance en la base local). Devuelve cómo terminó y el envío con su avance.
 */
class SubidaInspeccion(private val api: ApiOnRent, private val guardar: suspend (EnvioInspeccion) -> Unit) {
    suspend fun subir(inicial: EnvioInspeccion): Pair<Vuelta, EnvioInspeccion> {
        var e = inicial
        if (e.completada) return Vuelta.Listo to e

        if (e.inspeccionId == null) {
            val r = api.enviar("POST", "/patio/reservas/${e.reservaId}/iniciar", "{}")
            Clasificar.respuesta(r)?.let { return it to e }
            val est = runCatching { JsonOnRent.decodeFromString(EstadoPatio.serializer(), r.cuerpo.orEmpty()) }.getOrNull()
                ?: return Vuelta.Red to e
            val insp = est.inspeccion ?: return Vuelta.Rechazo("El servidor no abrió la inspección") to e
            if (insp.tipo != e.tipo) return Vuelta.Rechazo("La reserva ${e.folio} ya no está para ${if (e.tipo == "entrega") "entregar" else "recibir"}.") to e
            if (insp.estado == "completa") return Vuelta.Rechazo("La ${if (e.tipo == "entrega") "entrega" else "devolución"} de ${e.folio} ya la registró otra persona.") to e
            e = e.copy(inspeccionId = insp.id); guardar(e)
        }
        val id = e.inspeccionId!!

        if (!e.borradorListo) {
            val cuerpo = buildJsonObject {
                put("km", e.km); put("combustible", e.combustible)
                put("km_gps", e.kmGps?.let { JsonPrimitive(it) } ?: JsonNull)
                put("combustible_gps", e.combustibleGps?.let { JsonPrimitive(it) } ?: JsonNull)
                put("checklist", e.checklist.aJson())
                put("observaciones", e.observaciones ?: "")
                put("firmante_nombre", e.firmante)
            }
            val r = api.enviar("PUT", "/patio/inspecciones/$id", cuerpo.toString())
            Clasificar.respuesta(r)?.let { return it to e }
            e = e.copy(borradorListo = true); guardar(e)
        }

        for (f in e.fotos) {
            if (f.subida) continue
            val datos = dataUrl(f.ruta, mimeDe(f.ruta)) ?: return Vuelta.Rechazo("Se perdió la foto «${Patio.nombrePosicion(f.posicion)}» del teléfono: tómala de nuevo.") to e
            val cuerpo = buildJsonObject {
                put("posicion", f.posicion); put("dataUrl", datos); put("tomada_en", f.tomadaEn)
                put("lat", f.lat?.let { JsonPrimitive(it) } ?: JsonNull); put("lng", f.lng?.let { JsonPrimitive(it) } ?: JsonNull)
            }
            val r = api.enviar("POST", "/patio/inspecciones/$id/fotos", cuerpo.toString())
            Clasificar.respuesta(r)?.let { return it to e }
            e = e.copy(fotos = e.fotos.map { if (it.posicion == f.posicion) it.copy(subida = true) else it }); guardar(e)
        }

        for (d in e.danos) {
            if (d.servidorId != null) continue
            val cuerpo = buildJsonObject {
                put("vista", d.vista); put("x", d.x); put("y", d.y); put("tipo", d.tipo); put("descripcion", d.descripcion ?: "")
                d.fotoRuta?.let { r -> dataUrl(r, mimeDe(r))?.let { put("dataUrl", it) } }
            }
            val r = api.enviar("POST", "/patio/inspecciones/$id/danos", cuerpo.toString(), idempotencia = d.uuid)
            Clasificar.respuesta(r)?.let { return it to e }
            val creado = runCatching { JsonOnRent.decodeFromString(Dano.serializer(), r.cuerpo.orEmpty()) }.getOrNull() ?: return Vuelta.Red to e
            e = e.copy(danos = e.danos.map { if (it.uuid == d.uuid) it.copy(servidorId = creado.id) else it }); guardar(e)
        }

        val firma = dataUrl(e.firmaRuta, "image/png") ?: return Vuelta.Rechazo("Se perdió la firma del teléfono: pide al cliente que firme de nuevo.") to e
        val cuerpo = buildJsonObject {
            put("firma", firma); put("firmante_nombre", e.firmante)
            put("lat", e.lat?.let { JsonPrimitive(it) } ?: JsonNull); put("lng", e.lng?.let { JsonPrimitive(it) } ?: JsonNull)
            put("mantencion", e.checklist.mantencion)
        }
        val r = api.enviar("POST", "/patio/inspecciones/$id/completar", cuerpo.toString(), idempotencia = e.uuid)
        Clasificar.respuesta(r)?.let { return it to e }
        val folios = runCatching {
            JsonOnRent.parseToJsonElement(r.cuerpo.orEmpty()).let { j -> ((j as kotlinx.serialization.json.JsonObject)["incidentes"] as? JsonArray)?.mapNotNull { (it as? kotlinx.serialization.json.JsonObject)?.get("folio")?.textoONulo() } }
        }.getOrNull().orEmpty()
        e = e.copy(completada = true, incidentes = folios); guardar(e)
        return Vuelta.Listo to e
    }
}

/** Sube un incidente reportado desde el teléfono (con sus fotos), con su UUID como Idempotency-Key. */
class SubidaIncidente(private val api: ApiOnRent) {
    suspend fun subir(i: EnvioIncidente): Pair<Vuelta, String?> {
        val fotos = i.fotos.mapNotNull { dataUrl(it, "image/jpeg") }
        val cuerpo = buildJsonObject {
            put("tipo", i.tipo); put("descripcion", i.descripcion)
            i.patente?.let { put("patente", it) }
            i.reservaId?.let { put("reserva_id", it) }
            put("fotos", JsonArray(fotos.map { JsonPrimitive(it) }))
        }
        val r = api.enviar("POST", "/incidentes", cuerpo.toString(), idempotencia = i.uuid)
        Clasificar.respuesta(r)?.let { return it to null }
        val folio = runCatching { JsonOnRent.decodeFromString(IncidenteCreado.serializer(), r.cuerpo.orEmpty()).folio }.getOrNull()
        return Vuelta.Listo to folio
    }
}
