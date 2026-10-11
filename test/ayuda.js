// Ayuda para pruebas: levanta la app con PGlite en memoria y datos de prueba, y entrega un cliente HTTP con sesión.
// Uso:  import { levantar } from './ayuda.js';
//       const t = await levantar();  const r = await t.como('demo@siguelogps.cl').get('/api/reservas');  ...  await t.cerrar();
process.env.TAREAS = '0';
process.env.DATABASE_URL = '';
process.env.PGLITE_DIR = '';
process.env.SEMBRAR_DEMO = '0';

export async function levantar() {
  const db = await import('../src/db.js');
  await db.abrir();
  await db.migrar();
  const { sembrarDemo } = await import('../src/demo.js');
  await sembrarDemo();
  const { crearApp } = await import('../src/app.js');
  const app = await crearApp();
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const sesiones = {};
  async function como(correo, clave = 'demo1234') {
    if (!sesiones[correo]) {
      const r = await fetch(`${base}/api/ingresar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo, clave }) });
      if (!r.ok) throw new Error(`No se pudo ingresar como ${correo}: ${r.status}`);
      sesiones[correo] = r.headers.get('set-cookie').split(';')[0];
    }
    const cookie = sesiones[correo];
    const llamar = async (method, ruta, body) => {
      const r = await fetch(base + ruta, { method, headers: { Cookie: cookie, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
      const tipo = r.headers.get('content-type') || '';
      return { estado: r.status, datos: tipo.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()), headers: r.headers };
    };
    return { get: (u) => llamar('GET', u), post: (u, b = {}) => llamar('POST', u, b), put: (u, b = {}) => llamar('PUT', u, b), patch: (u, b = {}) => llamar('PATCH', u, b), del: (u) => llamar('DELETE', u) };
  }
  return { base, como, db, cerrar: async () => { srv.close(); await db.cerrar(); } };
}
