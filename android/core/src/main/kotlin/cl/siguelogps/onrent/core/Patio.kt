// Reglas de la entrega (check-out) y la devolución (check-in), traducidas de public/js/patio-comun.js y
// public/esquema.js. El servidor importa esos mismos archivos: si cambian allá, PatioTest avisa (casos copiados de la web).
package cl.siguelogps.onrent.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

data class PosicionFoto(val clave: String, val nombre: String, val guia: String)

object Patio {
    /** Las 11 fotos obligatorias, en el orden guiado. */
    val POSICIONES = listOf(
        PosicionFoto("frente", "Frente", "Encuadra el frente completo con la patente"),
        PosicionFoto("atras", "Atrás", "Encuadra la parte trasera completa con la patente"),
        PosicionFoto("izquierdo", "Costado izq.", "Encuadra el costado izquierdo completo"),
        PosicionFoto("derecho", "Costado der.", "Encuadra el costado derecho completo"),
        PosicionFoto("esq_fi", "Esq. del. izq.", "Encuadra la esquina delantera izquierda"),
        PosicionFoto("esq_fd", "Esq. del. der.", "Encuadra la esquina delantera derecha"),
        PosicionFoto("esq_ti", "Esq. tras. izq.", "Encuadra la esquina trasera izquierda"),
        PosicionFoto("esq_td", "Esq. tras. der.", "Encuadra la esquina trasera derecha"),
        PosicionFoto("interior", "Interior", "Toma el interior desde la puerta del conductor"),
        PosicionFoto("odometro", "Odómetro", "Acércate al tablero: el kilometraje debe leerse"),
        PosicionFoto("combustible", "Combustible", "Acércate al indicador de combustible"),
    )
    val OBLIGATORIAS = POSICIONES.map { it.clave }

    fun nombrePosicion(c: String): String = POSICIONES.firstOrNull { it.clave == c }?.nombre
        ?: if (c.startsWith("extra")) "Extra ${c.substringAfter('_', "")}".trim() else c

    fun posicionValida(p: String) = p in OBLIGATORIAS || Regex("^extra_\\d{1,2}$").matches(p)

    val TIPOS_DANO = linkedMapOf("raya" to "Raya", "abolladura" to "Abolladura", "trizadura" to "Trizadura", "otro" to "Otro")
    val VISTAS = listOf("frente", "atras", "izquierdo", "derecho", "superior")
    val TIPOS_INCIDENTE = linkedMapOf("dano" to "Daño", "accidente" to "Accidente", "robo" to "Robo", "mecanico" to "Falla mecánica", "otro" to "Otro")
    val ESTADOS_INCIDENTE = mapOf("reportado" to "Reportado", "presupuestado" to "Presupuestado", "cobrado_cliente" to "Cobrado al cliente", "en_seguro" to "En seguro", "pagado" to "Pagado", "cerrado" to "Cerrado", "anulado" to "Anulado")

    /** Vista del esquema (SVG 360×470) según el punto tocado. */
    fun vistaDe(x: Double, y: Double): String = when {
        y < 64 -> "frente"
        y > 398 -> "atras"
        x < 100 -> "izquierdo"
        x > 260 -> "derecho"
        else -> "superior"
    }

    /** Zona legible del daño («Puerta delantera der.»). */
    fun zonaDano(vista: String, x: Double, y: Double): String {
        if (vista == "frente") return if (y < 34) "Parabrisas (vista frontal)" else "Parachoques delantero"
        if (vista == "atras") return if (y < 424) "Luneta trasera" else "Parachoques trasero"
        if (vista == "izquierdo" || vista == "derecho") {
            val lado = if (vista == "izquierdo") "izq." else "der."
            val l = y - 92
            return when {
                l < 70 -> "Guardabarros delantero $lado"
                l < 150 -> "Puerta delantera $lado"
                l < 236 -> "Puerta trasera $lado"
                else -> "Guardabarros trasero $lado"
            }
        }
        return when {
            y < 166 -> "Capó"
            y < 206 -> "Parabrisas"
            y < 308 -> "Techo"
            y < 346 -> "Luneta"
            else -> "Tapa del maletero"
        }
    }

    /** Título del daño como lo arma el servidor: la nota, o «Raya puerta delantera der.». */
    fun tituloDano(tipo: String, vista: String, x: Double, y: Double, descripcion: String?): String =
        descripcion?.takeIf { it.isNotBlank() } ?: "${TIPOS_DANO[tipo] ?: "Daño"} ${zonaDano(vista, x, y).replaceFirstChar { it.lowercase() }}"

    /** Ajusta el punto tocado dentro del esquema, como la web (8..352, 8..462, un decimal). */
    fun ajustarPunto(x: Double, y: Double): Pair<Double, Double> =
        Math.round(x.coerceIn(8.0, 352.0) * 10) / 10.0 to Math.round(y.coerceIn(8.0, 462.0) * 10) / 10.0
}

/** Elemento del checklist de accesorios. tipo: «si» (sí/no), «n» (cantidad) o «limpieza» (ok/sucio). */
data class ItemChecklist(val clave: String, val nombre: String, val tipo: String)

