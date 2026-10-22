// Entrega o devolución a medias, guardada en el teléfono a cada toque: se puede cerrar la app, quedarse sin señal o
// apagar el teléfono y retomarla donde quedó. Al firmar se convierte en un EnvioInspeccion para la cola.
package cl.siguelogps.onrent.core

import kotlinx.serialization.Serializable

@Serializable data class BorradorInspeccion(
    val uuid: String,
    val reservaId: Long,
    val tipo: String,
    val paso: Int = 1,
    val km: Long? = null,
    val combustible: Int? = null,
    val kmGps: Long? = null,
    val combustibleGps: Int? = null,
    /** El personal confirmó (o corrigió) km y combustible contra el tablero. */
    val confirmado: Boolean = false,
    val checklist: Checklist = Checklist(),
    val observaciones: String = "",
    val firmante: String = "",
    val fotos: List<FotoPendiente> = emptyList(),
    val danos: List<DanoPendiente> = emptyList(),
) {
    val esEntrega: Boolean get() = tipo == "entrega"

    /** Posiciones con foto: las del teléfono y las que ya estaban en el servidor (si se empezó en la web). */
    fun fotosHechas(servidor: List<FotoServidor>): Set<String> = (fotos.map { it.posicion } + servidor.map { it.posicion }).toSet()

    fun siguienteFoto(servidor: List<FotoServidor>): String? = Patio.OBLIGATORIAS.firstOrNull { it !in fotosHechas(servidor) }

    /** Siguiente posición extra libre («extra_3»). */
    fun nuevaExtra(servidor: List<FotoServidor>): String {
        val usados = (fotos.map { it.posicion } + servidor.map { it.posicion }).filter { it.startsWith("extra_") }.mapNotNull { it.substringAfter('_').toIntOrNull() }
        return "extra_${(usados.maxOrNull() ?: 0) + 1}"
    }

    fun conFoto(f: FotoPendiente) = copy(fotos = fotos.filter { it.posicion != f.posicion } + f)
    fun conDano(d: DanoPendiente) = copy(danos = danos.filter { it.uuid != d.uuid } + d)
    fun sinDano(uuid: String) = copy(danos = danos.filter { it.uuid != uuid })

    fun falta(servidor: List<FotoServidor>): String = faltaParaFirmar(fotosHechas(servidor), confirmado && km != null && combustible != null)

    /** Para la cola. Las fotos que ya estaban en el servidor no se vuelven a subir. */
    fun aEnvio(folio: String, patente: String?, firmaRuta: String, lat: Double?, lng: Double?): EnvioInspeccion = EnvioInspeccion(
        uuid = uuid, reservaId = reservaId, folio = folio, patente = patente, tipo = tipo,
        km = requireNotNull(km) { "Falta el km" }, combustible = requireNotNull(combustible) { "Falta el combustible" },
        kmGps = kmGps, combustibleGps = combustibleGps, checklist = checklist, observaciones = observaciones.ifBlank { null },
        firmante = firmante.trim(), firmaRuta = firmaRuta, lat = lat, lng = lng, fotos = fotos, danos = danos,
    )

    companion object {
        /** Borrador nuevo a partir de lo que dice el servidor (lectura GPS, inspección empezada en la web, checklist de la entrega). */
        fun nuevo(uuid: String, e: EstadoPatio): BorradorInspeccion {
            val i = e.inspeccion
            val base = when {
                i?.checklist != null -> Checklist.desde(i.checklist).copy(notas = Checklist.desde(i.checklist).notas)
                e.tipo == "devolucion" && e.entrega?.checklist != null -> Checklist.desde(e.entrega.checklist).copy(notas = emptyMap(), mantencion = false)
                else -> Checklist()
            }
            val conf = i?.km != null && i.combustible != null
            return BorradorInspeccion(
                uuid = uuid, reservaId = e.reserva.id, tipo = e.tipo,
                paso = if (!conf) 1 else 2,
                km = i?.km ?: e.lectura?.km, combustible = i?.combustible ?: e.lectura?.combustible,
                kmGps = if (e.lectura?.esGps == true) e.lectura.km else null,
                combustibleGps = if (e.lectura?.esGps == true) e.lectura.combustible else null,
                confirmado = conf, checklist = base, observaciones = i?.observaciones.orEmpty(),
                firmante = i?.firmanteNombre ?: e.reserva.clienteNombre.orEmpty(),
            )
        }
    }
}
