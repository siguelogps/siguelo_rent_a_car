// Datos de prueba de reservas, clientes y contratos: un contrato firmado (PDF real con QR) para una reserva en curso,
// un contrato pendiente de firma para una confirmada y documentos de ejemplo de una clienta.
import { q, uno } from '../db.js';
import { formatearRut } from '../util/rut.js';
import { guardarArchivo } from '../almacenamiento/index.js';
import { generarContrato, firmarContrato } from '../contratos/index.js';
import { firmaDemo, documentoDemo } from '../contratos/imagenes-demo.js';

export async function sembrar(empresaId) {
  const E = empresaId;
  // Contrato firmado: reserva en curso de Camila Fuentes (SXLR27)
  const enCurso = await uno(`SELECT r.id, r.retiro_real, c.nombre, c.apellidos, c.documento FROM reservas r JOIN clientes c ON c.id = r.cliente_id JOIN vehiculos v ON v.id = r.vehiculo_id
      WHERE r.empresa_id = $1 AND r.estado = 'en_curso' AND v.patente = 'SXLR27' LIMIT 1`, [E]);
  if (enCurso) {
    // El contrato se genera y firma en el mesón antes de entregar el auto: fechado con la hora de sembrar quedaba
    // posterior al retiro (contrato 18-10 para una entrega del 16-10).
    const firmado = new Date(new Date(enCurso.retiro_real).getTime() - 20 * 6e4), generado = new Date(firmado.getTime() - 15 * 6e4);
    const c = await generarContrato(E, enCurso.id, null, { fecha: generado });
    await q('UPDATE contratos SET creado_en = $2 WHERE id = $1', [c.id, generado]);
    await firmarContrato({ empresaId: E, contratoId: c.id, firmaDataUrl: `data:image/png;base64,${firmaDemo(2).toString('base64')}`, firmadoEn: firmado,
      nombre: `${enCurso.nombre} ${enCurso.apellidos || ''}`.trim(), documento: formatearRut(enCurso.documento), ip: '190.45.12.80', agente: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) · demo' });
    // bitácora, archivos y avisos del contrato con la misma fecha
    await q(`UPDATE bitacora SET creado_en = CASE WHEN accion = 'contrato_generado' THEN $3::timestamptz ELSE $4::timestamptz END
             WHERE empresa_id = $1 AND entidad = 'contrato' AND entidad_id = $2`, [E, c.id, generado, firmado]);
    await q(`UPDATE archivos SET creado_en = $3 WHERE empresa_id = $1 AND entidad = 'contrato' AND entidad_id = $2`, [E, c.id, firmado]);
    await q(`UPDATE salidas SET creado_en = $3 WHERE empresa_id = $1 AND entidad = 'contrato' AND entidad_id = $2`, [E, c.id, new Date(firmado.getTime() + 6e4)]);
  }
  // Contrato pendiente de firma: reserva confirmada de John Miller
  const conf = await uno(`SELECT r.id FROM reservas r JOIN clientes c ON c.id = r.cliente_id WHERE r.empresa_id = $1 AND r.estado = 'confirmada' AND c.documento = '584392017' LIMIT 1`, [E]);
  if (conf) await generarContrato(E, conf.id, null);

  // Documentos de ejemplo de Valentina Soto (subidos desde el portal)
  const val = await uno(`SELECT id FROM clientes WHERE empresa_id = $1 AND documento = '16482903-0'`, [E]);
  if (val) {
    for (const tipo of ['cedula_frente', 'cedula_reverso', 'licencia']) {
      const a = await guardarArchivo({ empresaId: E, entidad: 'cliente', entidadId: val.id, tipo, nombre: `${tipo}.png`, mime: 'image/png', datos: documentoDemo(tipo), meta: { origen: 'portal' } });
      await q(`UPDATE archivos SET creado_en = now() - interval '2 days' WHERE id = $1`, [a.id]);
    }
  }
}