@Serializable
data class Checklist(
    val repuesto: Boolean = true,
    val gata: Boolean = true,
    val triangulos: Int = 2,
    val extintor: Boolean = true,
    val documentos: Boolean = true,
    val tag: Boolean = true,
    val limpieza: String = "ok",
    val notas: Map<String, String> = emptyMap(),
    val mantencion: Boolean = false,
) {
    fun valor(clave: String): Any = when (clave) {
        "repuesto" -> repuesto; "gata" -> gata; "triangulos" -> triangulos; "extintor" -> extintor
        "documentos" -> documentos; "tag" -> tag; "limpieza" -> limpieza; else -> true
    }

    fun alternar(clave: String): Checklist = when (clave) {
        "repuesto" -> copy(repuesto = !repuesto); "gata" -> copy(gata = !gata); "extintor" -> copy(extintor = !extintor)
        "documentos" -> copy(documentos = !documentos); "tag" -> copy(tag = !tag); else -> this
    }

    fun conTriangulos(n: Int) = copy(triangulos = n.coerceIn(0, 9))
    fun conLimpieza(v: String) = copy(limpieza = if (v == "sucio") "sucio" else "ok")
    fun conNota(clave: String, nota: String) = copy(notas = if (nota.isBlank()) notas - clave else notas + (clave to nota.take(300)))

    /** ¿El elemento está en orden? (base = el checklist de la entrega, en la devolución). */
    fun itemOk(it: ItemChecklist, base: Checklist = Checklist()): Boolean = when (it.tipo) {
        "si" -> valor(it.clave) != false
        "n" -> triangulos >= base.triangulos
        else -> limpieza != "sucio"
    }

    fun contar(base: Checklist = Checklist()): Int = ITEMS.count { itemOk(it, base) }

    /** Observaciones como las cuenta el resumen de la web: lo que no está en orden + lo que está en orden con nota. */
    fun observaciones(base: Checklist = Checklist()): Int =
        ITEMS.count { !itemOk(it, base) } + ITEMS.count { itemOk(it, base) && !notas[it.clave].isNullOrBlank() }

    /** Diferencias con la entrega (lo que estaba bien al entregar y ahora no). */
    fun diferenciasCon(entrega: Checklist): Int = ITEMS.count { it2 -> entrega.itemOk(it2, Checklist()) && !itemOk(it2, entrega) }

    fun aJson(): JsonObject = buildJsonObject {
        put("repuesto", repuesto); put("gata", gata); put("triangulos", triangulos); put("extintor", extintor)
        put("documentos", documentos); put("tag", tag); put("limpieza", limpieza)
        put("notas", buildJsonObject { notas.forEach { (k, v) -> put(k, v) } })
        if (mantencion) put("mantencion", true)
    }

    companion object {
        val ITEMS = listOf(
            ItemChecklist("repuesto", "Neumático de repuesto", "si"),
            ItemChecklist("gata", "Gata y llave de ruedas", "si"),
            ItemChecklist("triangulos", "Triángulos", "n"),
            ItemChecklist("extintor", "Extintor", "si"),
            ItemChecklist("documentos", "Documentos (padrón, SOAP, permiso)", "si"),
            ItemChecklist("tag", "TAG instalado", "si"),
            ItemChecklist("limpieza", "Limpieza interior y exterior", "limpieza"),
        )

        /** Lee el checklist que manda el servidor; lo que falte toma el valor por defecto (igual que CHECKLIST_DEFECTO). */
        fun desde(j: JsonObject?): Checklist {
            if (j == null) return Checklist()
            fun b(k: String) = (j[k] as? JsonPrimitive)?.booleanOrNull ?: true
            val notas = (j["notas"] as? JsonObject)?.mapNotNull { (k, v) -> (v as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }?.let { k to it } }?.toMap() ?: emptyMap()
            return Checklist(
                repuesto = b("repuesto"), gata = b("gata"), extintor = b("extintor"), documentos = b("documentos"), tag = b("tag"),
                triangulos = ((j["triangulos"] as? JsonPrimitive)?.intOrNull ?: (j["triangulos"] as? JsonPrimitive)?.contentOrNull?.toIntOrNull() ?: 2).coerceIn(0, 9),
                limpieza = if ((j["limpieza"] as? JsonPrimitive)?.contentOrNull == "sucio") "sucio" else "ok",
                notas = notas,
                mantencion = (j["mantencion"] as? JsonPrimitive)?.booleanOrNull ?: false,
            )
        }
    }
}

/** Lo que falta para poder firmar (mismo texto que la web). Vacío = se puede terminar. */
fun faltaParaFirmar(fotosHechas: Set<String>, kmConfirmado: Boolean): String {
    val faltan = Patio.OBLIGATORIAS.count { it !in fotosHechas }
    return listOfNotNull(
        if (faltan > 0) "faltan $faltan foto(s)" else null,
        if (!kmConfirmado) "falta confirmar km y combustible" else null,
    ).joinToString(" · ")
}

/** Texto legal que firma el cliente (igual que la web). */
fun declaracionFirma(esEntrega: Boolean, contratoFolio: String?, reservaFolio: String): String {
    val doc = if (contratoFolio != null) "del contrato $contratoFolio" else "de la reserva $reservaFolio"
    return if (esEntrega) "Declaro recibir el vehículo en el estado descrito, con las fotos y daños registrados, y acepto las condiciones $doc."
    else "Declaro devolver el vehículo en el estado descrito, con las fotos, daños y observaciones registradas, que se considerarán en la liquidación $doc."
}

/** Validación del km al confirmar, como el servidor (0..2.000.000, y en la devolución no menor que en la entrega). */
fun validarKm(km: Long?, kmEntrega: Long?): String? = when {
    km == null || km <= 0 -> "Indica el kilometraje"
    km > 2_000_000 -> "Kilometraje inválido"
    kmEntrega != null && km < kmEntrega -> "El kilometraje (${Formatos.miles(km)}) es menor que el de la entrega (${Formatos.miles(kmEntrega)})."
    else -> null
}

/** Para leer el checklist de JsonObject? de una inspección. */
fun JsonObject?.comoChecklist(): Checklist = Checklist.desde(this?.jsonObject)
