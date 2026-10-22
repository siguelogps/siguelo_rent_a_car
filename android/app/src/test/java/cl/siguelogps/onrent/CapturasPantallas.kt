package cl.siguelogps.onrent

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.test.ext.junit.runners.AndroidJUnit4
import cl.siguelogps.onrent.core.ApiOnRent
import cl.siguelogps.onrent.core.BorradorInspeccion
import cl.siguelogps.onrent.core.Checklist
import cl.siguelogps.onrent.core.DanoPendiente
import cl.siguelogps.onrent.core.EnvioInspeccion
import cl.siguelogps.onrent.core.EstadoPatio
import cl.siguelogps.onrent.core.FichaContrato
import cl.siguelogps.onrent.core.FichaReserva
import cl.siguelogps.onrent.core.FotoPendiente
import cl.siguelogps.onrent.core.JsonOnRent
import cl.siguelogps.onrent.core.ListaIncidentes
import cl.siguelogps.onrent.core.Patio
import cl.siguelogps.onrent.core.Tareas
import cl.siguelogps.onrent.core.Vehiculo
import cl.siguelogps.onrent.core.Yo
import cl.siguelogps.onrent.datos.Lectura
import cl.siguelogps.onrent.datos.Pendiente
import cl.siguelogps.onrent.ui.AccionesAsistente
import cl.siguelogps.onrent.ui.AccionesContrato
import cl.siguelogps.onrent.ui.AccionesReserva
import cl.siguelogps.onrent.ui.BarraCola
import cl.siguelogps.onrent.ui.BarraPestanas
import cl.siguelogps.onrent.ui.CabeceraPrincipal
import cl.siguelogps.onrent.ui.CargadorImagenes
import cl.siguelogps.onrent.ui.ContenidoAgenda
import cl.siguelogps.onrent.ui.ContenidoFlota
import cl.siguelogps.onrent.ui.ContenidoMas
import cl.siguelogps.onrent.ui.EstadoFirma
import cl.siguelogps.onrent.ui.FuenteImagenes
import cl.siguelogps.onrent.ui.ContenidoHojaDano
import cl.siguelogps.onrent.ui.Tarjeta
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.unit.dp
import cl.siguelogps.onrent.ui.IncidenteBorrador
import cl.siguelogps.onrent.ui.ListaIncidentes
import cl.siguelogps.onrent.ui.LocalImagenes
import cl.siguelogps.onrent.ui.PantallaActualizar
import cl.siguelogps.onrent.ui.PantallaAsistente
import cl.siguelogps.onrent.ui.PantallaCola
import cl.siguelogps.onrent.ui.PantallaContrato
import cl.siguelogps.onrent.ui.PantallaEliminarCuenta
import cl.siguelogps.onrent.ui.PantallaIngreso
import cl.siguelogps.onrent.ui.PantallaNuevoIncidente
import cl.siguelogps.onrent.ui.PantallaReserva
import cl.siguelogps.onrent.ui.Pestana
import cl.siguelogps.onrent.ui.TemaOnRent
import cl.siguelogps.onrent.ui.c
import com.github.takahirom.roborazzi.captureRoboImage
import kotlinx.serialization.builtins.ListSerializer
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * Capturas de las pantallas principales para revisarlas sin teléfono (Robolectric dibuja Compose en la JVM).
 * Datos inventados de demostración. Se ejecutan con:
 *   ./gradlew :app:testDebugUnitTest --tests "*CapturasPantallas*" -Proborazzi.test.record=true
 * Quedan en app/build/capturas/. GitHub Actions las sube a la rama «capturas-android».
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w360dp-h780dp-xxhdpi", application = android.app.Application::class)
class CapturasPantallas {
    @get:Rule val compose = createComposeRule()

    private inline fun <reified T> leer(s: String): T = JsonOnRent.decodeFromString(kotlinx.serialization.serializer<T>(), s)

