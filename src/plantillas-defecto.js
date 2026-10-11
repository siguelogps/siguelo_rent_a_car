// Plantillas iniciales de cada empresa (editables en Configuración › Plantillas). Variables con {{...}}.
export const CONTRATO_ESTANDAR = `CONTRATO DE ARRIENDO DE VEHÍCULO N° {{contrato.folio}}

En {{sucursal_retiro.ciudad}}, a {{hoy}}, entre {{empresa.razon_social}}, RUT {{empresa.rut}}, domiciliada en {{empresa.direccion}}, {{empresa.comuna}} (en adelante «el Arrendador»), y {{cliente.nombre_completo}}, {{cliente.documento_tipo}} {{cliente.documento}}, domiciliado en {{cliente.direccion}} (en adelante «el Arrendatario»), se acuerda el siguiente contrato:

PRIMERO · VEHÍCULO. El Arrendador entrega en arriendo el vehículo marca {{vehiculo.marca}}, modelo {{vehiculo.modelo}}, año {{vehiculo.anio}}, color {{vehiculo.color}}, patente {{vehiculo.patente}}, con {{vehiculo.km}} km y {{vehiculo.combustible}} de combustible, en el estado descrito en el acta de entrega con fotografías, que forma parte de este contrato.

SEGUNDO · PLAZO. El arriendo comienza el {{reserva.inicio}} en {{sucursal_retiro.nombre}} y termina el {{reserva.fin}} en {{sucursal_devolucion.nombre}}. La devolución posterior a la hora pactada, superada una tolerancia de {{ajustes.tolerancia_min}} minutos, se cobra como día adicional.

TERCERO · PRECIO. El precio total es {{reserva.total}} (IVA incluido), según el detalle: {{reserva.detalle}}. Incluye {{reserva.km_incluidos}}. El kilómetro adicional se cobra a {{reserva.precio_km_extra}}.

CUARTO · GARANTÍA. El Arrendatario constituye una garantía de {{reserva.garantia}}, mediante preautorización de tarjeta o el medio acordado, que se liberará al término del arriendo, descontados los cargos pendientes.

QUINTO · COMBUSTIBLE Y LIMPIEZA. El vehículo debe devolverse con el mismo nivel de combustible. El faltante se cobra al valor del litro más un cargo de servicio. Si requiere lavado especial, se cobra según tarifa vigente.

SEXTO · TAG, MULTAS E INFRACCIONES. Son de cargo del Arrendatario los tránsitos por autopistas con TAG, estacionamientos, multas e infracciones cursadas durante el período de arriendo, aun cuando se notifiquen con posterioridad. El Arrendador podrá cobrarlos con cargo a la garantía o a los medios de pago registrados, informando el detalle.

SÉPTIMO · DAÑOS Y DEDUCIBLE. En caso de daños, accidente o robo, el Arrendatario responde hasta el deducible de {{reserva.deducible}} por evento, salvo dolo, culpa grave, conducción bajo la influencia del alcohol o drogas, o uso por conductores no autorizados, casos en que responde por el total.

OCTAVO · USO DEL VEHÍCULO. El vehículo solo podrá ser conducido por el Arrendatario y los conductores adicionales autorizados: {{conductores}}. No puede salir del país sin autorización escrita. El vehículo cuenta con sistema de localización GPS, que el Arrendatario declara conocer y aceptar.

NOVENO · CONDICIONES ADICIONALES. {{condiciones_adicionales}}

Firmado electrónicamente en conformidad. Este documento puede verificarse con el código QR o en {{url_verificacion}}.`;

