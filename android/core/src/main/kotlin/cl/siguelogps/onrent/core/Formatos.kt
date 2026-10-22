// Formatos de Chile como la web (public/comun.js): miles con punto, CLP «$12.345», fechas dd-mm-aaaa y hora de
// America/Santiago, patentes «PBVX-61». Un dato que no llegó se muestra «—» (nunca 0).
package cl.siguelogps.onrent.core

import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

object Formatos {
    val ZONA: ZoneId = ZoneId.of("America/Santiago")
    const val SIN_DATO = "—"
    private val dia = DateTimeFormatter.ofPattern("dd-MM-yyyy")
    private val hora = DateTimeFormatter.ofPattern("HH:mm")
    private val sello = DateTimeFormatter.ofPattern("dd-MM-yyyy HH:mm:ss")

    fun miles(n: Long?): String {
        if (n == null) return SIN_DATO
        val s = kotlin.math.abs(n).toString().reversed().chunked(3).joinToString(".").reversed()
        return if (n < 0) "-$s" else s
    }
    fun clp(n: Long?): String = if (n == null) SIN_DATO else (if (n < 0) "-$" else "$") + miles(kotlin.math.abs(n))
    fun octavos(n: Int?): String = if (n == null) SIN_DATO else "$n/8"
    fun km(n: Long?): String = if (n == null) SIN_DATO else "${miles(n)} km"

    /** ISO (con zona, o fecha sola AAAA-MM-DD) → instante en Chile. */
    fun leer(iso: String?): ZonedDateTime? {
        if (iso.isNullOrBlank()) return null
        return runCatching { OffsetDateTime.parse(iso).atZoneSameInstant(ZONA) }.getOrNull()
            ?: runCatching { Instant.parse(iso).atZone(ZONA) }.getOrNull()
            ?: runCatching { LocalDate.parse(iso.take(10)).atStartOfDay(ZONA) }.getOrNull()
    }
    fun fecha(iso: String?): String = leer(iso)?.format(dia) ?: SIN_DATO
    fun hora(iso: String?): String = leer(iso)?.format(hora) ?: SIN_DATO
    fun fechaHora(iso: String?): String = leer(iso)?.let { "${it.format(dia)} ${it.format(hora)}" } ?: SIN_DATO
    fun sello(ms: Long): String = Instant.ofEpochMilli(ms).atZone(ZONA).format(sello)
    fun iso(ms: Long): String = Instant.ofEpochMilli(ms).toString()

    /** «Hoy», «Mañana», «Ayer» o la fecha, para la agenda. */
    fun diaRelativo(iso: String?, ahora: ZonedDateTime = ZonedDateTime.now(ZONA)): String {
        val f = leer(iso) ?: return SIN_DATO
        val d = f.toLocalDate()
        val hoy = ahora.withZoneSameInstant(ZONA).toLocalDate()
        return when (d) {
            hoy -> "Hoy"
            hoy.plusDays(1) -> "Mañana"
            hoy.minusDays(1) -> "Ayer"
            else -> f.format(dia)
        }
    }

    /** «recién», «hace 5 min», «hace 2 h», «hace 3 d» (la antigüedad de la lectura de la plataforma GPS). */
    fun hace(minutos: Int?): String = when {
        minutos == null -> ""
        minutos < 1 -> "recién"
        minutos < 60 -> "hace $minutos min"
        minutos < 1440 -> "hace ${minutos / 60} h"
        else -> "hace ${minutos / 1440} d"
    }
    fun minutosDesde(iso: String?, ahoraMs: Long = System.currentTimeMillis()): Int? =
        leer(iso)?.let { ((ahoraMs - it.toInstant().toEpochMilli()) / 60_000).toInt().coerceAtLeast(0) }

    /** «PBVX61» → «PBVX-61», «AB1234» → «AB-1234» (como formatearPatente del servidor). */
    fun patente(p: String?): String {
        val s = p.orEmpty().uppercase().filter { it.isLetterOrDigit() }
        if (s.isEmpty()) return SIN_DATO
        return when {
            Regex("^[A-Z]{4}\\d{2}$").matches(s) -> "${s.take(4)}-${s.takeLast(2)}"
            Regex("^[A-Z]{2}\\d{4}$").matches(s) -> "${s.take(2)}-${s.takeLast(4)}"
            Regex("^[A-Z]{3}\\d{3}$").matches(s) -> "${s.take(3)}-${s.takeLast(3)}"
            else -> s
        }
    }

    /** RUT con puntos y guion (12.345.678-5); otro documento, tal cual. */
    fun documento(tipo: String?, doc: String?): String {
        if (doc.isNullOrBlank()) return SIN_DATO
        if (tipo != null && tipo != "rut") return doc
        val l = doc.uppercase().filter { it.isDigit() || it == 'K' }
        if (l.length < 2) return doc
        return "${miles(l.dropLast(1).toLongOrNull() ?: return doc)}-${l.last()}"
    }

    val ESTADOS_RESERVA = mapOf("cotizacion" to "Cotización", "confirmada" to "Confirmada", "en_curso" to "En curso", "devuelta" to "Devuelta", "cerrada" to "Cerrada", "cancelada" to "Cancelada", "no_show" to "No se presentó")
    val ESTADOS_VEHICULO = mapOf("disponible" to "Disponible", "arrendado" to "Arrendado", "reservado" to "Reservado", "mantencion" to "En mantención", "fuera_servicio" to "Fuera de servicio")
    val ESTADOS_CONTRATO = mapOf("pendiente_firma" to "Pendiente de firma", "firmado" to "Firmado", "anulado" to "Anulado")
    /** Botón de cada cambio de estado manual de la reserva (MANUALES del servidor). */
    val ACCIONES_RESERVA = mapOf("confirmada" to "Confirmar", "cancelada" to "Cancelar reserva", "no_show" to "No se presentó")
}
