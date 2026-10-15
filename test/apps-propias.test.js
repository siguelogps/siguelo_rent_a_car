import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { levantar } from './ayuda.js';

let t, admin, siguelo;

// PNG válido (blanco) de ancho × alto, para el ícono, el logo y la firma.
function png(ancho, alto) {
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
  const trozo = (tipo, datos) => { const l = Buffer.alloc(4); l.writeUInt32BE(datos.length); const td = Buffer.concat([Buffer.from(tipo), datos]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(ancho, 0); ihdr.writeUInt32BE(alto, 4); ihdr[8] = 8; ihdr[9] = 2;
  const filas = Buffer.alloc((ancho * 3 + 1) * alto, 255); for (let y = 0; y < alto; y++) filas[y * (ancho * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ihdr), trozo('IDAT', zlib.deflateSync(filas)), trozo('IEND', Buffer.alloc(0))]);
}
const dataUrl = (b) => `data:image/png;base64,${b.toString('base64')}`;

before(async () => { t = await levantar(); admin = await t.como('demo@siguelogps.cl'); siguelo = await t.como('soporte@siguelogps.cl'); });
after(async () => { await t.cerrar(); });

test('apps con marca: pedido, habilitación, solicitud firmada, aprobación, versiones y publicación', async () => {
  let p = await admin.get('/api/apps/panel');
  assert.equal(p.estado, 200);
  assert.equal(p.datos.modulo, false);
  assert.equal(p.datos.paquetes.equipo, 'cl.siguelogps.onrent.andesrent.equipo');
  assert.equal((await admin.put('/api/apps/solicitud', { nombre_equipo: 'X' })).estado, 403);

  // La empresa la pide y Síguelo la habilita
  assert.equal((await admin.post('/api/apps/pedir-personalizacion', { nota: 'antes de diciembre' })).estado, 200);
  let bo = await siguelo.get('/api/backoffice/apps');
  const pedido = bo.datos.pedidos.find((x) => x.slug === 'andes-rent');
  assert.ok(pedido);
  assert.equal((await admin.get('/api/backoffice/apps')).estado, 403); // solo el equipo Síguelo
  assert.equal((await siguelo.post(`/api/backoffice/empresas/${pedido.id}/app-propia`, { habilitado: true, nota: 'se cobra' })).estado, 200);
  p = await admin.get('/api/apps/panel');
  assert.equal(p.datos.modulo, true);

  // Archivos: el ícono debe ser PNG de 512 × 512
  const subir = async (tipo, b) => (await admin.post('/api/archivos', { entidad: 'solicitud_app', tipo, nombre: `${tipo}.png`, dataUrl: dataUrl(b) })).datos.id;
  const chico = await subir('icono', png(100, 100));
  assert.equal((await admin.put('/api/apps/solicitud', { icono_archivo_id: chico })).estado, 400);
  const icono = await subir('icono', png(512, 512));
  const logo = await subir('logo', png(300, 100));
  const g = await admin.put('/api/apps/solicitud', { nombre_equipo: 'Andes Equipo', nombre_clientes: 'Andes Rent a Car', color: '#0b5fff', correo_soporte: 'soporte@andesrent.cl', icono_archivo_id: icono, logo_archivo_id: logo });
  assert.equal(g.estado, 200, JSON.stringify(g.datos));
  assert.equal(g.datos.estado, 'borrador');
  assert.equal(g.datos.datos.color, '#0B5FFF');

  // Antes de firmar, el ícono no es público
  assert.equal((await fetch(`${t.base}/api/apps/marca/andes-rent/icono.png`)).status, 404);
  // Firma: RUT válido, aceptar y firma dibujada
  const firma = dataUrl(png(400, 150));
  assert.equal((await admin.post('/api/apps/solicitud/firmar', { nombre: 'María Pérez', rut: '11.111.111-2', cargo: 'Gerenta', acepta: true, firma })).estado, 400);
  assert.equal((await admin.post('/api/apps/solicitud/firmar', { nombre: 'María Pérez', rut: '11.111.111-1', cargo: 'Gerenta', acepta: false, firma })).estado, 400);
  const f = await admin.post('/api/apps/solicitud/firmar', { nombre: 'María Pérez', rut: '11.111.111-1', cargo: 'Gerenta', acepta: true, firma });
  assert.equal(f.estado, 200, JSON.stringify(f.datos));
  assert.equal(f.datos.estado, 'enviada');
  assert.match(f.datos.firma.hash, /^[0-9a-f]{64}$/);
  assert.ok(f.datos.datos.desc_corta_equipo); // texto base cuando no lo escriben
  const pdf = await admin.get('/api/apps/solicitud/pdf');
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(pdf.datos.subarray(0, 4).toString(), '%PDF');
  assert.equal((await admin.put('/api/apps/solicitud', { nombre_equipo: 'Otra' })).estado, 409); // enviada: ya no se edita
  const ico = await fetch(`${t.base}/api/apps/marca/andes-rent/icono.png`);
  assert.equal(ico.status, 200);

  // Observaciones → el cliente corrige y vuelve a firmar
  bo = await siguelo.get('/api/backoffice/apps');
  const s = bo.datos.solicitudes.find((x) => x.slug === 'andes-rent');
  assert.equal((await siguelo.post(`/api/backoffice/apps/${s.id}/estado`, { estado: 'con_observaciones' })).estado, 400);
  assert.equal((await siguelo.post(`/api/backoffice/apps/${s.id}/estado`, { estado: 'con_observaciones', observaciones: 'El logo se ve pixelado' })).estado, 200);
  assert.equal((await admin.put('/api/apps/solicitud', { ...g.datos.datos, nombre_equipo: 'Andes Equipo', icono_archivo_id: icono, logo_archivo_id: logo })).estado, 200);
  assert.equal((await admin.post('/api/apps/solicitud/firmar', { nombre: 'María Pérez', rut: '11.111.111-1', cargo: 'Gerenta', acepta: true, firma })).datos.estado, 'enviada');

  // Aprobar sin GitHub configurado: queda «App en desarrollo» con los parámetros para ejecutarlo a mano
  const a = await siguelo.post(`/api/backoffice/apps/${s.id}/aprobar`, {});
  assert.equal(a.estado, 200, JSON.stringify(a.datos));
  assert.equal(a.datos.disparada, false);
  assert.equal(a.datos.solicitud.estado, 'compilando');
  assert.equal(a.datos.parametros.empresa, 'andes-rent');
  assert.match(a.datos.parametros.icono_url, /\/api\/apps\/marca\/andes-rent\/icono\.png$/);
  const m = await (await fetch(`${t.base}/api/apps/marca/andes-rent`)).json();
  assert.equal(m.nombres.equipo, 'Andes Equipo');

  // GitHub Actions publica con el token de servicio; con las dos apps pasa a «Lista para tienda»
  const tk = await siguelo.post('/api/backoffice/apps-token', {});
  assert.equal(tk.estado, 201);
  const publicar = (app, formato, token = tk.datos.token, cuerpo = Buffer.concat([Buffer.from('PK'), Buffer.alloc(2000, 1)])) => fetch(`${t.base}/api/apps/servicio/${app}`, {
    method: 'POST', body: cuerpo,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'x-empresa': 'andes-rent', 'x-version': '1.0.7', 'x-formato': formato }
  }).then((r) => r.status);
  assert.equal(await publicar('equipo', 'apk', 'sor_malo'), 401);
  assert.equal(await publicar('equipo', 'apk', undefined, Buffer.from('no es un apk')), 400);
  assert.equal(await publicar('equipo', 'apk'), 201);
  assert.equal(await publicar('equipo', 'apk'), 201); // la versión anterior se reemplaza
  assert.equal(await publicar('equipo', 'aab'), 201);
  assert.equal((await t.db.q(`SELECT count(*)::int AS n FROM app_versiones WHERE app = 'equipo' AND formato = 'apk'`))[0].n, 1);
  assert.equal(await publicar('clientes', 'apk'), 201);
  p = await admin.get('/api/apps/panel');
  assert.equal(p.datos.solicitud.estado, 'lista');
  assert.equal(p.datos.versiones.equipo.apk.version, '1.0.7');
  const apk = await fetch(`${t.base}/api/apps/descargas/andes-rent/equipo.apk`);
  assert.equal(apk.status, 200);
  assert.equal((await fetch(`${t.base}/api/apps/descargas/andes-rent/otra.apk`)).status, 404);

  // Publicada con el link de Google Play
  assert.equal((await siguelo.post(`/api/backoffice/apps/${s.id}/estado`, { estado: 'publicada', url_equipo: 'https://ejemplo.cl' })).estado, 400);
  const pub = await siguelo.post(`/api/backoffice/apps/${s.id}/estado`, { estado: 'publicada', url_equipo: 'https://play.google.com/store/apps/details?id=cl.siguelogps.onrent.andesrent.equipo' });
  assert.equal(pub.datos.estado, 'publicada');
});

test('la app del equipo con marca solo deja entrar al personal de esa empresa', async () => {
  const ingresar = (app) => fetch(`${t.base}/api/ingresar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: 'counter@siguelogps.cl', clave: 'demo1234', app }) }).then((r) => r.status);
  assert.equal(await ingresar('andes-rent'), 200);
  await t.db.q(`INSERT INTO empresas (nombre, slug) VALUES ('Otra Rent', 'otra-rent') ON CONFLICT DO NOTHING`);
  assert.equal(await ingresar('otra-rent'), 403);
});
