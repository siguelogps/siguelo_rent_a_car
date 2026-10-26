// Ingreso con el correo y la clave de siempre (los mismos de la web). Abajo, los enlaces que exigen las tiendas.
package cl.siguelogps.onrent.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cl.siguelogps.onrent.R

/**
 * Logo «Síguelo GPS + On Rent» aprobado por Pablo el 26-oct: apilado (B) en el ingreso y en «Actualiza la app»,
 * horizontal (A) en la cabecera de las pestañas, donde la fila es ancha y baja. Va siempre la versión de letras blancas
 * porque la cabecera (c.cabecera) es oscura en los dos temas; por eso no hace falta drawable-night. Son archivos nuevos:
 * el logo oficial (logo_siguelo, pin_siguelo) no se toca.
 */
@Composable
fun MarcaOnRent(modifier: Modifier = Modifier, apilado: Boolean = false) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        if (apilado) Image(painterResource(R.drawable.logo_onrent_b_oscuro), contentDescription = "Síguelo GPS · On Rent", modifier = Modifier.height(56.dp), contentScale = ContentScale.Fit)
        else Image(painterResource(R.drawable.logo_onrent_a_oscuro), contentDescription = "Síguelo GPS · On Rent", modifier = Modifier.height(24.dp), contentScale = ContentScale.Fit)
    }
}

@Composable
fun PantallaIngreso(correoInicial: String?, cargando: Boolean, error: String?, onIngresar: (String, String) -> Unit, onEnlace: (String) -> Unit) {
    var correo by rememberSaveable { mutableStateOf(correoInicial.orEmpty()) }
    var clave by rememberSaveable { mutableStateOf("") }
    Column(Modifier.fillMaxSize().background(c.fondo).verticalScroll(rememberScrollState()).imePadding()) {
        Column(Modifier.fillMaxWidth().background(c.cabecera).statusBarsPadding().padding(horizontal = 24.dp, vertical = 28.dp)) {
            MarcaOnRent(apilado = true)
            Spacer(Modifier.height(18.dp))
            Txt("Entregas, devoluciones", color = c.sobreCabecera, size = 28.sp, peso = FontWeight.SemiBold, alto = 34.sp)
            Txt("y flota en el teléfono", color = c.marca, size = 28.sp, peso = FontWeight.Bold, alto = 34.sp)
            Spacer(Modifier.height(10.dp))
            Txt("Ingresa con el mismo correo y clave del sistema.", color = c.cabeceraTenue, size = 15.sp)
        }
        Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Campo(correo, { correo = it.trim() }, etiqueta = "Correo", ayuda = "nombre@empresa.cl", teclado = KeyboardType.Email)
            Campo(clave, { clave = it }, etiqueta = "Clave", teclado = KeyboardType.Password, clave = true)
            if (error != null) Aviso(error, Tono.ERROR)
            Boton("Ingresar", Modifier.fillMaxWidth(), TipoBoton.PRIMARIO, cargando = cargando) { onIngresar(correo, clave) }
            Muted("¿Olvidaste tu clave? Pídele una nueva al administrador de tu empresa (Configuración → Usuarios).", size = 13.sp)
        }
        Spacer(Modifier.weight(1f))
        Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(20.dp), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            Enlace("Privacidad") { onEnlace("/privacidad") }
            Enlace("Soporte") { onEnlace("/soporte") }
        }
    }
}

@Composable
fun Enlace(texto: String, onClick: () -> Unit) =
    Txt(texto, Modifier.clickable(role = Role.Button, onClick = onClick).padding(vertical = 6.dp), color = c.tinta2, size = 14.sp, peso = FontWeight.Medium)