export function plantillasPorDefecto() {
  return [
    { tipo: 'contrato', clave: 'contrato_estandar', nombre: 'Contrato de arriendo estándar', cuerpo: CONTRATO_ESTANDAR },
    { tipo: 'correo', clave: 'reserva_confirmada', nombre: 'Reserva confirmada', asunto: 'Tu reserva {{reserva.folio}} está confirmada · {{empresa.nombre}}',
      cuerpo: 'Hola {{cliente.nombre}}:\n\nTu reserva {{reserva.folio}} está confirmada.\nRetiro: {{reserva.inicio}} en {{sucursal_retiro.nombre}}.\nDevolución: {{reserva.fin}} en {{sucursal_devolucion.nombre}}.\nTotal: {{reserva.total}}.\n\nPuedes subir tus documentos y ver tu reserva aquí: {{url_portal}}\n\n{{empresa.nombre}} · {{empresa.telefono}}' },
    { tipo: 'whatsapp', clave: 'reserva_confirmada', nombre: 'Reserva confirmada', cuerpo: 'Hola {{cliente.nombre}}, tu reserva {{reserva.folio}} en {{empresa.nombre}} está confirmada: retiro {{reserva.inicio}} en {{sucursal_retiro.nombre}}. Sube tus documentos aquí: {{url_portal}}' },
    { tipo: 'correo', clave: 'contrato_firmado', nombre: 'Contrato firmado', asunto: 'Contrato {{contrato.folio}} · {{empresa.nombre}}',
      cuerpo: 'Hola {{cliente.nombre}}:\n\nAdjuntamos tu contrato de arriendo {{contrato.folio}} firmado. Puedes verificarlo en {{url_verificacion}}.\n\n¡Buen viaje!\n{{empresa.nombre}}' },
    { tipo: 'whatsapp', clave: 'contrato_firmado', nombre: 'Contrato firmado', cuerpo: 'Hola {{cliente.nombre}}, este es tu contrato {{contrato.folio}} de {{empresa.nombre}}: {{url_contrato}} ¡Buen viaje!' },
    { tipo: 'correo', clave: 'liquidacion', nombre: 'Liquidación del arriendo', asunto: 'Liquidación de tu arriendo {{reserva.folio}} · {{empresa.nombre}}',
      cuerpo: 'Hola {{cliente.nombre}}:\n\nTu arriendo {{reserva.folio}} quedó liquidado.\nCargos adicionales: {{liquidacion.total_cargos}}.\nGarantía liberada: {{liquidacion.garantia_liberada}}.\n\nDetalle:\n{{liquidacion.detalle}}\n\nGracias por preferirnos.\n{{empresa.nombre}}' },
    { tipo: 'whatsapp', clave: 'liquidacion', nombre: 'Liquidación del arriendo', cuerpo: 'Hola {{cliente.nombre}}, tu arriendo {{reserva.folio}} quedó liquidado. Cargos: {{liquidacion.total_cargos}}. Garantía liberada: {{liquidacion.garantia_liberada}}. Gracias por preferir {{empresa.nombre}}.' },
    { tipo: 'correo', clave: 'cargo_tag_multa', nombre: 'Aviso de TAG o multa', asunto: 'Cargos de TAG y multas de tu arriendo {{reserva.folio}} · {{empresa.nombre}}',
      cuerpo: 'Hola {{cliente.nombre}}:\n\nDurante tu arriendo {{reserva.folio}} ({{vehiculo.patente}}) se registraron los siguientes cargos:\n{{detalle}}\n\nTotal: {{total}}.\nSegún la cláusula sexta del contrato, se cobrarán con cargo a tu garantía o medio de pago registrado.\n\n{{empresa.nombre}}' },
    { tipo: 'whatsapp', clave: 'cargo_tag_multa', nombre: 'Aviso de TAG o multa', cuerpo: 'Hola {{cliente.nombre}}, en tu arriendo {{reserva.folio}} ({{vehiculo.patente}}) se registraron cargos de TAG/multas por {{total}}. Te enviamos el detalle por correo. {{empresa.nombre}}' },
    { tipo: 'correo', clave: 'recordatorio_devolucion', nombre: 'Recordatorio de devolución', asunto: 'Mañana devuelves tu vehículo · {{empresa.nombre}}',
      cuerpo: 'Hola {{cliente.nombre}}:\n\nTe recordamos que la devolución de {{vehiculo.patente}} es el {{reserva.fin}} en {{sucursal_devolucion.nombre}}. Recuerda devolverlo con el mismo nivel de combustible.\n\n{{empresa.nombre}}' }
  ];
}
