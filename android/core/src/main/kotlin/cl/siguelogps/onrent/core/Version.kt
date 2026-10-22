// Versión mínima: el servidor puede exigir una versión (Backoffice › Apps con marca › App Síguelo On Rent).
package cl.siguelogps.onrent.core

object Versiones {
    /** Compara «1.0.42» con «1.0.9» número a número (no como texto). Sufijos como «-prueba» se ignoran. */
    fun comparar(a: String, b: String): Int {
        fun partes(v: String) = v.substringBefore('-').split('.').map { it.trim().toIntOrNull() ?: 0 }
        val x = partes(a); val y = partes(b)
        for (i in 0 until maxOf(x.size, y.size)) {
            val c = (x.getOrElse(i) { 0 }).compareTo(y.getOrElse(i) { 0 })
            if (c != 0) return c
        }
        return 0
    }

    /** ¿Hay que actualizar? Sin mínima (o la app de desarrollo «1.0-dev») nunca se bloquea. */
    fun debeActualizar(actual: String, minima: String?): Boolean {
        if (minima.isNullOrBlank() || actual.contains("dev")) return false
        return comparar(actual, minima) < 0
    }
}
