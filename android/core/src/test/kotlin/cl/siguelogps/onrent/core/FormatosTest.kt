package cl.siguelogps.onrent.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZonedDateTime

class FormatosTest {
    @Test fun `miles, CLP y sin dato`() {
        assertEquals("48.320", Formatos.miles(48320))
        assertEquals("1.234.567", Formatos.miles(1234567))
        assertEquals("$12.345", Formatos.clp(12345))
        assertEquals("—", Formatos.clp(null))
        assertEquals("—", Formatos.km(null))
        assertEquals("7/8", Formatos.octavos(7))
        assertEquals("—", Formatos.octavos(null))
    }

    @Test fun `fechas en hora de Chile`() {
        assertEquals("16-10-2026", Formatos.fecha("2026-10-16T15:00:00.000Z"))
        assertEquals("12:00", Formatos.hora("2026-10-16T15:00:00.000Z")) // verano: UTC−3
        assertEquals("16-10-2026 12:00", Formatos.fechaHora("2026-10-16T15:00:00Z"))
        assertEquals("—", Formatos.fecha(null))
        assertEquals("01-03-2027", Formatos.fecha("2027-03-01"))
        val ahora = ZonedDateTime.parse("2026-10-16T10:00:00-03:00[America/Santiago]")
        assertEquals("Hoy", Formatos.diaRelativo("2026-10-16T20:00:00Z", ahora))
        assertEquals("Mañana", Formatos.diaRelativo("2026-10-17T15:00:00Z", ahora))
        assertEquals("20-10-2026", Formatos.diaRelativo("2026-10-20T15:00:00Z", ahora))
        assertEquals("16-10-2026 12:00:05", Formatos.sello(java.time.Instant.parse("2026-10-16T15:00:05Z").toEpochMilli()))
    }

    @Test fun `antigüedad de la lectura`() {
        assertEquals("recién", Formatos.hace(0))
        assertEquals("hace 5 min", Formatos.hace(5))
        assertEquals("hace 2 h", Formatos.hace(130))
        assertEquals("hace 3 d", Formatos.hace(3 * 1440 + 5))
        assertEquals("", Formatos.hace(null))
    }

    @Test fun `patentes y documentos`() {
        assertEquals("PBVX-61", Formatos.patente("pbvx61"))
        assertEquals("AB-1234", Formatos.patente("AB1234"))
        assertEquals("—", Formatos.patente(null))
        assertEquals("16.482.903-0", Formatos.documento("rut", "164829030"))
        assertEquals("X1234567", Formatos.documento("pasaporte", "X1234567"))
    }

    @Test fun `versión mínima`() {
        assertTrue(Versiones.debeActualizar("1.0.9", "1.0.42"))
        assertFalse(Versiones.debeActualizar("1.0.42", "1.0.42"))
        assertFalse(Versiones.debeActualizar("1.1.0-prueba", "1.0.42"))
        assertFalse(Versiones.debeActualizar("1.0-dev", "9.9"))
        assertFalse(Versiones.debeActualizar("1.0.3", null))
        assertEquals(0, Versiones.comparar("1.0", "1.0.0"))
    }

    @Test fun `módulos para el navegador según los permisos`() {
        val yo = Yo(Usuario(1, "Ana", rol = "patio"), permisos = mapOf("patio" to "editar", "mantencion" to "editar", "clientes" to "ver", "pagos" to null))
        val m = Web.disponibles(yo).map { it.modulo }
        assertEquals(listOf("clientes", "mantencion"), m)
    }
}
