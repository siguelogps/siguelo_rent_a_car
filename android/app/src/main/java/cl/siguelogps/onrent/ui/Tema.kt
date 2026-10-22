// Colores y letras de Síguelo On Rent: los tokens del CRM Síguelo Gestión (public/app.css) en claro, y los del modo
// oscuro de la web (rentacar.css, :root[data-theme="oscuro"]) en oscuro. Sigue el tema del teléfono.
// El amarillo de marca no cambia; la patente es una placa blanca con letras negras en los dos temas.
package cl.siguelogps.onrent.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import cl.siguelogps.onrent.R

@Immutable
data class Colores(
    val oscuro: Boolean,
    val tinta: Color, val tinta2: Color, val gris: Color, val linea: Color, val linea2: Color,
    val fondo: Color, val tarjeta: Color, val suave: Color,
    val marca: Color = Color(0xFFFFD500), val sobreMarca: Color = Color(0xFF15181D),
    val marcaSuave: Color, val marcaTexto: Color,
    val rojo: Color, val rojoSuave: Color, val verde: Color, val verdeSuave: Color,
    val azul: Color, val azulSuave: Color, val morado: Color, val moradoSuave: Color,
    val ambar: Color, val ambarSuave: Color,
    /** Cabecera oscura de las pantallas de patio (como el celular de la maqueta 03-checkout-celular). */
    val cabecera: Color, val sobreCabecera: Color, val cabeceraTenue: Color,
)

val Claro = Colores(
    oscuro = false,
    tinta = Color(0xFF15181D), tinta2 = Color(0xFF3A414C), gris = Color(0xFF5B6370), linea = Color(0xFFE2E5EA), linea2 = Color(0xFFEEF0F3),
    fondo = Color(0xFFF4F5F7), tarjeta = Color.White, suave = Color(0xFFF7F8FA),
    marcaSuave = Color(0xFFFFF7CC), marcaTexto = Color(0xFF6B4A00),
    rojo = Color(0xFFB42318), rojoSuave = Color(0xFFFDECEA), verde = Color(0xFF1E7B3A), verdeSuave = Color(0xFFE6F4EA),
    azul = Color(0xFF1E3A8A), azulSuave = Color(0xFFE8EEFC), morado = Color(0xFF581C87), moradoSuave = Color(0xFFF3E8FF),
    ambar = Color(0xFF8A3B06), ambarSuave = Color(0xFFFEF3E2),
    cabecera = Color(0xFF15181D), sobreCabecera = Color.White, cabeceraTenue = Color(0xFFB8BFC9),
)

val Oscuro = Colores(
    oscuro = true,
    tinta = Color(0xFFE8EBEF), tinta2 = Color(0xFFC5CBD3), gris = Color(0xFF9AA3AF), linea = Color(0xFF2B323C), linea2 = Color(0xFF222831),
    fondo = Color(0xFF0F1216), tarjeta = Color(0xFF1A1F26), suave = Color(0xFF151A20),
    marcaSuave = Color(0xFF3A3410), marcaTexto = Color(0xFFFFE680),
    rojo = Color(0xFFF87171), rojoSuave = Color(0xFF3B1A1A), verde = Color(0xFF4ADE80), verdeSuave = Color(0xFF15301F),
    azul = Color(0xFFA5B8F5), azulSuave = Color(0xFF1B2747), morado = Color(0xFFD8B4FE), moradoSuave = Color(0xFF2E1C40),
    ambar = Color(0xFFFCD9A8), ambarSuave = Color(0xFF3A2A12),
    cabecera = Color(0xFF1A1F26), sobreCabecera = Color(0xFFE8EBEF), cabeceraTenue = Color(0xFF9AA3AF),
)

/** Colores de los tipos de daño (public/esquema.js), iguales en los dos temas: van sobre el dibujo blanco del auto. */
val COLOR_DANO = mapOf("raya" to Color(0xFF1E3A8A), "abolladura" to Color(0xFF581C87), "trizadura" to Color(0xFFB42318), "otro" to Color(0xFF475467))

val LocalColores = staticCompositionLocalOf { Claro }
val c: Colores @Composable get() = LocalColores.current

val Plex = FontFamily(
    Font(R.font.ibm_plex_sans_regular, FontWeight.Normal),
    Font(R.font.ibm_plex_sans_medium, FontWeight.Medium),
    Font(R.font.ibm_plex_sans_semibold, FontWeight.SemiBold),
    Font(R.font.ibm_plex_sans_bold, FontWeight.Bold),
)
val PlexMono = FontFamily(Font(R.font.ibm_plex_mono_medium, FontWeight.Medium), Font(R.font.ibm_plex_mono_bold, FontWeight.Bold))

@Composable
fun TemaOnRent(oscuro: Boolean = isSystemInDarkTheme(), contenido: @Composable () -> Unit) {
    val col = if (oscuro) Oscuro else Claro
    val base = TextStyle(fontFamily = Plex, color = col.tinta)
    val tipografia = Typography(
        headlineSmall = base.copy(fontSize = 24.sp, lineHeight = 30.sp, fontWeight = FontWeight.SemiBold),
        titleLarge = base.copy(fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.SemiBold),
        titleMedium = base.copy(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold),
        bodyLarge = base.copy(fontSize = 16.sp, lineHeight = 23.sp),
        bodyMedium = base.copy(fontSize = 14.sp, lineHeight = 20.sp),
        bodySmall = base.copy(fontSize = 13.sp, lineHeight = 18.sp),
        labelLarge = base.copy(fontSize = 15.sp, fontWeight = FontWeight.SemiBold),
    )
    val esquema = if (oscuro) darkColorScheme(
        primary = col.marca, onPrimary = col.sobreMarca, background = col.fondo, onBackground = col.tinta,
        surface = col.tarjeta, onSurface = col.tinta, error = col.rojo, outline = col.linea, surfaceVariant = col.suave, onSurfaceVariant = col.gris,
    ) else lightColorScheme(
        primary = col.tinta, onPrimary = Color.White, background = col.fondo, onBackground = col.tinta,
        surface = col.tarjeta, onSurface = col.tinta, error = col.rojo, outline = col.linea, surfaceVariant = col.suave, onSurfaceVariant = col.gris,
    )
    CompositionLocalProvider(LocalColores provides col) {
        MaterialTheme(colorScheme = esquema, typography = tipografia, content = contenido)
    }
}
