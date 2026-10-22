// Modelos de la API de Síguelo On Rent tal como los manda el servidor (src/api/*.js). Los nombres de los campos son
// los del JSON (snake_case). Todo lo que puede faltar es nulo: un dato que no llegó se muestra «—», nunca 0.
package cl.siguelogps.onrent.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

val JsonOnRent = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    isLenient = true
    encodeDefaults = true
}

@Serializable data class Ingreso(val ok: Boolean = false, val destino: String? = null, val token: String? = null)
@Serializable data class ErrorApi(val error: String? = null, val campo: String? = null)

@Serializable data class Usuario(val id: Long, val nombre: String, val correo: String? = null, val rol: String, @SerialName("rol_nombre") val rolNombre: String? = null, @SerialName("sucursal_id") val sucursalId: Long? = null)
@Serializable data class Empresa(val id: Long, val nombre: String, val slug: String? = null, val color: String? = null, @SerialName("marcha_blanca") val marchaBlanca: Boolean? = null)
@Serializable data class Sucursal(val id: Long, val nombre: String)
@Serializable data class Plan(val codigo: String? = null, val nombre: String? = null, val modulos: List<String> = emptyList())
@Serializable data class Yo(
    val usuario: Usuario,
    /** módulo → «ver» | «editar» | null (sin acceso o fuera del plan). */
    val permisos: Map<String, String?> = emptyMap(),
    val empresa: Empresa? = null,
    val sucursales: List<Sucursal> = emptyList(),
    val siguelo: Boolean = false,
    val modo: String? = null,
    val plan: Plan? = null,
) {
    fun puede(modulo: String, accion: String = "ver"): Boolean {
        val n = permisos[modulo] ?: return false
        return if (accion == "ver") n == "ver" || n == "editar" else n == "editar"
    }
}

// ── Agenda (GET /api/patio/tareas) ──
@Serializable data class Tarea(
    val id: Long,
    val folio: String,
    val estado: String,
    val inicio: String? = null,
    val fin: String? = null,
    @SerialName("retiro_real") val retiroReal: String? = null,
    @SerialName("devolucion_real") val devolucionReal: String? = null,
    val cliente: String? = null,
    val telefono: String? = null,
    val patente: String? = null,
    val marca: String? = null,
    val modelo: String? = null,
    val color: String? = null,
    @SerialName("sucursal_retiro") val sucursalRetiro: String? = null,
    @SerialName("sucursal_devolucion") val sucursalDevolucion: String? = null,
    @SerialName("inspeccion_id") val inspeccionId: Long? = null,
    @SerialName("inspeccion_estado") val inspeccionEstado: String? = null,
    val fotos: Int? = null,
    val atrasada: Boolean = false,
    val vencida: Boolean = false,
)
@Serializable data class Tareas(val entregas: List<Tarea> = emptyList(), val devoluciones: List<Tarea> = emptyList(), val recientes: List<Tarea> = emptyList(), @SerialName("total_fotos") val totalFotos: Int = 11)

// ── Asistente de entrega y devolución (GET /api/patio/reservas/:id) ──
@Serializable data class ReservaPatio(
    val id: Long, val folio: String, val estado: String,
    val inicio: String? = null, val fin: String? = null,
    @SerialName("km_incluidos") val kmIncluidos: Long? = null,
    @SerialName("cliente_nombre") val clienteNombre: String? = null,
    @SerialName("documento_tipo") val documentoTipo: String? = null,
    val documento: String? = null,
    val telefono: String? = null,
    @SerialName("vehiculo_id") val vehiculoId: Long? = null,
    val patente: String? = null, val marca: String? = null, val modelo: String? = null, val anio: Int? = null, val color: String? = null,
    @SerialName("sucursal_retiro") val sucursalRetiro: String? = null,
    @SerialName("sucursal_devolucion") val sucursalDevolucion: String? = null,
    @SerialName("contrato_id") val contratoId: Long? = null,
    @SerialName("contrato_folio") val contratoFolio: String? = null,
)
@Serializable data class Inspeccion(
    val id: Long,
    val tipo: String,
    val estado: String,
    val km: Long? = null,
    val combustible: Int? = null,
    @SerialName("km_gps") val kmGps: Long? = null,
    @SerialName("combustible_gps") val combustibleGps: Int? = null,
    val checklist: JsonObject? = null,
    val observaciones: String? = null,
    @SerialName("firmante_nombre") val firmanteNombre: String? = null,
    @SerialName("completado_en") val completadoEn: String? = null,
)
@Serializable data class FotoServidor(val posicion: String, @SerialName("archivo_id") val archivoId: Long, val lat: Double? = null, val lng: Double? = null, @SerialName("tomada_en") val tomadaEn: String? = null)
@Serializable data class Dano(
    val id: Long,
    val n: Int? = null,
    val vista: String,
    val x: Double,
    val y: Double,
    val tipo: String,
    val descripcion: String? = null,
    val titulo: String? = null,
    val zona: String? = null,
    @SerialName("archivo_id") val archivoId: Long? = null,
    @SerialName("reserva_folio") val reservaFolio: String? = null,
    @SerialName("inspeccion_tipo") val inspeccionTipo: String? = null,
    @SerialName("incidente_folio") val incidenteFolio: String? = null,
    @SerialName("creado_en") val creadoEn: String? = null,
    val nuevo: Boolean? = null,
)
@Serializable data class Lectura(
    val km: Long? = null,
    val combustible: Int? = null,
    val origen: String? = null,
    val minutos: Int? = null,
    @SerialName("actualizado_en") val actualizadoEn: String? = null,
) { val esGps: Boolean get() = origen == "plataforma_gps" }
@Serializable data class EntregaResumen(val id: Long? = null, val estado: String? = null, val km: Long? = null, val combustible: Int? = null, val checklist: JsonObject? = null)
@Serializable data class SucursalPatio(val nombre: String? = null)
@Serializable data class EstadoPatio(
    val reserva: ReservaPatio,
    val tipo: String,
    /** «entrega», «devolucion» o «lectura» (ya completa o no corresponde). */
    val modo: String,
    val inspeccion: Inspeccion? = null,
    val fotos: List<FotoServidor> = emptyList(),
    val obligatorias: List<String> = emptyList(),
    @SerialName("danos_previos") val danosPrevios: List<Dano> = emptyList(),
    @SerialName("danos_nuevos") val danosNuevos: List<Dano> = emptyList(),
    val lectura: Lectura? = null,
    val entrega: EntregaResumen? = null,
    val sucursal: SucursalPatio? = null,
)

