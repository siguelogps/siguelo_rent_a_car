// Datos de prueba de pagos, garantías, liquidación y facturación (módulos 7 y 8).
// - Pagos de arriendo (Webpay simulado, efectivo, transferencia) para reservas confirmadas, en curso, devueltas y cerradas.
// - Garantías retenidas (Visa ···· 4821) para reservas en curso y algunas confirmadas; una solicitada.
// - Reserva cerrada con liquidación cobrada y boleta emitida (folio de prueba).
// - R-1008 (devuelta) queda pendiente de liquidación con inspecciones de entrega y devolución, TAG y un incidente.
import { q, siguienteFolio } from '../db.js';
import { desglosar } from '../facturacion/calculo.js';

const DIA = 864e5;
const json = (o) => JSON.stringify(o);

export async function sembrar(E) {
  const reservas = await q(`SELECT r.*, c.nombre, c.apellidos, c.documento, c.documento_tipo, c.tipo AS cliente_tipo FROM reservas r LEFT JOIN clientes c ON c.id = r.cliente_id
                             WHERE r.empresa_id = $1 ORDER BY r.id`, [E]);
  const [admin] = await q(`SELECT id FROM usuarios WHERE empresa_id = $1 AND rol = 'administrador' ORDER BY id LIMIT 1`, [E]);
  const [counter] = await q(`SELECT id FROM usuarios WHERE empresa_id = $1 AND rol = 'counter' ORDER BY id LIMIT 1`, [E]);
  const U = counter?.id || admin?.id || null;
  const [emp] = await q('SELECT ajustes FROM empresas WHERE id = $1', [E]);
  const diasRet = Number(emp?.ajustes?.garantia_dias_retencion) || 30;

  let n = 0;
  const pago = async (r, o) => {
    n++;
    const creado = o.creado || new Date(new Date(r.creado_en).getTime() + n * 3600e3);
    const [p] = await q(`INSERT INTO pagos (empresa_id, reserva_id, cliente_id, concepto, metodo, estado, monto, monto_capturado, monto_liberado, referencia, token_externo, autorizacion, tarjeta, vence_retencion, detalle, registrado_por, creado_en, actualizado_en)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17) RETURNING *`,
      [E, r.id, r.cliente_id, o.concepto, o.metodo, o.estado, o.monto, o.capturado || 0, o.liberado || 0, o.referencia || `RC${E}P${n}DEMO`, o.token || null, o.autorizacion || null, o.tarjeta || null,
        o.vence || null, json({ demo: true, ...(o.detalle || {}) }), o.usuario ?? U, creado]);
    return p;
  };
  const metodoArriendo = (r, i) => (r.origen === 'portal' ? 'webpay' : ['webpay', 'efectivo', 'transferencia', 'pos'][i % 4]);
  const auth = () => String(100000 + Math.floor(Math.random() * 899999));

  let i = 0;
  for (const r of reservas) {
    if (!['confirmada', 'en_curso', 'devuelta', 'cerrada'].includes(r.estado)) continue;
    i++;
    // Arriendo: pagado completo (la última confirmada queda con enlace pendiente)
    const m = metodoArriendo(r, i);
    const pendiente = r.estado === 'confirmada' && i % 5 === 0;
    if (pendiente) {
      await pago(r, { concepto: 'arriendo', metodo: 'webpay', estado: 'pendiente', monto: r.total, detalle: { enlace: true, diferido: false } });
    } else if (m === 'webpay') {
      await pago(r, { concepto: 'arriendo', metodo: 'webpay', estado: 'simulado', monto: r.total, autorizacion: `SIM-${String(n + 1).padStart(6, '0')}`, detalle: { simulado: true, motivo_simulado: 'Marcha blanca activa' } });
    } else {
      await pago(r, { concepto: 'arriendo', metodo: m, estado: 'pagado', monto: r.total, referencia: m === 'transferencia' ? `TRF ${auth()}` : m === 'pos' ? `POS ${auth()}` : null, tarjeta: m === 'pos' ? '7310' : null, detalle: { manual: true } });
    }
    // Garantía
    if (!r.garantia) continue;
    const retenidaEn = new Date(Math.min(Date.now() - 3600e3, r.retiro_real ? new Date(r.retiro_real).getTime() : new Date(r.inicio).getTime() - 2 * DIA));
    const vence = new Date(retenidaEn.getTime() + diasRet * DIA);
    if (r.estado === 'en_curso' || r.estado === 'devuelta' || (r.estado === 'confirmada' && i % 3 === 0)) {
      await pago(r, { concepto: 'garantia', metodo: 'webpay', estado: 'retenido', monto: r.garantia, autorizacion: auth(), tarjeta: '4821', vence, token: `demo${r.id}${Date.now().toString(36)}`, creado: retenidaEn, detalle: { diferido: true, tipo_pago: 'Crédito', marca: 'Visa' } });
    } else if (r.estado === 'confirmada' && i % 3 === 1) {
      await pago(r, { concepto: 'garantia', metodo: 'webpay', estado: 'pendiente', monto: r.garantia, detalle: { diferido: true, enlace: true } });
    }
  }

  // ── Reserva cerrada: liquidación cobrada y boleta emitida ──
  const cerrada = reservas.find((r) => r.estado === 'cerrada');
  if (cerrada) {
    const g = await pago(cerrada, { concepto: 'garantia', metodo: 'webpay', estado: 'capturado', monto: cerrada.garantia || 300000, capturado: 35860, liberado: (cerrada.garantia || 300000) - 35860, autorizacion: auth(), tarjeta: '4821',
      creado: new Date(cerrada.inicio), vence: new Date(new Date(cerrada.inicio).getTime() + diasRet * DIA), detalle: { diferido: true, simulado: true, captura_simulada: true, motivo_simulado: 'Marcha blanca activa', captura_motivo: 'Liquidación' } });
    const lineas = [
      { codigo: 'atraso', concepto: 'Día extra por atraso', calculo: 'Devolvió dentro de la tolerancia de 59 min', origen: 'Check-in', monto: 0, monto_calculado: 0, incluir: false, editado: false, motivo: null },
      { codigo: 'km_extra', concepto: 'Kilómetros extra', calculo: '612 km recorridos de 500 incluidos = 112 km × $150', origen: 'Plataforma GPS', monto: 16800, monto_calculado: 16800, incluir: true, editado: false, motivo: null },
      { codigo: 'combustible', concepto: 'Combustible faltante', calculo: '1/8 de 35 L ≈ 4 L × $1.390 + cargo de servicio $5.000', origen: 'Plataforma GPS', monto: 10560, monto_calculado: 10560, incluir: true, editado: false, motivo: null },
      { codigo: 'tag', concepto: 'TAG', calculo: '6 tránsitos · Autopista Central, Costanera Norte', origen: 'Importación TAG', monto: 8500, monto_calculado: 8500, incluir: true, editado: false, motivo: null, ids: [] },
      { codigo: 'multas', concepto: 'Multas', calculo: 'Ninguna registrada a la fecha · se pueden cargar hasta 90 días después', origen: 'Importación multas', monto: 0, monto_calculado: 0, incluir: false, editado: false, motivo: null, ids: [] },
      { codigo: 'lavado', concepto: 'Lavado', calculo: 'Limpieza: «requiere lavado» en la devolución', origen: 'Check-in', monto: 0, monto_calculado: 15000, incluir: false, editado: true, motivo: 'Cliente frecuente: se condona el lavado' }
    ];
    const total = 35860;
    const folio = await siguienteFolio(E, 'LQ');
    const aprobado = new Date(new Date(cerrada.fin).getTime() + 5 * 3600e3);
    const [lq] = await q(`INSERT INTO liquidaciones (empresa_id, reserva_id, folio, estado, lineas, total_cargos, garantia_retenida, garantia_capturada, garantia_liberada, saldo_por_cobrar, aprobado_por, aprobado_en, opciones, creado_en, actualizado_en)
                          VALUES ($1,$2,$3,'cobrada',$4,$5,$6,$7,$8,0,$9,$10,$11,$10,$10) ON CONFLICT (reserva_id) DO NOTHING RETURNING id`,
      [E, cerrada.id, folio, json(lineas), total, g.monto, total, g.monto - total, admin?.id || null, aprobado, json({ documento: 'boleta', simulado: true })]);
    if (lq) {
      const t = desglosar(total);
      const rec = { rut: cerrada.documento_tipo === 'rut' ? cerrada.documento : '66666666-6', razonSocial: [cerrada.nombre, cerrada.apellidos].filter(Boolean).join(' ') };
      await q(`INSERT INTO dte_folios (empresa_id, tipo, desde, hasta, siguiente) VALUES ($1, 39, 1, 500, 2) ON CONFLICT (empresa_id, tipo) DO NOTHING`, [E]);
      await q(`INSERT INTO documentos_tributarios (empresa_id, reserva_id, liquidacion_id, tipo, folio, estado, receptor, lineas, neto, iva, exento, total, track_id, respuesta, ambiente, creado_por, creado_en, emitido_en)
               VALUES ($1,$2,$3,39,1,'aceptado',$4,$5,$6,$7,0,$8,'DEMO-0001',$9,'certificacion',$10,$11,$11)`,
        [E, cerrada.id, lq.id, json(rec), json(lineas.filter((l) => l.incluir && l.monto > 0).map((l) => ({ nombre: l.concepto, descripcion: l.calculo, cantidad: 1, precio: l.monto, monto: l.monto }))),
          t.neto, t.iva, t.total, json({ simulado: true, nota: 'Folio de prueba (datos de demostración)' }), admin?.id || null, aprobado]);
    }
    await q(`INSERT INTO bitacora (empresa_id, usuario_id, accion, entidad, entidad_id, detalle, creado_en) VALUES ($1,$2,'liquidacion_aprobada','liquidacion',$3,$4,$5)`,
      [E, admin?.id || null, lq?.id || null, json({ total, demo: true }), aprobado]);
  }

  // ── Factura del arriendo de la empresa cliente, retenida por marcha blanca ──
  const emp2 = reservas.find((r) => r.cliente_tipo === 'empresa' && r.estado === 'en_curso');
  if (emp2) {
    const [c] = await q('SELECT * FROM clientes WHERE id = $1', [emp2.cliente_id]);
    const t = desglosar(emp2.total);
    const neto = t.neto;
    await q(`INSERT INTO documentos_tributarios (empresa_id, reserva_id, tipo, estado, receptor, lineas, neto, iva, exento, total, mensaje, creado_por, creado_en)
             VALUES ($1,$2,33,'retenido',$3,$4,$5,$6,0,$7,'Retenido por marcha blanca: se emitirá al desactivarla (Configuración › Integraciones).',$8, now() - interval '2 days')`,
      [E, emp2.id, json({ rut: c.documento, razonSocial: c.razon_social || c.nombre, giro: c.giro || 'Construcción', direccion: c.direccion || 'Av. Granaderos 2550', comuna: c.comuna || 'Calama', ciudad: c.ciudad || 'Calama', correo: c.correo }),
        json([{ nombre: `Arriendo ${emp2.folio}`, descripcion: (emp2.cotizacion?.lineas || [])[0]?.detalle || '', cantidad: 1, precio: neto, monto: neto }]), neto, t.iva, t.total, admin?.id || null]);
  }

  // ── R-1008 devuelta: pendiente de liquidación, con datos para el cálculo ──
  const dev = reservas.find((r) => r.estado === 'devuelta');
  if (dev && dev.vehiculo_id) {
    const [v] = await q('SELECT km FROM vehiculos WHERE id = $1', [dev.vehiculo_id]);
    const devolucion = new Date(new Date(dev.fin).getTime() + 104 * 6e4); // devolvió 1 h 44 min tarde
    await q('UPDATE reservas SET devolucion_real = $2 WHERE id = $1', [dev.id, devolucion]);
    const kmDev = v?.km || 48320, kmEnt = kmDev - 1554;
    const insp = (tipo, km, comb, checklist, cuando) => q(`INSERT INTO inspecciones (empresa_id, reserva_id, vehiculo_id, tipo, estado, km, km_gps, combustible, combustible_gps, checklist, sucursal_id, realizado_por, iniciado_en, completado_en, firmante_nombre)
        VALUES ($1,$2,$3,$4,'completa',$5,$5,$6,$6,$7,$8,$9,$10,$10,$11) ON CONFLICT (reserva_id, tipo) DO NOTHING`,
      [E, dev.id, dev.vehiculo_id, tipo, km, comb, json(checklist), dev.sucursal_retiro_id, U, cuando, [dev.nombre, dev.apellidos].filter(Boolean).join(' ')]);
    await insp('entrega', kmEnt, 8, { repuesto: true, gata: true, triangulos: 2, extintor: true, documentos: true, tag: true, limpieza: 'ok' }, new Date(dev.inicio));
    await insp('devolucion', kmDev, 5, { repuesto: true, gata: true, triangulos: 1, extintor: true, documentos: true, tag: true, limpieza: 'sucio' }, devolucion);
    const [veh] = await q('SELECT patente FROM vehiculos WHERE id = $1', [dev.vehiculo_id]);
    const tags = [['Autopista Central', 'Pórtico P5 Lo Espejo', 1840], ['Costanera Norte', 'Pórtico Kennedy', 2210], ['Vespucio Sur', 'Pórtico La Florida', 1530], ['Autopista Central', 'Pórtico P3 San Bernardo', 1840], ['Costanera Norte', 'Pórtico Lo Saldes', 2210]];
    for (const [k, [autopista, portico, monto]] of tags.entries()) {
      await q(`INSERT INTO tag_transitos (empresa_id, patente, vehiculo_id, fecha_hora, portico, autopista, concesionaria, monto, origen, huella, reserva_id, estado)
               VALUES ($1,$2,$3,$4,$5,$6,$6,$7,'dashboard',$8,$9,'asignado') ON CONFLICT (empresa_id, huella) DO NOTHING`,
        [E, veh.patente, dev.vehiculo_id, new Date(new Date(dev.inicio).getTime() + (k + 1) * 0.6 * DIA), portico, autopista, monto, `demo-liq-${dev.id}-${k}`, dev.id]);
    }
    const folioInc = await siguienteFolio(E, 'INC');
    await q(`INSERT INTO incidentes (empresa_id, folio, reserva_id, vehiculo_id, cliente_id, tipo, estado, descripcion, presupuesto, taller, deducible, creado_por)
             VALUES ($1,$2,$3,$4,$5,'dano','presupuestado','abolladura puerta del. der.',280000,'Desabolladuría Sur',$6,$7)`,
      [E, folioInc, dev.id, dev.vehiculo_id, dev.cliente_id, dev.deducible || 450000, U]);
  }
}
