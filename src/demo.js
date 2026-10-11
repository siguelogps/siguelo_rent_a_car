// Datos de prueba: un rentacar completo («Andes Rent a Car») con flota, tarifas, clientes y reservas alrededor de hoy.
// Usuarios (clave demo1234): demo@siguelogps.cl (administrador), counter@, patio@, finanzas@ y soporte@siguelogps.cl (superadmin).
import { q, transaccion, siguienteFolio } from './db.js';
import { hashClave } from './auth.js';
import { crearEmpresa } from './api/01-empresas.js';
import { cotizar } from './cotizador.js';
import { tokenAleatorio } from './cifrado.js';
import { desdeLocal } from './util/formato.js';

const DIA = 864e5;
const isoFecha = (ms) => new Date(ms).toISOString().slice(0, 10);

export async function sembrarDemo({ clave = 'demo1234' } = {}) {
  const e = await crearEmpresa({
    nombre: 'Andes Rent a Car', slug: 'andes-rent', rut: '76543210-3', razon_social: 'Andes Rent a Car SpA', giro: 'Arriendo de vehículos',
    direccion: 'Av. Providencia 2133, of. 401', comuna: 'Providencia', ciudad: 'Santiago', telefono: '+56 2 2345 6789', correo: 'reservas@andesrent.cl',
    sucursal: 'Aeropuerto SCL', admin_nombre: 'María José Rojas', admin_correo: 'demo@siguelogps.cl', admin_clave: clave
  });
  const E = e.id;
  const h = hashClave(clave);
  await q('UPDATE sucursales SET direccion = $2, comuna = $3, ciudad = $4, lat = -33.3968, lng = -70.7937, horario = $5 WHERE empresa_id = $1', [E, 'Aeropuerto Arturo Merino Benítez, estacionamiento 3', 'Pudahuel', 'Santiago', 'Todos los días 06:00 a 23:00']);
  const [scl] = await q('SELECT id FROM sucursales WHERE empresa_id = $1', [E]);
  const [prov] = await q(`INSERT INTO sucursales (empresa_id, nombre, direccion, comuna, ciudad, lat, lng, horario) VALUES ($1,'Providencia','Av. Providencia 2133','Providencia','Santiago',-33.4206,-70.6075,'Lun a sáb 08:30 a 19:30') RETURNING id`, [E]);
  const [pmo] = await q(`INSERT INTO sucursales (empresa_id, nombre, direccion, comuna, ciudad, lat, lng, horario) VALUES ($1,'Puerto Montt','Av. Diego Portales 1050','Puerto Montt','Puerto Montt',-41.4693,-72.9424,'Lun a dom 08:00 a 21:00') RETURNING id`, [E]);
  for (const [n, c, rol, s] of [['Paula Contreras', 'counter@siguelogps.cl', 'counter', scl.id], ['Jorge Salinas', 'patio@siguelogps.cl', 'patio', scl.id], ['Rodrigo Fuenzalida', 'finanzas@siguelogps.cl', 'finanzas', prov.id]]) {
    await q('INSERT INTO usuarios (empresa_id, nombre, correo, clave_hash, rol, sucursal_id) VALUES ($1,$2,$3,$4,$5,$6)', [E, n, c, h, rol, s]);
  }
  await q(`INSERT INTO usuarios (empresa_id, nombre, correo, clave_hash, rol) VALUES (NULL, 'Soporte Síguelo', 'soporte@siguelogps.cl', $1, 'superadmin') ON CONFLICT (correo) DO NOTHING`, [h]);

  // Categorías y tarifas
  const cats = {};
  for (const [i, [nombre, desc, pas, mal, tr, ej, dia, sem, mes, km, kmx, gar, ded]] of [
    ['Citycar', 'Ideal para la ciudad', 4, 1, 'Manual', 'Kia Morning o similar', 24990, 149900, 549000, 250, 150, 300000, 350000],
    ['Sedán', 'Cómodo para viajes', 5, 3, 'Automático', 'Hyundai Accent o similar', 32990, 199900, 729000, 250, 180, 500000, 450000],
    ['SUV', 'Espacio y altura', 5, 4, 'Automático', 'Toyota RAV4 o similar', 49990, 299900, 1090000, 300, 220, 700000, 600000],
    ['Camioneta 4x4', 'Para faena y terreno', 5, 4, 'Manual', 'Mitsubishi L200 o similar', 59990, 359900, 1290000, 0, 0, 800000, 750000],
    ['Van', 'Hasta 12 pasajeros', 12, 6, 'Manual', 'Hyundai H1 o similar', 69990, 419900, 1490000, 300, 250, 800000, 750000]
  ].entries()) {
    const [c] = await q('INSERT INTO categorias (empresa_id, nombre, descripcion, pasajeros, maletas, transmision, ejemplo, orden) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id', [E, nombre, desc, pas, mal, tr, ej, i]);
    cats[nombre] = c.id;
    await q('INSERT INTO tarifas (empresa_id, categoria_id, precio_dia, precio_semana, precio_mes, km_libre, km_dia_incluidos, precio_km_extra, garantia, deducible) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [E, c.id, dia, sem, mes, km === 0, km || null, kmx, gar, ded]);
  }
  const anio = new Date().getFullYear();
  const [alta] = await q(`INSERT INTO temporadas (empresa_id, nombre, desde, hasta, prioridad) VALUES ($1,'Temporada alta (verano)',$2,$3,10) RETURNING id`, [E, `${anio}-12-15`, `${anio + 1}-02-28`]);
  await q(`INSERT INTO temporadas (empresa_id, nombre, desde, hasta, prioridad) VALUES ($1,'Fiestas Patrias',$2,$3,20)`, [E, `${anio}-09-15`, `${anio}-09-21`]);
  for (const [nombre, id] of Object.entries(cats)) {
    const [t] = await q('SELECT * FROM tarifas WHERE categoria_id = $1', [id]);
    await q('INSERT INTO tarifas (empresa_id, categoria_id, temporada_id, precio_dia, precio_semana, precio_mes, km_libre, km_dia_incluidos, precio_km_extra, garantia, deducible) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [E, id, alta.id, Math.round(t.precio_dia * 1.3 / 10) * 10, Math.round(t.precio_semana * 1.3 / 100) * 100, Math.round(t.precio_mes * 1.25 / 1000) * 1000, t.km_libre, t.km_dia_incluidos, t.precio_km_extra, t.garantia, t.deducible]);
    void nombre;
  }
  for (const [codigo, nombre, cobro, precio, tope, doc] of [
    ['conductor_adicional', 'Conductor adicional', 'dia', 5000, 50000, true], ['silla_nino', 'Silla de niño', 'dia', 4000, 40000, false],
    ['alzador', 'Alzador infantil', 'dia', 3000, 30000, false], ['cadenas', 'Cadenas para nieve', 'fijo', 25000, null, false],
    ['cruce_argentina', 'Permiso para cruzar a Argentina', 'fijo', 120000, null, true], ['gps_navegador', 'Navegador GPS', 'dia', 3500, 35000, false],
    ['seguro_premium', 'Reducción de deducible', 'dia', 9900, null, false]
  ]) await q('INSERT INTO extras (empresa_id, codigo, nombre, cobro, precio, tope, requiere_documento) VALUES ($1,$2,$3,$4,$5,$6,$7)', [E, codigo, nombre, cobro, precio, tope, doc]);
  await q(`INSERT INTO recargos (empresa_id, tipo, nombre, sucursal_origen_id, sucursal_destino_id, monto) VALUES ($1,'otra_sucursal','Devolución en otra sucursal (general)',NULL,NULL,35000)`, [E]);
  await q(`INSERT INTO recargos (empresa_id, tipo, nombre, sucursal_origen_id, sucursal_destino_id, monto) VALUES ($1,'otra_sucursal','Santiago → Puerto Montt',$2,$3,45000)`, [E, scl.id, pmo.id]);
  await q(`INSERT INTO recargos (empresa_id, tipo, nombre, edad_max, cobro, monto) VALUES ($1,'conductor_joven','Conductor menor de 25 años',25,'dia',6000)`, [E]);
  await q(`INSERT INTO descuentos (empresa_id, codigo, tipo, valor, desde, hasta, usos_max) VALUES ($1,'PRIMAVERA10','porcentaje',10,$2,$3,200), ($1,'EMPRESAS15','porcentaje',15,NULL,NULL,NULL), ($1,'BIENVENIDA','monto',10000,NULL,NULL,500)`, [E, `${anio}-09-01`, `${anio}-12-14`]);

  // Inversionista
  const [inv] = await q(`INSERT INTO propietarios (empresa_id, nombre, rut, correo, banco, cuenta, porcentaje) VALUES ($1,'Inversiones Llanquihue Ltda.','77123456-9','contacto@llanquihue.cl','Banco de Chile','00-123-45678-09',60) RETURNING id`, [E]);

  // Flota (patente guardada sin guion)
  const hoy = Date.now();
  const f = (dias) => isoFecha(hoy + dias * DIA);
  const veh = {};
  for (const [pat, marca, modelo, anioV, cat, color, km, comb, suc, rt, seg, mantCada, mantUlt, estado, gpsId, prop, lat, lng] of [
    ['SXLR27', 'Kia', 'Morning', 2024, 'Citycar', 'Rojo', 21480, 6, scl.id, f(246), f(96), 10000, 20000, 'arrendado', '30001', null, -33.0245, -71.5518],
    ['RTKP42', 'Suzuki', 'Swift', 2023, 'Citycar', 'Blanco', 39210, 8, scl.id, f(18), f(96), 10000, 30000, 'disponible', '30002', null, -33.3968, -70.7937],
    ['TJHV18', 'Hyundai', 'Grand i10', 2025, 'Citycar', 'Gris', 8930, 5, prov.id, f(712), f(96), 10000, 0, 'arrendado', '30003', null, -34.1708, -70.7444],
    ['PBVX61', 'Hyundai', 'Accent', 2023, 'Sedán', 'Gris plata', 48320, 7, scl.id, f(223), f(17), 10000, 40000, 'disponible', '30004', inv.id, -33.3968, -70.7937],
    ['RKDS90', 'Nissan', 'Versa', 2024, 'Sedán', 'Negro', 30115, 3, prov.id, f(-3), f(96), 10000, 25000, 'arrendado', '30005', null, -33.4372, -70.6506],
    ['SGFT35', 'Toyota', 'Yaris', 2025, 'Sedán', 'Azul', 12400, 8, prov.id, f(23), f(96), 15000, 0, 'disponible', '30006', null, -33.4206, -70.6075],
    ['TFZB73', 'Toyota', 'RAV4', 2024, 'SUV', 'Blanco perla', 19660, 4, scl.id, f(279), f(96), 10000, 10000, 'arrendado', '30007', inv.id, -39.2723, -71.9778],
    ['SYPC11', 'MG', 'ZS', 2025, 'SUV', 'Rojo', 20012, 5, prov.id, f(881), f(96), 10000, 10000, 'mantencion', '30008', null, -33.4489, -70.6693],
    ['RVLW56', 'Chery', 'Tiggo 7 Pro', 2024, 'SUV', 'Gris', 27845, 6, scl.id, f(114), f(96), 10000, 20000, 'arrendado', '30009', null, -29.9027, -71.2519],
    ['PKHG24', 'Mitsubishi', 'L200', 2023, 'Camioneta 4x4', 'Plata', 61230, 5, scl.id, f(69), f(17), 10000, 55000, 'arrendado', '30010', null, -22.4558, -68.9293],
    ['SJRT80', 'Toyota', 'Hilux', 2024, 'Camioneta 4x4', 'Blanco', 33500, 8, pmo.id, f(176), f(96), 10000, 25000, 'disponible', '30011', null, -41.4693, -72.9424],
    ['RFDL49', 'Hyundai', 'H1', 2022, 'Van', 'Blanco', 88410, 2, prov.id, f(47), f(96), 10000, 80000, 'fuera_servicio', '30012', null, -33.4206, -70.6075]
  ]) {
    const [v] = await q(`INSERT INTO vehiculos (empresa_id, patente, marca, modelo, anio, categoria_id, color, km, combustible_nivel, sucursal_id, venc_revision_tecnica,
        venc_permiso_circulacion, venc_soap, venc_seguro, seguro_compania, mant_cada_km, mant_ultima_km, mant_ultima_fecha, estado, gps_unidad_id, gps_nombre, propietario_id,
        gps_lat, gps_lng, gps_km, gps_combustible, gps_velocidad, gps_motor, gps_actualizado_en, tag_numero, vin, capacidad_estanque, transmision)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,'HDI Seguros',$14,$15,$16,$17,$18,$19,$20,$21,$22,$8,$9,$23,$24, now() - interval '2 minutes',$25,$26,$27,$28) RETURNING id`,
      [E, pat, marca, modelo, anioV, cats[cat], color, km, comb, suc, rt, `${anio + 1}-03-31`, seg, mantCada, mantUlt, f(-120), estado, gpsId, pat, prop,
        lat, lng, estado === 'arrendado' ? Math.round(Math.random() * 90) : 0, estado === 'arrendado', `TAG ${pat.slice(0, 2)}-${Math.floor(100000 + Math.random() * 899999)}`,
        `KMH${pat}${Math.floor(1e6 + Math.random() * 8e6)}`, cat === 'Citycar' ? 35 : cat === 'Sedán' ? 45 : 60, cat === 'Sedán' || cat === 'SUV' ? 'Automático' : 'Manual']);
    veh[pat] = { id: v.id, cat: cats[cat], suc };
  }

  // Clientes
  const cli = {};
  for (const [k, nombre, apellidos, tipoDoc, doc, nac, correo, tel, lic, licVence, ciudad, extra] of [
    ['valentina', 'Valentina', 'Soto Riquelme', 'rut', '16482903-0', '1987-04-12', 'vsoto@correo.cl', '+56987654321', 'B', '2029-03-14', 'Santiago', {}],
    ['camila', 'Camila', 'Fuentes Araya', 'rut', '17935221-4', '1990-08-02', 'camila.fuentes@correo.cl', '+56912345678', 'B', '2028-06-30', 'Viña del Mar', {}],
    ['diego', 'Diego', 'Araya Muñoz', 'rut', '18664012-8', '1999-11-20', 'diego.araya@correo.cl', '+56955512345', 'B', '2027-11-20', 'Santiago', {}],
    ['john', 'John', 'Miller', 'pasaporte', '584392017', '1979-01-15', 'jmiller@mail.com', '+14155550142', 'Internacional', '2030-01-15', 'San Francisco', { nacionalidad: 'Estados Unidos', pais: 'Estados Unidos' }],
    ['lucia', 'Lucía', 'Fernández', 'dni', '32456789', '1985-05-09', 'lucia.fernandez@mail.com.ar', '+5492944555123', 'B1', '2028-05-09', 'Bariloche', { nacionalidad: 'Argentina', pais: 'Argentina' }],
    ['ignacio', 'Ignacio', 'Vargas Pinto', 'rut', '15201788-K', '1983-02-27', 'ivargas@correo.cl', '+56966677788', 'B', '2026-12-01', 'Santiago', {}],
    ['francisca', 'Francisca', 'Silva Rojas', 'rut', '19234567-7', '2002-07-14', 'fran.silva@correo.cl', '+56944433322', 'B', '2031-07-14', 'Temuco', {}],
    ['sebastian', 'Sebastián', 'Morales Díaz', 'rut', '14562387-1', '1976-09-30', 'smorales@correo.cl', '+56933322211', 'B', '2027-09-30', 'La Serena', {}],
    ['aconcagua', 'Constructora Aconcagua SpA', null, 'rut', '76111222-8', null, 'flota@aconcagua.cl', '+56222334455', null, null, 'Calama', { tipo: 'empresa', razon_social: 'Constructora Aconcagua SpA', giro: 'Construcción' }],
    ['martina', 'Martina', 'Castro Lagos', 'rut', '12345670-K', '1972-03-03', 'martina.castro@correo.cl', '+56977788899', 'B', '2028-03-03', 'Rancagua', {}],
    ['matias', 'Matías', 'González Vera', 'rut', '9876543-3', '1965-12-24', 'mgonzalez@correo.cl', '+56988899900', 'B', '2027-12-24', 'Santiago', {}],
    ['tomas', 'Tomás', 'Pérez Núñez', 'rut', '17654321-3', '1995-06-18', 'tperez@correo.cl', '+56911122233', 'B', '2026-10-25', 'Santiago', { lista_negra: true, lista_negra_motivo: 'Devolvió el vehículo con daños sin informar y no pagó el deducible (R-0987).' }]
  ]) {
    const [c] = await q(`INSERT INTO clientes (empresa_id, tipo, nombre, apellidos, documento_tipo, documento, fecha_nacimiento, correo, telefono, licencia_clase, licencia_numero, licencia_vence, ciudad, comuna, direccion, nacionalidad, pais, razon_social, giro, lista_negra, lista_negra_motivo, lista_negra_en)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14,$15,$16,$17,$18,$19,$20, CASE WHEN $19 THEN now() ELSE NULL END) RETURNING id`,
      [E, extra.tipo || 'persona', nombre, apellidos, tipoDoc, doc, nac, correo, tel, lic, lic ? String(Math.floor(1e7 + Math.random() * 8e7)) : null, licVence, ciudad, 'Calle Los Aromos 123', extra.nacionalidad || 'Chile', extra.pais || 'Chile', extra.razon_social || null, extra.giro || null, !!extra.lista_negra, extra.lista_negra_motivo || null]);
    cli[k] = c.id;
  }
  await q(`INSERT INTO conductores (empresa_id, cliente_id, nombre, documento_tipo, documento, licencia_clase, licencia_vence, fecha_nacimiento) VALUES ($1,$2,'Felipe Soto Riquelme','rut','17935221-4','B','2030-01-10','1992-01-10')`, [E, cli.valentina]);

  // Reservas alrededor de hoy (inicio/fin relativos)
  // dias desde hoy (en Chile) y horas como desplazamiento desde las 10:00 locales
  const hoyChile = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
  const at = (dias, horas) => desdeLocal(isoFecha(Date.parse(hoyChile) + dias * DIA), `${10 + horas}:00`);
  const reservas = [
    ['en_curso', 'SXLR27', 'camila', -2, 2, 2, 0, scl.id, scl.id, [], null],
    ['confirmada', 'SXLR27', 'diego', 3, 0, 6, 0, scl.id, scl.id, [], null],
    ['cotizacion', 'SXLR27', 'francisca', 8, 0, 10, 12, prov.id, prov.id, [{ codigo: 'silla_nino', cantidad: 1 }], null],
    ['cerrada', 'RTKP42', 'tomas', -6, 0, -4, 6, scl.id, scl.id, [], null],
    ['confirmada', 'RTKP42', 'john', 1, 4, 5, 8, scl.id, scl.id, [{ codigo: 'gps_navegador', cantidad: 1 }], null],
    ['en_curso', 'TJHV18', 'lucia', -1, 6, 5, 0, prov.id, prov.id, [], null],
    ['confirmada', 'TJHV18', 'martina', 6, 0, 10, 0, prov.id, prov.id, [], null],
    ['confirmada', 'PBVX61', 'valentina', 0, 4, 5, 2, scl.id, pmo.id, [{ codigo: 'conductor_adicional', cantidad: 1 }, { codigo: 'silla_nino', cantidad: 1 }], 'PRIMAVERA10'],
    ['devuelta', 'PBVX61', 'matias', -5, 0, -1, 0, scl.id, scl.id, [], null],
    ['en_curso', 'RKDS90', 'ignacio', -4, 0, 0, -5, prov.id, prov.id, [], null], // atrasada: debía volver hace 5 h
    ['confirmada', 'RKDS90', 'sebastian', 4, 0, 7, 0, prov.id, prov.id, [], null],
    ['en_curso', 'TFZB73', 'francisca', -3, 0, 2, 0, scl.id, scl.id, [{ codigo: 'cadenas', cantidad: 1 }], null],
    ['confirmada', 'TFZB73', 'matias', 3, 0, 10, 0, scl.id, scl.id, [], 'EMPRESAS15'],
    ['confirmada', 'SYPC11', 'martina', 3, 0, 6, 0, prov.id, prov.id, [], null],
    ['en_curso', 'RVLW56', 'sebastian', -1, 0, 2, 0, scl.id, scl.id, [], null],
    ['confirmada', 'RVLW56', 'diego', 3, 0, 6, 0, scl.id, scl.id, [], null],
    ['en_curso', 'PKHG24', 'aconcagua', -9, 0, 8, 0, scl.id, scl.id, [], 'EMPRESAS15'],
    ['confirmada', 'SJRT80', 'lucia', 2, 0, 7, 0, pmo.id, pmo.id, [{ codigo: 'cruce_argentina', cantidad: 1 }], null],
    ['no_show', 'SGFT35', 'diego', -3, 0, -1, 0, prov.id, prov.id, [], null],
    ['cancelada', 'SGFT35', 'camila', 5, 0, 7, 0, prov.id, prov.id, [], null]
  ];
  for (const [estado, pat, c, di, hi, df, hf, sr, sd, extras, codigo] of reservas) {
    let inicio = at(di, hi), fin = at(df, hf);
    // Si ya pasó la hora del retiro (p. ej. al sembrar de noche), se mueve a mañana a la misma hora local conservando la duración
    if (estado === 'confirmada' && inicio < new Date()) { const dur = fin - inicio; inicio = at(di + 1, hi); fin = new Date(inicio.getTime() + Math.max(dur, DIA)); }
    const cot = await cotizar({ empresaId: E, categoriaId: veh[pat].cat, inicio, fin, sucursalRetiroId: sr, sucursalDevolucionId: sd, extras, codigoDescuento: codigo });
    await transaccion(async (tx) => {
      const folio = await siguienteFolio(E, estado === 'cotizacion' ? 'C' : 'R', tx);
      await tx.query(`INSERT INTO reservas (empresa_id, folio, estado, cliente_id, vehiculo_id, categoria_id, sucursal_retiro_id, sucursal_devolucion_id, inicio, fin, extras, codigo_descuento, cotizacion, total,
          km_incluidos, precio_km_extra, garantia, deducible, origen, token_portal, retiro_real, devolucion_real, creado_en)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22, now() - interval '9 days')`,
        [E, folio, estado, cli[c], veh[pat].id, veh[pat].cat, sr, sd, inicio, fin, JSON.stringify(extras), codigo, JSON.stringify(cot), cot.total, cot.km_incluidos, cot.precio_km_extra, cot.garantia, cot.deducible,
          c === 'valentina' || c === 'john' ? 'portal' : 'counter', tokenAleatorio(18),
          ['en_curso', 'devuelta', 'cerrada'].includes(estado) ? inicio : null, ['devuelta', 'cerrada'].includes(estado) ? fin : null]);
    });
  }
  // Mantención en curso (bloqueo en el calendario)
  const otFolio = await siguienteFolio(E, 'OT');
  const [ot] = await q(`INSERT INTO ordenes_trabajo (empresa_id, folio, vehiculo_id, tipo, motivo, km_programado, taller, costo, estado, inicio, km_al_ingreso) VALUES ($1,$2,$3,'preventiva','Mantención 20.000 km',20000,'Taller Automotriz Lyon',185000,'en_taller',$4,20012) RETURNING id`, [E, otFolio, veh.SYPC11.id, at(-1, 0)]);
  await q(`INSERT INTO bloqueos (empresa_id, vehiculo_id, inicio, fin, motivo, orden_trabajo_id) VALUES ($1,$2,$3,$4,'Mantención 20.000 km',$5)`, [E, veh.SYPC11.id, at(-1, 0), at(1, 12), ot.id]);
  await q(`INSERT INTO bloqueos (empresa_id, vehiculo_id, inicio, fin, motivo) VALUES ($1,$2,$3,$4,'Fuera de servicio: falla de embrague')`, [E, veh.RFDL49.id, at(-3, 0), at(4, 0)]);
  // Datos de prueba de cada módulo: src/demo-extra/*.js exporta sembrar(empresaId)
  const fs = await import('node:fs'), path = await import('node:path'), url = await import('node:url');
  const dir = path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'demo-extra');
  for (const f of (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((x) => x.endsWith('.js')).sort()) {
    const m = await import(url.pathToFileURL(path.join(dir, f)).href);
    if (m.sembrar) await m.sembrar(E);
  }
  return e;
}
