package cl.siguelogps.onrent.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PatioTest {
    @Test fun `vista y zona del daño iguales a public-esquema-js (405 puntos)`() {
        // Casos generados con la función de la web (ver README: «Casos del esquema»).
        val casos = JsonOnRent.parseToJsonElement(javaClass.getResource("/casos-esquema.json")!!.readText()) as JsonArray
        assertEquals(405, casos.size)
        for (c in casos) {
            val o = c as JsonObject
            val x = o["x"]!!.jsonPrimitive.double; val y = o["y"]!!.jsonPrimitive.double
            val vista = Patio.vistaDe(x, y)
            assertEquals("vista ($x,$y)", o["vista"]!!.jsonPrimitive.content, vista)
            assertEquals("zona ($x,$y)", o["zona"]!!.jsonPrimitive.content, Patio.zonaDano(vista, x, y))
        }
    }

    @Test fun `11 fotos obligatorias en el orden de la web`() {
        assertEquals(11, Patio.OBLIGATORIAS.size)
        assertEquals(listOf("frente", "atras", "izquierdo", "derecho"), Patio.OBLIGATORIAS.take(4))
        assertEquals("Esq. tras. der.", Patio.nombrePosicion("esq_td"))
        assertEquals("Extra 3", Patio.nombrePosicion("extra_3"))
        assertTrue(Patio.posicionValida("extra_12"))
        assertFalse(Patio.posicionValida("extra_123"))
        assertFalse(Patio.posicionValida("techo"))
    }

    @Test fun `titulo del daño como el servidor`() {
        assertEquals("Raya puerta delantera izq.", Patio.tituloDano("raya", "izquierdo", 40.0, 200.0, null))
        assertEquals("8 cm en la puerta", Patio.tituloDano("raya", "izquierdo", 40.0, 200.0, "8 cm en la puerta"))
        assertEquals(8.0 to 462.0, Patio.ajustarPunto(-5.0, 999.0))
        assertEquals(120.3 to 50.0, Patio.ajustarPunto(120.34, 50.0))
    }

    @Test fun `checklist por defecto, lectura del servidor y observaciones`() {
        val ch = Checklist.desde(buildJsonObject { put("triangulos", 1); put("tag", false); put("limpieza", "sucio"); put("notas", buildJsonObject { put("extintor", "vence 08-2027") }) })
        assertEquals(1, ch.triangulos)
        assertFalse(ch.tag)
        assertTrue(ch.repuesto)
        assertEquals(4, ch.contar()) // triángulos (1 < 2), TAG y limpieza fuera
        assertEquals(4, ch.observaciones()) // 3 que no están en orden + extintor con nota
        // En la devolución la base es la entrega: si se entregó con 1 triángulo, 1 está en orden.
        assertTrue(ch.itemOk(Checklist.ITEMS[2], Checklist(triangulos = 1)))
        assertEquals(Checklist(), Checklist.desde(null))
        val json = Checklist().conNota("gata", "  ").alternar("gata").aJson()
        assertEquals("false", json["gata"].toString())
        assertNull(json["mantencion"])
        assertEquals(9, Checklist().conTriangulos(20).triangulos)
    }

    @Test fun `diferencias con la entrega`() {
        val entrega = Checklist(triangulos = 2)
        val dev = Checklist(triangulos = 1, extintor = false)
        assertEquals(2, dev.diferenciasCon(entrega))
        assertEquals(0, Checklist().diferenciasCon(Checklist()))
    }

    @Test fun `qué falta para firmar y texto de la firma`() {
        assertEquals("faltan 11 foto(s) · falta confirmar km y combustible", faltaParaFirmar(emptySet(), false))
        assertEquals("", faltaParaFirmar(Patio.OBLIGATORIAS.toSet(), true))
        assertTrue(declaracionFirma(true, "CT-2026-0418", "R-1050").contains("del contrato CT-2026-0418"))
        assertTrue(declaracionFirma(false, null, "R-1050").contains("liquidación de la reserva R-1050"))
    }

    @Test fun `validación del km`() {
        assertEquals("Indica el kilometraje", validarKm(null, null))
        assertEquals("Kilometraje inválido", validarKm(3_000_000, null))
        assertEquals("El kilometraje (48.000) es menor que el de la entrega (48.320).", validarKm(48_000, 48_320))
        assertNull(validarKm(48_500, 48_320))
    }
}

class BorradorTest {
    private fun estado(tipo: String = "devolucion", conEntrega: Boolean = true) = JsonOnRent.decodeFromString(EstadoPatio.serializer(), """
        {"reserva":{"id":10,"folio":"R-1050","estado":"en_curso","cliente_nombre":"Valentina Soto Riquelme","patente":"PBVX61"},
         "tipo":"$tipo","modo":"$tipo","inspeccion":null,"fotos":[{"posicion":"frente","archivo_id":4}],
         "lectura":{"km":48320,"combustible":7,"origen":"plataforma_gps","minutos":1},
         "entrega":${if (conEntrega) """{"km":48000,"combustible":8,"checklist":{"triangulos":1,"notas":{"tag":"x"}}}""" else "null"}}
    """.trimIndent())

    @Test fun `nuevo borrador toma la lectura GPS sin confirmarla y el checklist de la entrega`() {
        val b = BorradorInspeccion.nuevo("u1", estado())
        assertEquals(48320L, b.km)
        assertEquals(7, b.combustible)
        assertEquals(48320L, b.kmGps)
        assertFalse(b.confirmado)
        assertEquals(1, b.checklist.triangulos)
        assertTrue(b.checklist.notas.isEmpty())
        assertEquals("Valentina Soto Riquelme", b.firmante)
        assertEquals(1, b.paso)
    }

    @Test fun `fotos del servidor cuentan y las extras se numeran`() {
        val e = estado()
        var b = BorradorInspeccion.nuevo("u1", e)
        assertEquals("atras", b.siguienteFoto(e.fotos))
        b = b.conFoto(FotoPendiente("extra_1", "/f", "t"))
        assertEquals("extra_2", b.nuevaExtra(e.fotos))
        assertEquals("faltan 10 foto(s) · falta confirmar km y combustible", b.falta(e.fotos))
        b = Patio.OBLIGATORIAS.drop(1).fold(b) { acc, p -> acc.conFoto(FotoPendiente(p, "/$p", "t")) }.copy(confirmado = true)
        assertEquals("", b.falta(e.fotos))
        val envio = b.copy(firmante = "  Valentina ").aEnvio("R-1050", "PBVX61", "/firma.png", null, null)
        assertEquals("Valentina", envio.firmante)
        assertEquals(11, envio.fotos.size) // 10 obligatorias del teléfono + la extra; «frente» ya estaba en el servidor
    }
}