// ── Vehículos (GET /api/vehiculos) ──
@Serializable data class Vencimiento(val campo: String, val nombre: String, val fecha: String? = null, val dias: Int? = null)
@Serializable data class Vehiculo(
    val id: Long,
    val patente: String,
    val marca: String? = null,
    val modelo: String? = null,
    val anio: Int? = null,
    val color: String? = null,
    val estado: String,
    val km: Long? = null,
    @SerialName("combustible_nivel") val combustibleNivel: Int? = null,
    @SerialName("gps_km") val gpsKm: Long? = null,
    @SerialName("gps_combustible") val gpsCombustible: Int? = null,
    @SerialName("gps_actualizado_en") val gpsActualizadoEn: String? = null,
    @SerialName("gps_unidad_id") val gpsUnidadId: String? = null,
    val categoria: String? = null,
    val sucursal: String? = null,
    @SerialName("reserva_id") val reservaId: Long? = null,
    @SerialName("reserva_folio") val reservaFolio: String? = null,
    @SerialName("reserva_fin") val reservaFin: String? = null,
    val atrasado: Boolean? = null,
    @SerialName("proxima_folio") val proximaFolio: String? = null,
    @SerialName("proxima_inicio") val proximaInicio: String? = null,
    @SerialName("danos_activos") val danosActivos: Int? = null,
    val vencimientos: List<Vencimiento> = emptyList(),
)

// ── Reserva (GET /api/reservas/:id) ──
@Serializable data class ReservaDatos(
    val id: Long, val folio: String, val estado: String,
    val inicio: String? = null, val fin: String? = null,
    @SerialName("retiro_real") val retiroReal: String? = null,
    @SerialName("devolucion_real") val devolucionReal: String? = null,
    val total: Long? = null,
    val garantia: Long? = null,
    val deducible: Long? = null,
    @SerialName("km_incluidos") val kmIncluidos: Long? = null,
    val origen: String? = null,
    val notas: String? = null,
)
@Serializable data class ClienteDatos(val id: Long, val nombre: String? = null, val apellidos: String? = null, @SerialName("documento_tipo") val documentoTipo: String? = null, val documento: String? = null, val telefono: String? = null, val correo: String? = null) {
    val nombreCompleto: String get() = listOfNotNull(nombre, apellidos).joinToString(" ").trim()
}
@Serializable data class VehiculoDatos(val id: Long, val patente: String, val marca: String? = null, val modelo: String? = null, val anio: Int? = null, val color: String? = null, val categoria: String? = null)
@Serializable data class SucursalDatos(val id: Long? = null, val nombre: String? = null)
@Serializable data class ContratoCorto(val id: Long, val folio: String, val estado: String, @SerialName("firmado_en") val firmadoEn: String? = null, @SerialName("firmante_nombre") val firmanteNombre: String? = null, @SerialName("creado_en") val creadoEn: String? = null)
@Serializable data class PagoCorto(val id: Long, val concepto: String? = null, val metodo: String? = null, val estado: String? = null, val monto: Long? = null)
@Serializable data class FichaReserva(
    val reserva: ReservaDatos,
    val cliente: ClienteDatos? = null,
    val vehiculo: VehiculoDatos? = null,
    @SerialName("sucursal_retiro") val sucursalRetiro: SucursalDatos? = null,
    @SerialName("sucursal_devolucion") val sucursalDevolucion: SucursalDatos? = null,
    val contratos: List<ContratoCorto> = emptyList(),
    val pagos: List<PagoCorto> = emptyList(),
    val gps: Lectura? = null,
    val transiciones: List<String> = emptyList(),
)