    /** Foto inventada: un rectángulo de color con un auto simple dibujado. */
    private fun foto(nombre: String, color: Int): String {
        val f = File(RuntimeEnvironment.getApplication().cacheDir, "$nombre.jpg")
        val b = Bitmap.createBitmap(320, 240, Bitmap.Config.ARGB_8888)
        b.eraseColor(color)
        val c = Canvas(b); val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = Color.rgb(230, 232, 236) }
        c.drawRect(0f, 170f, 320f, 240f, Paint().apply { this.color = Color.rgb(70, 74, 80) })
        c.drawRoundRect(60f, 110f, 260f, 175f, 18f, 18f, p); c.drawRoundRect(95f, 80f, 220f, 125f, 14f, 14f, p)
        p.color = Color.rgb(30, 30, 30); c.drawCircle(100f, 178f, 18f, p); c.drawCircle(220f, 178f, 18f, p)
        f.outputStream().use { b.compress(Bitmap.CompressFormat.JPEG, 85, it) }
        return f.absolutePath
    }

    private fun captura(nombre: String, oscuro: Boolean = false, alto: Int? = null, contenido: @Composable () -> Unit) {
        if (alto != null) RuntimeEnvironment.setQualifiers("w360dp-h${alto}dp-xxhdpi")
        val fuente = FuenteImagenes(CargadorImagenes(ApiOnRent("https://onrent.invalid"), RuntimeEnvironment.getApplication().cacheDir))
        compose.setContent { TemaOnRent(oscuro) { CompositionLocalProvider(LocalImagenes provides fuente) { Box(Modifier.fillMaxSize().background(c.fondo)) { contenido() } } } }
        compose.onRoot().captureRoboImage("build/capturas/$nombre.png")
    }

    private val yo = leer<Yo>("""{"usuario":{"id":3,"nombre":"Pedro Patio","correo":"patio@andesrent.cl","rol":"administrador","rol_nombre":"Administrador"},
        "permisos":{"inicio":"editar","reservas":"editar","patio":"editar","contratos":"editar","clientes":"editar","flota":"editar","mantencion":"editar","gps":"ver","pagos":"editar","liquidaciones":"editar","incidentes":"editar","reportes":"ver","configuracion":"editar"},
        "empresa":{"id":1,"nombre":"Andes Rent a Car","slug":"andes"}}""")

    private val tareas = leer<Tareas>("""{"entregas":[
        {"id":10,"folio":"R-1004","estado":"confirmada","inicio":"2026-10-22T17:00:00Z","cliente":"John Miller","patente":"RTKP42","marca":"Suzuki","modelo":"Swift","color":"Blanco","sucursal_retiro":"Aeropuerto SCL"},
        {"id":11,"folio":"R-1007","estado":"confirmada","inicio":"2026-10-22T17:00:00Z","cliente":"Valentina Soto Riquelme","patente":"PBVX61","marca":"Hyundai","modelo":"Accent","color":"Gris plata","sucursal_retiro":"Aeropuerto SCL","inspeccion_estado":"borrador","fotos":4},
        {"id":12,"folio":"R-0998","estado":"confirmada","inicio":"2026-10-21T13:00:00Z","cliente":"Camila Rojas","patente":"KLRT18","marca":"Kia","modelo":"Rio 5","color":"Rojo","sucursal_retiro":"Providencia","vencida":true}],
        "devoluciones":[{"id":20,"folio":"R-0981","estado":"en_curso","fin":"2026-10-22T21:00:00Z","cliente":"Ignacio Pérez","patente":"HJKL22","marca":"Toyota","modelo":"Yaris","sucursal_devolucion":"Aeropuerto SCL"}],
        "recientes":[{"id":30,"folio":"R-0970","estado":"devuelta","devolucion_real":"2026-10-21T14:00:00Z","cliente":"María Fuentes","patente":"GHTR55","marca":"Chevrolet","modelo":"Sail","sucursal_devolucion":"Providencia"}]}""")

    private val flota = leer<List<Vehiculo>>("""[
        {"id":1,"patente":"PBVX61","marca":"Hyundai","modelo":"Accent","anio":2023,"estado":"reservado","km":48100,"combustible_nivel":7,"gps_km":48320,"gps_combustible":7,"gps_actualizado_en":"${java.time.Instant.now().minusSeconds(120)}","gps_unidad_id":"55","categoria":"Sedán","sucursal":"Aeropuerto SCL","proxima_folio":"R-1007","proxima_inicio":"2026-10-22T17:00:00Z","danos_activos":3,"vencimientos":[{"campo":"venc_soap","nombre":"SOAP","fecha":"2027-03-31","dias":160}]},
        {"id":2,"patente":"HJKL22","marca":"Toyota","modelo":"Yaris","anio":2022,"estado":"arrendado","km":61200,"combustible_nivel":5,"gps_km":61544,"gps_combustible":4,"gps_actualizado_en":"${java.time.Instant.now().minusSeconds(900)}","gps_unidad_id":"56","reserva_id":20,"reserva_folio":"R-0981","atrasado":false,"vencimientos":[{"campo":"venc_revision_tecnica","nombre":"Revisión técnica","fecha":"2026-11-05","dias":14}]},
        {"id":3,"patente":"RTKP42","marca":"Suzuki","modelo":"Swift","anio":2024,"estado":"disponible","km":12040,"combustible_nivel":8,"vencimientos":[]},
        {"id":4,"patente":"KLRT18","marca":"Kia","modelo":"Rio 5","anio":2021,"estado":"mantencion","gps_unidad_id":"57","vencimientos":[{"campo":"venc_permiso_circulacion","nombre":"Permiso de circulación","fecha":"2026-10-01","dias":-21}]}]""")

    private fun estado(tipo: String) = leer<EstadoPatio>("""{"reserva":{"id":11,"folio":"R-1050","estado":"${if (tipo == "entrega") "confirmada" else "en_curso"}","fin":"2026-10-25T15:00:00Z","km_incluidos":600,
        "cliente_nombre":"Valentina Soto Riquelme","documento_tipo":"rut","documento":"164829030","patente":"PBVX61","marca":"Hyundai","modelo":"Accent","contrato_folio":"CT-2026-0418"},
        "tipo":"$tipo","modo":"$tipo","inspeccion":null,"fotos":[],"obligatorias":${Patio.OBLIGATORIAS.joinToString(",", "[", "]") { "\"$it\"" }},
        "danos_previos":[{"id":1,"vista":"izquierdo","x":40,"y":250,"tipo":"raya","titulo":"Raya puerta trasera izq.","reserva_folio":"C-0977","inspeccion_tipo":"devolucion"},
                          {"id":2,"vista":"superior","x":200,"y":180,"tipo":"trizadura","titulo":"Trizadura parabrisas"}],
        "danos_nuevos":[],"lectura":{"km":48320,"combustible":7,"origen":"plataforma_gps","minutos":1},
        "entrega":${if (tipo == "entrega") "null" else """{"km":47800,"combustible":8,"checklist":{"triangulos":2}}"""},
        "sucursal":{"nombre":"Aeropuerto SCL"}}""")

    private fun borrador(tipo: String, paso: Int, fotos: Int = 0, conf: Boolean = true): BorradorInspeccion {
        var b = BorradorInspeccion.nuevo("u-$tipo", estado(tipo)).copy(paso = paso, confirmado = conf)
        val colores = listOf(Color.rgb(120, 140, 160), Color.rgb(140, 120, 110), Color.rgb(100, 120, 100), Color.rgb(150, 150, 160))
        Patio.OBLIGATORIAS.take(fotos).forEachIndexed { i, p -> b = b.conFoto(FotoPendiente(p, foto("f-$p", colores[i % 4]), "2026-10-22T14:0$i:00Z", -33.3968, -70.7937)) }
        return b
    }

    private val sinAcciones = AccionesAsistente()

    @Test fun c01_ingreso() = captura("01-ingreso") { PantallaIngreso("patio@andesrent.cl", false, null, { _, _ -> }, {}) }

    @Composable private fun conPestanas(p: Pestana, titulo: String, porSubir: Int = 0, enLinea: Boolean = true, contenido: @Composable () -> Unit) {
        Column(Modifier.fillMaxSize()) {
            CabeceraPrincipal(titulo, "Andes Rent a Car")
            BarraCola(porSubir, 0, enLinea)
            Box(Modifier.weight(1f)) { contenido() }
            BarraPestanas(p, 0) {}
        }
    }

    @Test fun c02_agenda() = captura("02-agenda", alto = 900) { conPestanas(Pestana.AGENDA, "Entregas y devoluciones") { ContenidoAgenda(Lectura(tareas), true, emptySet(), setOf(10L), { _, _ -> }, {}, {}) } }
    @Test fun c03_agendaSinSenalOscuro() = captura("03-agenda-sin-senal-oscuro", oscuro = true, alto = 900) {
        conPestanas(Pestana.AGENDA, "Entregas y devoluciones", porSubir = 2, enLinea = false) { ContenidoAgenda(Lectura(tareas, true, "Sin señal · se muestra lo guardado", 1792680000000L), true, setOf(12L), emptySet(), { _, _ -> }, {}, {}) }
    }
    @Test fun c04_paso1() = captura("04-entrega-km-checklist", alto = 860) { PantallaAsistente(estado("entrega"), borrador("entrega", 1, conf = false).let { it.copy(checklist = it.checklist.conLimpieza("sucio").conNota("limpieza", "Polvo en tablero · se anota")) }, false, sinAcciones) }
    @Test fun c05_paso2() = captura("05-entrega-fotos", alto = 900) { PantallaAsistente(estado("entrega"), borrador("entrega", 2, fotos = 7), false, sinAcciones) }
    @Test fun c06_paso3() = captura("06-devolucion-danos", alto = 900) {
        val b = borrador("devolucion", 3, fotos = 11).conDano(DanoPendiente("d1", "derecho", 312.0, 330.0, "abolladura", "Golpe en estacionamiento"))
        PantallaAsistente(estado("devolucion"), b, false, sinAcciones)
    }
    @Test fun c07_hojaDano() = captura("07-hoja-dano") {
        // El contenido de la hoja (en la app va dentro de un diálogo).
        Column(Modifier.fillMaxSize().padding(16.dp)) { Tarjeta { ContenidoHojaDano(DanoPendiente("d2", "frente", 160.0, 50.0, "raya", "8 cm", foto("dano", Color.rgb(160, 140, 120))), false, {}, {}) } }
    }
    @Test fun c08_paso4() = captura("08-devolucion-checklist", alto = 1100) {
        val b = borrador("devolucion", 4, fotos = 11).copy(km = 48520, combustible = 6, checklist = Checklist(triangulos = 1, mantencion = true).conNota("triangulos", "Falta uno"), observaciones = "Cliente indica ruido en frenos")
            .conDano(DanoPendiente("d1", "derecho", 312.0, 330.0, "abolladura"))
        PantallaAsistente(estado("devolucion"), b, false, sinAcciones)
    }
    @Test fun c09_paso5() = captura("09-entrega-firma", alto = 900) {
        val firma = EstadoFirma().apply { empezar(Offset(.08f, .7f)); listOf(.15f to .3f, .22f to .75f, .3f to .35f, .38f to .7f, .48f to .4f, .6f to .65f, .75f to .45f, .9f to .5f).forEach { (x, y) -> seguir(Offset(x, y)) }; terminar() }
        PantallaAsistente(estado("entrega"), borrador("entrega", 5, fotos = 11).copy(firmante = "Valentina Soto Riquelme"), false, sinAcciones, firma)
    }
    @Test fun c10_flota() = captura("10-vehiculos", alto = 900) { conPestanas(Pestana.FLOTA, "Vehículos") { ContenidoFlota(Lectura(flota), true, {}, {}, {}) } }
    @Test fun c11_flotaOscuro() = captura("11-vehiculos-oscuro", oscuro = true, alto = 900) { conPestanas(Pestana.FLOTA, "Vehículos") { ContenidoFlota(Lectura(flota), true, {}, {}, {}) } }

    private val ficha = leer<FichaReserva>("""{"reserva":{"id":11,"folio":"R-1050","estado":"confirmada","inicio":"2026-10-22T17:00:00Z","fin":"2026-10-25T15:00:00Z","total":189900,"garantia":350000,"km_incluidos":600},
        "cliente":{"id":4,"nombre":"Valentina","apellidos":"Soto Riquelme","documento_tipo":"rut","documento":"164829030","telefono":"+56 9 8765 4321"},
        "vehiculo":{"id":1,"patente":"PBVX61","marca":"Hyundai","modelo":"Accent","anio":2023},"sucursal_retiro":{"nombre":"Aeropuerto SCL"},"sucursal_devolucion":{"nombre":"Providencia"},
        "contratos":[{"id":7,"folio":"CT-2026-0418","estado":"pendiente_firma","creado_en":"2026-10-21T15:00:00Z"}],
        "gps":{"km":48320,"combustible":7,"origen":"plataforma_gps","actualizado_en":"${java.time.Instant.now().minusSeconds(60)}"},"transiciones":["cancelada","no_show"]}""")
    @Test fun c12_reserva() = captura("12-reserva", alto = 1200) { PantallaReserva(Lectura(ficha), true, true, true, true, false, false, {}, AccionesReserva()) }
    @Test fun c13_contrato() = captura("13-contrato", alto = 900) {
        PantallaContrato(Lectura(leer<FichaContrato>("""{"contrato":{"id":7,"folio":"CT-2026-0418","estado":"firmado","firmado_en":"2026-10-22T17:20:00Z","firmante_nombre":"Valentina Soto Riquelme","codigo_verificacion":"K7M4QX92","creado_en":"2026-10-21T15:00:00Z"},
            "reserva":{"id":11,"folio":"R-1050","estado":"en_curso","inicio":"2026-10-22T17:00:00Z","fin":"2026-10-25T15:00:00Z","total":189900,"cliente":"Valentina Soto Riquelme","patente":"PBVX61","marca":"Hyundai","modelo":"Accent"},
            "historial":[{"accion":"contrato_firmado","usuario":"Pedro Patio","creado_en":"2026-10-22T17:20:00Z"},{"accion":"contrato_generado","usuario":"Ana Counter","creado_en":"2026-10-21T15:00:00Z"}]}""")), true, false, {}, AccionesContrato())
    }
    @Test fun c14_incidentes() = captura("14-incidentes", alto = 900) {
        val l = leer<ListaIncidentes>("""{"incidentes":[{"id":5,"folio":"INC-2026-0005","tipo":"dano","estado":"reportado","descripcion":"Daño nuevo detectado en la devolución (Abolladura guardabarros trasero der.) por Pedro Patio","patente":"HJKL22","reserva_folio":"R-0981","cliente_nombre":"Ignacio Pérez","creado_en":"2026-10-22T13:10:00Z"},
            {"id":4,"folio":"INC-2026-0004","tipo":"mecanico","estado":"presupuestado","descripcion":"Ruido en frenos al llegar","patente":"KLRT18","creado_en":"2026-10-20T19:00:00Z"}]}""")
        val local = Pendiente("u1", "incidente", "Incidente PBVX-61", "{}")
        conPestanas(Pestana.INCIDENTES, "Incidentes", porSubir = 1) { ListaIncidentes(Lectura(l), listOf(local), true, {}, {}, {}, {}) }
    }
    @Test fun c15_nuevoIncidente() = captura("15-nuevo-incidente", alto = 900) {
        PantallaNuevoIncidente(IncidenteBorrador("u", "accidente", "PBVX61", descripcion = "Choque leve en el estacionamiento del aeropuerto, puerta trasera derecha.", fotos = listOf(foto("i1", Color.rgb(120, 130, 140)), foto("i2", Color.rgb(140, 110, 100)))), flota, {}, {}, {}, {}, {})
    }
    @Test fun c16_mas() = captura("16-mas", alto = 1250) { conPestanas(Pestana.MAS, "Más") { ContenidoMas(yo, 1, 0, "1.0.42", {}, {}, {}, {}) } }
    @Test fun c17_cola() = captura("17-envios") {
        val envio = EnvioInspeccion("u", 11, "R-1050", "PBVX61", "devolucion", 48520, 6, firmante = "V", firmaRuta = "/f",
            fotos = Patio.OBLIGATORIAS.mapIndexed { i, p -> FotoPendiente(p, "/$p", "t", subida = i < 4) })
        PantallaCola(listOf(
            Pendiente("a", "inspeccion", "Devolución R-1050", JsonOnRent.encodeToString(EnvioInspeccion.serializer(), envio), creado = 1792680000000L),
            Pendiente("b", "incidente", "Incidente KLRT-18", "{}", estado = "error", error = "Vehículo no encontrado", creado = 1792670000000L),
            Pendiente("c", "inspeccion", "Entrega R-1004", "{}", estado = "enviado", resultado = null, creado = 1792660000000L),
        ), false, {}, {}, {})
    }
    @Test fun c18_eliminarCuenta() = captura("18-eliminar-cuenta") { PantallaEliminarCuenta(false, {}, {}, {}) }
    @Test fun c19_actualizar() = captura("19-actualizar") { PantallaActualizar("Hay una versión nueva con mejoras en las fotos de la devolución.") {} }
    @Test fun c20_paso2Oscuro() = captura("20-entrega-fotos-oscuro", oscuro = true, alto = 900) { PantallaAsistente(estado("entrega"), borrador("entrega", 2, fotos = 3), false, sinAcciones) }
}
