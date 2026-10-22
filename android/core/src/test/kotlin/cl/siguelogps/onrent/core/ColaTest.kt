package cl.siguelogps.onrent.core

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.Files

class ColaTest {
    private lateinit var srv: MockWebServer
    private lateinit var dir: File
    private val pedidos = mutableListOf<RecordedRequest>()
    /** Para simular cortes: el pedido número N (desde 1) falla sin respuesta. */
    private var cortarEn = -1
    private var completarRespuesta = MockResponse().setBody("""{"inspeccion":{"id":77,"tipo":"devolucion","estado":"completa"},"incidentes":[{"id":5,"folio":"INC-2026-0005"}],"reserva_id":10}""")

    @Before fun antes() {
        dir = Files.createTempDirectory("cola").toFile()
        srv = MockWebServer()
        srv.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                pedidos += request
                if (pedidos.size == cortarEn) return MockResponse().setSocketPolicy(okhttp3.mockwebserver.SocketPolicy.DISCONNECT_AFTER_REQUEST)
                val p = request.path!!
                return when {
                    p.endsWith("/iniciar") -> MockResponse().setBody("""{"reserva":{"id":10,"folio":"R-1050","estado":"en_curso"},"tipo":"devolucion","modo":"devolucion","inspeccion":{"id":77,"tipo":"devolucion","estado":"borrador"}}""")
                    p.endsWith("/danos") -> MockResponse().setBody("""{"id":900,"vista":"izquierdo","x":40,"y":200,"tipo":"raya"}""")
                    p.endsWith("/completar") -> completarRespuesta
                    else -> MockResponse().setBody("""{"ok":true}""")
                }
            }
        }
        srv.start()
    }
    @After fun despues() { srv.shutdown(); dir.deleteRecursively() }

    private fun archivo(nombre: String) = File(dir, nombre).apply { writeBytes(byteArrayOf(1, 2, 3)) }.absolutePath
    private fun envio() = EnvioInspeccion(
        uuid = "insp-uuid-1", reservaId = 10, folio = "R-1050", tipo = "devolucion", km = 48500, combustible = 6,
        checklist = Checklist(triangulos = 1), observaciones = "Ruido en frenos", firmante = "Valentina Soto", firmaRuta = archivo("firma.png"),
        fotos = Patio.OBLIGATORIAS.map { FotoPendiente(it, archivo("$it.jpg"), "2026-10-16T15:00:00Z", -33.4, -70.6) },
        danos = listOf(DanoPendiente("dano-uuid-1", "izquierdo", 40.0, 200.0, "raya", "5 cm", archivo("d.jpg"))),
    )

    @Test fun `sube todo en orden, con sesión y claves de idempotencia`() = runTest {
        val api = ApiOnRent(srv.url("/").toString().trimEnd('/')).apply { token = "t".repeat(43) }
        val guardados = mutableListOf<EnvioInspeccion>()
        val (v, e) = SubidaInspeccion(api) { guardados += it }.subir(envio())
        assertEquals(Vuelta.Listo, v)
        assertTrue(e.completada)
        assertEquals(listOf("INC-2026-0005"), e.incidentes)
        assertEquals(e.pasosTotales, e.pasosHechos)
        val rutas = pedidos.map { "${it.method} ${it.path}" }
        assertEquals("POST /api/patio/reservas/10/iniciar", rutas.first())
        assertEquals("PUT /api/patio/inspecciones/77", rutas[1])
        assertEquals(11, rutas.count { it == "POST /api/patio/inspecciones/77/fotos" })
        assertEquals("POST /api/patio/inspecciones/77/completar", rutas.last())
        assertTrue(pedidos.all { it.getHeader("Authorization") == "Bearer " + "t".repeat(43) })
        assertEquals("dano-uuid-1", pedidos.first { it.path!!.endsWith("/danos") }.getHeader("Idempotency-Key"))
        assertEquals("insp-uuid-1", pedidos.last().getHeader("Idempotency-Key"))
        val borrador = pedidos[1].body.readUtf8()
        assertTrue(borrador.contains("\"km\":48500") && borrador.contains("\"triangulos\":1") && borrador.contains("Ruido en frenos"))
        assertTrue(pedidos[2].body.readUtf8().contains("data:image/jpeg;base64,AQID"))
        assertTrue(guardados.size >= 14)
    }

    @Test fun `un corte a la mitad sigue donde quedó, sin repetir lo ya subido`() = runTest {
        // Sin el reintento automático de OkHttp, para que el corte llegue a la cola como en la calle.
        val api = ApiOnRent(srv.url("/").toString().trimEnd('/'), cliente = okhttp3.OkHttpClient.Builder().retryOnConnectionFailure(false).build())
        var ultimo: EnvioInspeccion? = null
        cortarEn = 6 // iniciar, borrador y 3 fotos; la 4ª se corta (el servidor la recibe, la respuesta se pierde)
        val (v1, e1) = SubidaInspeccion(api) { ultimo = it }.subir(envio())
        assertEquals(Vuelta.Red, v1)
        assertEquals(3, e1.fotos.count { it.subida })
        assertNotNull(ultimo)
        val antes = pedidos.size
        cortarEn = -1
        val (v2, e2) = SubidaInspeccion(api) { }.subir(e1)
        assertEquals(Vuelta.Listo, v2)
        val segunda = pedidos.drop(antes).map { it.path }
        assertTrue("no repite iniciar", segunda.none { it!!.endsWith("/iniciar") })
        assertEquals(8, segunda.count { it!!.endsWith("/fotos") })
        assertTrue(e2.completada)
    }

    @Test fun `rechazo del servidor y sesión vencida no se reintentan como red`() = runTest {
        val api = ApiOnRent(srv.url("/").toString().trimEnd('/'))
        completarRespuesta = MockResponse().setResponseCode(400).setBody("""{"error":"Falta la firma del cliente.","campo":"firma"}""")
        val (v, e) = SubidaInspeccion(api) { }.subir(envio())
        assertEquals(Vuelta.Rechazo("Falta la firma del cliente."), v)
        assertTrue(!e.completada && e.danos.single().servidorId == 900L)
        assertEquals(Vuelta.Sesion, Clasificar.respuesta(RespuestaEnvio(401, "{}")))
        assertEquals(Vuelta.Red, Clasificar.respuesta(RespuestaEnvio(409, """{"error":"x","en_proceso":true}""")))
        assertEquals(Vuelta.Red, Clasificar.respuesta(RespuestaEnvio(503, "")))
        assertEquals(Vuelta.Red, Clasificar.respuesta(RespuestaEnvio(null, null, "timeout")))
        assertEquals(60_000L, Clasificar.espera(1))
        assertEquals(3_600_000L, Clasificar.espera(30))
    }

    @Test fun `la reserva ya no está para recibir`() = runTest {
        srv.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = MockResponse().setResponseCode(409).setBody("""{"error":"La reserva está «devuelta»: no hay entrega ni devolución pendiente."}""")
        }
        val (v, _) = SubidaInspeccion(ApiOnRent(srv.url("/").toString())) { }.subir(envio())
        assertTrue(v is Vuelta.Rechazo && v.mensaje.contains("devuelta"))
    }

    @Test fun `incidente con fotos y su clave`() = runTest {
        srv.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse { pedidos += request; return MockResponse().setBody("""{"id":3,"folio":"INC-2026-0003"}""") }
        }
        val (v, folio) = SubidaIncidente(ApiOnRent(srv.url("/").toString())).subir(EnvioIncidente("inc-1", "accidente", "PBVX61", null, "Choque leve", listOf(archivo("a.jpg"), archivo("b.jpg"))))
        assertEquals(Vuelta.Listo, v)
        assertEquals("INC-2026-0003", folio)
        val p = pedidos.single()
        assertEquals("inc-1", p.getHeader("Idempotency-Key"))
        val cuerpo = p.body.readUtf8()
        assertEquals(2, Regex("data:image/jpeg").findAll(cuerpo).count())
        assertTrue(cuerpo.contains("\"patente\":\"PBVX61\""))
    }

    @Test fun `ingreso pide el token de la app y lee los errores del servidor`() = runTest {
        srv.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                pedidos += request
                return if (request.body.readUtf8().contains("mala")) MockResponse().setResponseCode(401).setBody("""{"error":"Correo o clave incorrectos."}""")
                else MockResponse().setBody("""{"ok":true,"destino":"/patio","token":"abc"}""")
            }
        }
        val api = ApiOnRent(srv.url("/").toString())
        val ok = api.ingresar(" Patio@SigueloGPS.cl ", "demo1234")
        assertEquals("abc", (ok as RespuestaApi.Ok).datos.token)
        val r = api.ingresar("patio@siguelogps.cl", "mala")
        assertEquals(RespuestaApi.Error(401, "Correo o clave incorrectos."), r)
        val primero = pedidos.first()
        assertEquals("/api/ingresar", primero.path)
    }
}
