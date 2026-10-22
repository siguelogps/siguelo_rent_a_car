// Baja de un cliente (22-oct, espec. Backoffice): al darla se apagan las integraciones y se borran sus secretos; el
// cliente tiene 90 días para revisar y exportar sus datos (entra en solo lectura). Vencido el plazo, esta tarea los
// anonimiza: personas (usuarios, clientes, conductores), archivos y mensajes. Quedan las cifras (reservas, contratos,
// pagos) sin datos personales, para la contabilidad de Síguelo. Nada se hace antes del plazo.
import { q } from '../db.js';
import { borrarArchivo } from '../almacenamiento/index.js';

export const DIAS_EXPORTAR = 90;

export async function anonimizarEmpresa(empresaId) {
  const archivos = await q('SELECT id FROM archivos WHERE empresa_id = $1', [empresaId]);
  for (const a of archivos) await borrarArchivo(empresaId, a.id).catch(() => {});
  await q('DELETE FROM sesiones WHERE usuario_id IN (SELECT id FROM usuarios WHERE empresa_id = $1)', [empresaId]);
  await q('DELETE FROM dispositivos WHERE empresa_id = $1', [empresaId]).catch(() => {});
  await q(`UPDATE usuarios SET nombre = 'Usuario eliminado', correo = 'eliminado-' || id || '@cuentas.invalid', telefono = NULL, clave_hash = NULL,
             invitacion_hash = NULL, activo = false WHERE empresa_id = $1`, [empresaId]);
  await q(`UPDATE clientes SET nombre = 'Cliente eliminado', apellidos = NULL, documento = 'eliminado-' || id, correo = NULL, telefono = NULL, direccion = NULL,
             fecha_nacimiento = NULL, licencia_numero = NULL, notas = NULL, razon_social = NULL WHERE empresa_id = $1`, [empresaId]);
  await q(`UPDATE conductores SET nombre = 'Conductor eliminado', documento = NULL, fecha_nacimiento = NULL, licencia_numero = NULL WHERE empresa_id = $1`, [empresaId]);
  await q(`DELETE FROM salidas WHERE empresa_id = $1`, [empresaId]);
  await q(`DELETE FROM integraciones WHERE empresa_id = $1`, [empresaId]);
  await q(`UPDATE empresas SET datos_eliminados_en = now() WHERE id = $1`, [empresaId]);
  await q(`INSERT INTO bitacora (empresa_id, accion, entidad, entidad_id, detalle) VALUES ($1, 'datos_anonimizados', 'empresa', $1, '{}')`, [empresaId]);
}

export async function procesarBajasVencidas() {
  const vencidas = await q(`SELECT id FROM empresas WHERE estado = 'baja' AND datos_eliminados_en IS NULL AND exportar_hasta < (now() AT TIME ZONE 'America/Santiago')::date`);
  for (const e of vencidas) await anonimizarEmpresa(e.id);
  return vencidas.length;
}
