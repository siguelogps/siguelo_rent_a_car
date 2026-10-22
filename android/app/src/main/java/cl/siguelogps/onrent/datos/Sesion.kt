// Sesión del personal. El token Bearer (30 días) se guarda cifrado con AES-GCM y una llave del Android Keystore que
// nunca sale del teléfono: aunque alguien copie los archivos de la app, no puede usar la sesión.
// «yo» (usuario, empresa y permisos) se guarda en claro para abrir la app sin señal: no es secreto.
package cl.siguelogps.onrent.datos

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class Sesion(ctx: Context) {
    private val prefs = ctx.getSharedPreferences("sesion", Context.MODE_PRIVATE)
    private val alias = "onrent_sesion"

    private fun llave(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    private fun cifrar(texto: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, llave())
        val datos = c.doFinal(texto.toByteArray())
        return Base64.encodeToString(c.iv, Base64.NO_WRAP) + "." + Base64.encodeToString(datos, Base64.NO_WRAP)
    }

    private fun descifrar(sobre: String): String? = try {
        val (iv, datos) = sobre.split(".", limit = 2)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, llave(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
        String(c.doFinal(Base64.decode(datos, Base64.NO_WRAP)))
    } catch (e: Exception) {
        // Llave borrada (p. ej. se quitó el bloqueo de pantalla) o dato dañado: se pide ingresar de nuevo, no se inventa.
        Log.w("Sesion", "No se pudo leer la sesión guardada: ${e.message}")
        null
    }

    var token: String?
        get() = prefs.getString("token", null)?.let { descifrar(it) }
        set(v) { prefs.edit().apply { if (v == null) remove("token") else putString("token", cifrar(v)) }.apply() }

    /** Respuesta de /api/yo en JSON. */
    var yo: String?
        get() = prefs.getString("yo", null)
        set(v) { prefs.edit().putString("yo", v).apply() }

    /** Último correo con que se ingresó (para no escribirlo de nuevo). */
    var correo: String?
        get() = prefs.getString("correo", null)
        set(v) { prefs.edit().putString("correo", v).apply() }

    /** Token de Firebase registrado en el servidor (para borrarlo al salir). */
    var fcm: String?
        get() = prefs.getString("fcm", null)
        set(v) { prefs.edit().putString("fcm", v).apply() }

    fun cerrar() { prefs.edit().remove("token").remove("yo").remove("fcm").apply() }
}
