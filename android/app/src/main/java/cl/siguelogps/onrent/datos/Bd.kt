// Base local (Room): lo último que se leyó del servidor (para trabajar sin señal), los borradores de entrega y
// devolución y la cola de envíos. Nada de esto se copia a la nube (ver xml/extraccion_datos.xml).
package cl.siguelogps.onrent.datos

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

/** Respuesta guardada de una lectura (agenda, flota, ficha de reserva…) o un borrador, en JSON. */
@Entity(tableName = "guardado")
data class Guardado(@PrimaryKey val clave: String, val json: String, val actualizado: Long)

/** Un envío en la cola: «inspeccion» (EnvioInspeccion) o «incidente» (EnvioIncidente), en JSON. */
@Entity(tableName = "pendiente")
data class Pendiente(
    @PrimaryKey val uuid: String,
    val tipo: String,
    val titulo: String,
    val json: String,
    /** por_enviar · error · enviado */
    val estado: String = "por_enviar",
    val error: String? = null,
    val resultado: String? = null,
    val reservaId: Long? = null,
    val creado: Long = System.currentTimeMillis(),
    val actualizado: Long = System.currentTimeMillis(),
)

@Dao
interface DaoGuardado {
    @Query("SELECT * FROM guardado WHERE clave = :clave") suspend fun leer(clave: String): Guardado?
    @Upsert suspend fun guardar(g: Guardado)
    @Query("DELETE FROM guardado WHERE clave = :clave") suspend fun borrar(clave: String)
    @Query("DELETE FROM guardado") suspend fun borrarTodo()
}

@Dao
interface DaoPendiente {
    @Query("SELECT * FROM pendiente ORDER BY creado DESC") fun todos(): Flow<List<Pendiente>>
    @Query("SELECT * FROM pendiente WHERE estado = 'por_enviar' ORDER BY creado") suspend fun porEnviar(): List<Pendiente>
    @Query("SELECT * FROM pendiente WHERE uuid = :uuid") suspend fun leer(uuid: String): Pendiente?
    @Upsert suspend fun guardar(p: Pendiente)
    @Query("DELETE FROM pendiente WHERE uuid = :uuid") suspend fun borrar(uuid: String)
    @Query("DELETE FROM pendiente WHERE estado = 'enviado' AND actualizado < :antes") suspend fun limpiarEnviados(antes: Long)
    @Query("SELECT count(*) FROM pendiente WHERE estado <> 'enviado'") suspend fun sinEnviar(): Int
}

@Database(entities = [Guardado::class, Pendiente::class], version = 1, exportSchema = true)
abstract class Bd : RoomDatabase() {
    abstract fun guardado(): DaoGuardado
    abstract fun pendiente(): DaoPendiente

    companion object {
        fun abrir(ctx: Context): Bd = Room.databaseBuilder(ctx, Bd::class.java, "onrent.db").build()
    }
}
