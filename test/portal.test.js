import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantar } from './ayuda.js';

let t, info;
const SLUG = 'andes-rent';
const dia = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const busq = (d1, d2, extra = {}) => ({ sucursal_retiro_id: info.sucursales[0].id, retiro_fecha: dia(d1), retiro_hora: '10:00', devolucion_fecha: dia(d2), devolucion_hora: '10:00', ...extra });
const cliente = (doc, extra = {}) => ({ documento_tipo: 'rut', documento: doc, nombre: 'Pedro', apellidos: 'Pérez Soto', correo: 'pedro@correo.cl', telefono: '+56 9 1111 2222', fecha_nacimiento: '1988-05-04', licencia_clase: 'B', ...extra });
async function pub(metodo, ruta, body) {
  const r = await fetch(t.base + ruta, { method: metodo, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const tipo = r.headers.get('content-type') || '';
  return { estado: r.status, datos: tipo.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()), headers: r.headers };
}
const reservar = (b) => pub('POST', `/api/portal/empresa/${SLUG}/reservar`, { acepta: true, pago: 'online', ...b });
const catId = (nombre) => info.categorias.find((c) => c.nombre === nombre).id;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

before(async () => { t = await levantar(); info = (await pub('GET', `/api/portal/empresa/${SLUG}`)).datos; });
after(async () => { await t.cerrar(); });

test('datos públicos del portal sin información interna', async () => {
  assert.equal(info.nombre, 'Andes Rent a Car');
  assert.ok(info.sucursales.length >= 3);
  assert.ok(info.categorias.some((c) => c.ejemplo === 'Kia Morning o similar'));
  assert.equal(info.portal_pago, 'opcional');
  assert.equal(info.ajustes, undefined);
  assert.equal((await pub('GET', '/api/portal/empresa/no-existe')).estado, 404);
});

test('búsqueda devuelve categorías con disponibilidad y precio total y por día', async () => {
  const r = await pub('POST', `/api/portal/empresa/${SLUG}/buscar`, busq(30, 33, { codigo_descuento: 'BIENVENIDA' }));
  assert.equal(r.estado, 200);
  assert.equal(r.datos.dias, 3);
  const city = r.datos.resultados.find((c) => c.nombre === 'Citycar');
  assert.equal(city.disponible, true);
  assert.equal(city.cotizacion.dias, 3);
  assert.equal(city.cotizacion.lineas[0].monto, 3 * 24990);
  assert.equal(city.cotizacion.descuento, 10000);
  assert.equal(city.cotizacion.total, 3 * 24990 - 10000);
  assert.equal(city.cotizacion.por_dia, Math.round((3 * 24990 - 10000) / 3));
  // La van está fuera de servicio: aparece sin disponibilidad
  const van = (await pub('POST', `/api/portal/empresa/${SLUG}/buscar`, busq(1, 2))).datos.resultados.find((c) => c.nombre === 'Van');
  assert.equal(van.disponible, false);
  // Validaciones de fechas
  assert.equal((await pub('POST', `/api/portal/empresa/${SLUG}/buscar`, busq(5, 4))).estado, 400);
  assert.equal((await pub('POST', `/api/portal/empresa/${SLUG}/buscar`, busq(-2, 1))).estado, 400);
});

test('cotización en vivo suma extras y recargo por conductor joven', async () => {
  const b = busq(30, 33);
  const base = (await pub('POST', `/api/portal/empresa/${SLUG}/cotizar`, { busqueda: b, categoria_id: catId('Sedán') })).datos;
  const con = (await pub('POST', `/api/portal/empresa/${SLUG}/cotizar`, { busqueda: b, categoria_id: catId('Sedán'), extras: [{ codigo: 'silla_nino', cantidad: 2 }], fecha_nacimiento: '2003-01-01' })).datos;
  assert.equal(con.total - base.total, 2 * 4000 * 3 + 6000 * 3);
});

test('reserva desde el portal: confirmada con pago simulado, vehículo asignado y aviso retenido', async () => {
  const r = await reservar({ busqueda: busq(40, 43), categoria_id: catId('SUV'), extras: [{ codigo: 'gps_navegador' }], cliente: cliente('11.111.111-1') });
  assert.equal(r.estado, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.estado, 'confirmada');
  assert.equal(r.datos.simulado, true);
  assert.match(r.datos.folio, /^R-\d+/);
  const [res] = await t.db.q('SELECT * FROM reservas WHERE token_portal = $1', [r.datos.token]);
  assert.equal(res.origen, 'portal');
  assert.ok(res.vehiculo_id);
  assert.equal(res.total, r.datos.total);
  const [pago] = await t.db.q('SELECT * FROM pagos WHERE reserva_id = $1', [res.id]);
  assert.equal(pago.estado, 'simulado');
  assert.equal(pago.monto, res.total);
  const sal = await t.db.q(`SELECT * FROM salidas WHERE entidad = 'reserva' AND entidad_id = $1`, [res.id]);
  assert.ok(sal.length >= 1 && sal.every((s) => s.estado === 'retenida'));
  // Área del cliente con el token
  const p = await pub('GET', `/api/portal/r/${r.datos.token}`);
  assert.equal(p.estado, 200);
  assert.equal(p.datos.reserva.folio, r.datos.folio);
  assert.equal(p.datos.saldo, 0);
  assert.equal(p.datos.vehiculo, null); // la patente no se muestra antes del retiro
  assert.deepEqual(p.datos.documentos.requeridos, ['cedula_frente', 'cedula_reverso', 'licencia']);
});

test('dos reservas simultáneas por el último vehículo libre: una recibe 409', async () => {
  // Camioneta 4x4 tiene 2 vehículos; se ocupa uno y quedan dos clientes compitiendo por el otro
  const b = busq(60, 62);
  const primera = await reservar({ busqueda: b, categoria_id: catId('Camioneta 4x4'), cliente: cliente('22.222.222-2') });
  assert.equal(primera.estado, 200);
  const [x, y] = await Promise.all([
    reservar({ busqueda: b, categoria_id: catId('Camioneta 4x4'), cliente: cliente('33.333.333-3') }),
    reservar({ busqueda: b, categoria_id: catId('Camioneta 4x4'), cliente: cliente('44.444.444-4') })
  ]);
  assert.deepEqual([x.estado, y.estado].sort(), [200, 409]);
  const ok = [x, y].find((z) => z.estado === 200);
  const filas = await t.db.q(`SELECT vehiculo_id FROM reservas WHERE token_portal = ANY($1)`, [[primera.datos.token, ok.datos.token]]);
  assert.notEqual(filas[0].vehiculo_id, filas[1].vehiculo_id);
  const busqueda = (await pub('POST', `/api/portal/empresa/${SLUG}/buscar`, b)).datos.resultados.find((c) => c.nombre === 'Camioneta 4x4');
  assert.equal(busqueda.disponible, false);
});

test('validación de datos: RUT con dígito verificador, edad mínima y condiciones', async () => {
  const b = busq(70, 72);
  const malo = await reservar({ busqueda: b, categoria_id: catId('Citycar'), cliente: cliente('11.111.111-2') });
  assert.equal(malo.estado, 400);
  assert.equal(malo.datos.campo, 'documento');
  const joven = await reservar({ busqueda: b, categoria_id: catId('Citycar'), cliente: cliente('11.111.111-1', { fecha_nacimiento: dia(-365 * 19) }) });
  assert.equal(joven.estado, 400);
  assert.equal(joven.datos.campo, 'fecha_nacimiento');
  const sinAcepta = await pub('POST', `/api/portal/empresa/${SLUG}/reservar`, { busqueda: b, categoria_id: catId('Citycar'), cliente: cliente('11.111.111-1') });
  assert.equal(sinAcepta.estado, 400);
  // Extranjero con pasaporte
  const ext = await reservar({ busqueda: b, categoria_id: catId('Citycar'), cliente: cliente('X1234567', { documento_tipo: 'pasaporte', nacionalidad: 'Brasil' }) });
  assert.equal(ext.estado, 200);
  const p = await pub('GET', `/api/portal/r/${ext.datos.token}`);
  assert.deepEqual(p.datos.documentos.requeridos, ['pasaporte', 'licencia']);
});

test('pago en el mesón y cliente en lista negra quedan como cotización', async () => {
  const mesa = await reservar({ busqueda: busq(80, 82), categoria_id: catId('Sedán'), pago: 'mostrador', cliente: cliente('55.555.555-5') });
  assert.equal(mesa.datos.estado, 'cotizacion');
  assert.equal((await pub('GET', `/api/portal/r/${mesa.datos.token}`)).datos.saldo, mesa.datos.total);
  // Tomás Pérez (17.654.321-3) está en lista negra: no se le bloquea, pero no se cobra y queda con nota
  const ln = await reservar({ busqueda: busq(84, 86), categoria_id: catId('Sedán'), cliente: cliente('17.654.321-3') });
  assert.equal(ln.estado, 200);
  assert.equal(ln.datos.estado, 'cotizacion');
  assert.equal(ln.datos.simulado, false);
  const [res] = await t.db.q('SELECT id, notas FROM reservas WHERE token_portal = $1', [ln.datos.token]);
  assert.match(res.notas, /lista negra/);
  assert.equal((await t.db.q('SELECT count(*)::int AS n FROM pagos WHERE reserva_id = $1', [res.id]))[0].n, 0);
  const area = (await pub('GET', `/api/portal/r/${ln.datos.token}`)).datos;
  assert.equal(area.puede_pagar, false);
  assert.equal(JSON.stringify(area).includes('lista'), false);
  // Pagar lo pendiente de la cotización del mesón la confirma
  const pg = await pub('POST', `/api/portal/r/${mesa.datos.token}/pagar`, { proveedor: 'webpay' });
  assert.equal(pg.estado, 200);
  const area2 = (await pub('GET', `/api/portal/r/${mesa.datos.token}`)).datos;
  assert.equal(area2.reserva.estado, 'confirmada');
  assert.equal(area2.saldo, 0);
});

test('documentos del cliente con el token y contrato PDF protegido por token', async () => {
  const r = await reservar({ busqueda: busq(90, 92), categoria_id: catId('Citycar'), cliente: cliente('66.666.666-6') });
  const tok = r.datos.token;
  const sub = await pub('POST', `/api/portal/r/${tok}/documentos`, { tipo: 'cedula_frente', dataUrl: PNG });
  assert.equal(sub.estado, 200);
  assert.equal((await pub('POST', `/api/portal/r/${tok}/documentos`, { tipo: 'otro', dataUrl: PNG })).estado, 400);
  assert.equal((await pub('POST', `/api/portal/r/${tok}/documentos`, { tipo: 'licencia', dataUrl: 'data:text/html;base64,PGI+' })).estado, 400);
  assert.equal((await pub('POST', '/api/portal/r/token-que-no-existe-123456/documentos', { tipo: 'licencia', dataUrl: PNG })).estado, 404);
  const area = (await pub('GET', `/api/portal/r/${tok}`)).datos;
  assert.ok(area.documentos.subidos.cedula_frente);
  assert.equal(area.documentos.subidos.licencia, undefined);
  const [res] = await t.db.q('SELECT * FROM reservas WHERE token_portal = $1', [tok]);
  const [arch] = await t.db.q(`SELECT * FROM archivos WHERE entidad = 'cliente' AND entidad_id = $1 AND tipo = 'cedula_frente'`, [res.cliente_id]);
  assert.equal(arch.empresa_id, res.empresa_id);

  // Contrato: 404 hasta que esté firmado con PDF
  assert.equal((await pub('GET', `/api/portal/r/${tok}/contrato.pdf`)).estado, 404);
  const { guardarArchivo } = await import('../src/almacenamiento/index.js');
  const pdf = await guardarArchivo({ empresaId: res.empresa_id, entidad: 'contrato', tipo: 'pdf', nombre: 'c.pdf', mime: 'application/pdf', datos: Buffer.from('%PDF-1.4 prueba') });
  await t.db.q(`INSERT INTO contratos (empresa_id, reserva_id, folio, estado, contenido, codigo_verificacion, pdf_archivo_id, firmado_en) VALUES ($1,$2,'CT-PRUEBA','firmado','texto','VERIF-PRUEBA-1',$3, now())`, [res.empresa_id, res.id, pdf.id]);
  const c = await pub('GET', `/api/portal/r/${tok}/contrato.pdf`);
  assert.equal(c.estado, 200);
  assert.equal(c.headers.get('content-type'), 'application/pdf');
  assert.equal(c.datos.toString().slice(0, 8), '%PDF-1.4');
  assert.equal((await pub('GET', `/api/portal/r/${tok}`)).datos.contrato.pdf, true);
  // Otro token no ve ese contrato
  const otro = await reservar({ busqueda: busq(94, 96), categoria_id: catId('Citycar'), cliente: cliente('77.777.777-7') });
  assert.equal((await pub('GET', `/api/portal/r/${otro.datos.token}/contrato.pdf`)).estado, 404);
});

// res.sendFile (src/app.js) no sirve archivos bajo carpetas que empiezan con punto (p. ej. .claude/worktrees)
const rutaConPunto = /[\\/]\.[^\\/]/.test(new URL('..', import.meta.url).pathname);
// 31-oct (pendientes de seguridad): antes esta prueba exigía que /portal también fuera incrustable. Se cambió a propósito:
// /portal/:token es la sesión del cliente (reserva, documentos, pagos) y no debe cargarse dentro de un iframe ajeno
// (clickjacking). Solo /reservar y /embed, que el rentacar pone en su propio sitio, siguen sin restricción.
test('páginas públicas: /reservar y /embed se pueden incrustar; /portal nunca', { skip: rutaConPunto && 'el repositorio está bajo una carpeta oculta' }, async () => {
  for (const ruta of ['/reservar/andes-rent', '/embed/andes-rent']) {
    const r = await fetch(t.base + ruta);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-frame-options'), null, ruta);
    assert.equal(r.headers.get('content-security-policy'), null, ruta);
  }
  const portal = await fetch(`${t.base}/portal/abc123`);
  assert.equal(portal.status, 200);
  assert.equal(portal.headers.get('x-frame-options'), 'DENY');
  assert.equal(portal.headers.get('content-security-policy'), "frame-ancestors 'none'");
  const js = await fetch(`${t.base}/embed.js`);
  assert.equal(js.status, 200);
  assert.match(await js.text(), /data-rentacar/);
});

test('el cliente ubica su reserva con folio y RUT para subir documentos (sin revelar reservas ajenas)', async () => {
  const pub = (b) => fetch(`${t.base}/api/portal/empresa/andes-rent/mi-reserva`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  const r = await t.db.uno(`SELECT r.folio, c.documento, r.token_portal FROM reservas r JOIN clientes c ON c.id = r.cliente_id WHERE r.estado = 'confirmada' AND c.documento_tipo = 'rut' ORDER BY r.id LIMIT 1`);
  const ok = await pub({ folio: r.folio.toLowerCase(), documento: r.documento.replace('-', '') });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).url_portal, `/portal/${r.token_portal}#documentos`);
  const mal = await pub({ folio: r.folio, documento: '11111111-1' });
  assert.equal(mal.status, 404);
});
