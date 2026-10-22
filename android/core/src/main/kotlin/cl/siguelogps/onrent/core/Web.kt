// Módulos que se usan en el computador: la app los abre en el navegador (el sistema web de siempre).
package cl.siguelogps.onrent.core

data class ModuloWeb(val modulo: String, val nombre: String, val ruta: String, val detalle: String)

object Web {
    val MODULOS = listOf(
        ModuloWeb("reservas", "Calendario de reservas", "/reservas", "Crear y mover reservas, disponibilidad"),
        ModuloWeb("clientes", "Clientes", "/clientes", "Fichas, documentos y conductores"),
        ModuloWeb("contratos", "Contratos", "/contratos", "Listado y búsqueda de contratos"),
        ModuloWeb("pagos", "Pagos y garantías", "/pagos", "Cobros, retenciones y devoluciones"),
        ModuloWeb("liquidaciones", "Liquidaciones", "/liquidaciones", "Cierre de cada arriendo"),
        ModuloWeb("facturacion", "Facturación", "/facturacion", "Boletas y facturas"),
        ModuloWeb("mantencion", "Mantención", "/mantencion", "Órdenes de trabajo y taller"),
        ModuloWeb("gps", "Plataforma GPS", "/gps", "Mapa de la flota, alertas e inmovilización"),
        ModuloWeb("tag_multas", "TAG y multas", "/tag-multas", "Pasadas TAG y multas por contrato"),
        ModuloWeb("tarifas", "Tarifas", "/tarifas", "Precios, temporadas y descuentos"),
        ModuloWeb("reportes", "Reportes", "/reportes", "Indicadores y planillas"),
        ModuloWeb("configuracion", "Configuración", "/configuracion", "Empresa, sucursales, usuarios e integraciones"),
    )

    /** Los que el usuario puede ver según su rol y el plan contratado (el servidor igual los vuelve a revisar). */
    fun disponibles(yo: Yo): List<ModuloWeb> = MODULOS.filter { yo.puede(it.modulo) }

    const val PRIVACIDAD = "/privacidad"
    const val SOPORTE = "/soporte"
    const val ELIMINAR_CUENTA = "/privacidad#eliminar-cuenta"
}