// ── Contrato (GET /api/contratos/:id) ──
@Serializable data class ContratoDatos(
    val id: Long, val folio: String, val estado: String,
    @SerialName("reserva_id") val reservaId: Long? = null,
    @SerialName("codigo_verificacion") val codigoVerificacion: String? = null,
    @SerialName("firmado_en") val firmadoEn: String? = null,
    @SerialName("firmante_nombre") val firmanteNombre: String? = null,
    @SerialName("creado_en") val creadoEn: String? = null,
    @SerialName("creado_por_nombre") val creadoPorNombre: String? = null,
    @SerialName("anulado_motivo") val anuladoMotivo: String? = null,
    @SerialName("url_verificacion") val urlVerificacion: String? = null,
)
@Serializable data class EnlaceFirma(@SerialName("url_firma") val urlFirma: String? = null, val vence: String? = null)
@Serializable data class ReservaDeContrato(val id: Long, val folio: String, val estado: String, val inicio: String? = null, val fin: String? = null, val total: Long? = null, val cliente: String? = null, val correo: String? = null, val telefono: String? = null, val patente: String? = null, val marca: String? = null, val modelo: String? = null)
@Serializable data class HistorialItem(val accion: String, val usuario: String? = null, @SerialName("creado_en") val creadoEn: String? = null)
@Serializable data class FichaContrato(val contrato: ContratoDatos, val enlace: EnlaceFirma? = null, val reserva: ReservaDeContrato? = null, val historial: List<HistorialItem> = emptyList())
@Serializable data class SalidaEnviada(val canal: String, val estado: String? = null, val destino: String? = null)
@Serializable data class RespuestaSalidas(val salidas: List<SalidaEnviada> = emptyList())
@Serializable data class ContratoNuevo(val id: Long, val folio: String, val estado: String)

// ── Incidentes ──
@Serializable data class Incidente(
    val id: Long, val folio: String, val tipo: String, val estado: String,
    val descripcion: String? = null,
    val patente: String? = null, val marca: String? = null, val modelo: String? = null,
    @SerialName("cliente_nombre") val clienteNombre: String? = null,
    @SerialName("reserva_folio") val reservaFolio: String? = null,
    @SerialName("reserva_id") val reservaId: Long? = null,
    val presupuesto: Long? = null,
    @SerialName("monto_cliente") val montoCliente: Long? = null,
    @SerialName("creado_en") val creadoEn: String? = null,
    @SerialName("creado_por_nombre") val creadoPorNombre: String? = null,
)
@Serializable data class ListaIncidentes(val incidentes: List<Incidente> = emptyList(), val conteo: Map<String, Int> = emptyMap())
@Serializable data class EventoIncidente(val tipo: String? = null, val detalle: String? = null, val usuario: String? = null, @SerialName("creado_en") val creadoEn: String? = null)
@Serializable data class Adjunto(val id: Long, val tipo: String? = null, val nombre: String? = null, val mime: String? = null)
@Serializable data class FichaIncidente(
    val id: Long, val folio: String, val tipo: String, val estado: String,
    val descripcion: String? = null, val patente: String? = null, val marca: String? = null, val modelo: String? = null,
    @SerialName("cliente_nombre") val clienteNombre: String? = null,
    @SerialName("reserva_folio") val reservaFolio: String? = null,
    @SerialName("reserva_id") val reservaId: Long? = null,
    val presupuesto: Long? = null, val deducible: Long? = null,
    @SerialName("monto_cliente") val montoCliente: Long? = null,
    @SerialName("creado_en") val creadoEn: String? = null,
    val eventos: List<EventoIncidente> = emptyList(),
    val danos: List<Dano> = emptyList(),
    val adjuntos: List<Adjunto> = emptyList(),
)
@Serializable data class IncidenteCreado(val id: Long, val folio: String)

// ── App ──
@Serializable data class VersionAndroid(val minima: String? = null, val mensaje: String? = null)
@Serializable data class VersionMinima(val android: VersionAndroid = VersionAndroid())

/** Lee un campo cualquiera de un JsonObject como texto (para el checklist). */
fun JsonElement?.textoONulo(): String? = (this as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString || it.toString() != "null" }?.content
