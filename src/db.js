// Acceso a PostgreSQL. Con DATABASE_URL usa un pool de «pg» (Render, Neon, RDS, Cloud SQL…);
// sin ella usa PGlite (Postgres embebido) para desarrollo, pruebas y demo. Mismo SQL en ambos casos.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const DIR_MIGRACIONES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migraciones');
let motor = null; // { query(sql, params), exec(sql), transaccion(fn), cerrar() }

async function abrirPg(url) {
  const { default: pg } = await import('pg');
  pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));      // BIGINT → number (montos CLP e ids caben)
  pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));    // NUMERIC → number
  pg.types.setTypeParser(1082, (v) => v);                                  // DATE → 'AAAA-MM-DD' (sin corrimiento de zona)
  // Sin SSL en local y en redes internas (p. ej. Render: host «dpg-xxxx-a» sin dominio); con SSL hacia afuera.
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  const ssl = /localhost|127\.0\.0\.1/.test(host) || !host.includes('.') || /sslmode=disable/.test(url) ? false : { rejectUnauthorized: false };
  const pool = new pg.Pool({ connectionString: url, ssl, max: Number(process.env.PG_POOL_MAX) || 10 });
  const envolver = (c) => ({ query: async (sql, p = []) => (await c.query(sql, p)).rows });
  return {
    query: async (sql, p = []) => (await pool.query(sql, p)).rows,
    exec: async (sql) => { await pool.query(sql); },
    transaccion: async (fn) => {
      const c = await pool.connect();
      try { await c.query('BEGIN'); const r = await fn(envolver(c)); await c.query('COMMIT'); return r; }
      catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
      finally { c.release(); }
    },
    cerrar: () => pool.end()
  };
}

async function abrirPglite(dir) {
  const { PGlite, types } = await import('@electric-sql/pglite');
  const db = dir ? new PGlite(dir) : new PGlite();
  const opciones = { parsers: { [types.INT8]: (v) => (v === null ? null : Number(v)), [types.NUMERIC]: (v) => (v === null ? null : Number(v)), [types.DATE]: (v) => v } };
  // PGlite atiende una consulta a la vez: las transacciones se encadenan para no mezclarse.
  let cola = Promise.resolve();
  const enCola = (fn) => { const p = cola.then(fn, fn); cola = p.catch(() => {}); return p; };
  const query = (sql, p = []) => db.query(sql, p, opciones).then((r) => r.rows);
  return {
    query: (sql, p) => enCola(() => query(sql, p)),
    exec: (sql) => enCola(() => db.exec(sql)),
    transaccion: (fn) => enCola(() => db.transaction((tx) => fn({ query: (sql, p = []) => tx.query(sql, p, opciones).then((r) => r.rows) }))),
    cerrar: () => db.close()
  };
}

export async function abrir() {
  if (motor) return motor;
  if (config.baseDatos) motor = await abrirPg(config.baseDatos);
  else {
    if (config.pgliteDir) fs.mkdirSync(config.pgliteDir, { recursive: true });
    motor = await abrirPglite(config.pgliteDir);
  }
  return motor;
}

const m = () => { if (!motor) throw new Error('La base de datos no está abierta (llamar a abrir())'); return motor; };
export const q = (sql, params) => m().query(sql, params);
export const uno = async (sql, params) => (await m().query(sql, params))[0] || null;
export const exec = (sql) => m().exec(sql);
export const transaccion = (fn) => m().transaccion(fn);
export async function cerrar() { if (motor) { await motor.cerrar(); motor = null; } }

// Migraciones: archivos NNN_nombre.sql en src/migraciones, se aplican en orden y una sola vez.
export async function migrar() {
  await abrir();
  await exec('CREATE TABLE IF NOT EXISTS migraciones (nombre TEXT PRIMARY KEY, aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now())');
  const hechas = new Set((await q('SELECT nombre FROM migraciones')).map((r) => r.nombre));
  const archivos = fs.readdirSync(DIR_MIGRACIONES).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const aplicadas = [];
  for (const f of archivos) {
    if (hechas.has(f)) continue;
    const sql = fs.readFileSync(path.join(DIR_MIGRACIONES, f), 'utf8');
    await exec(`BEGIN;\n${sql}\n;INSERT INTO migraciones (nombre) VALUES ('${f}');\nCOMMIT;`).catch(async (e) => { await exec('ROLLBACK').catch(() => {}); throw new Error(`Migración ${f}: ${e.message}`); });
    aplicadas.push(f);
  }
  return aplicadas;
}

// Siguiente folio por empresa y tipo: R-1001, CT-2026-0001, INC-0001…
export async function siguienteFolio(empresaId, tipo, cx = null) {
  const ej = cx || { query: q };
  const [r] = await ej.query(
    `INSERT INTO folios (empresa_id, tipo, ultimo) VALUES ($1, $2, 1)
     ON CONFLICT (empresa_id, tipo) DO UPDATE SET ultimo = folios.ultimo + 1 RETURNING ultimo`, [empresaId, tipo]);
  const n = r.ultimo;
  const anio = new Date().getFullYear();
  if (tipo === 'R') return `R-${1000 + n}`;
  if (tipo === 'C') return `C-${String(n).padStart(4, '0')}`;
  if (tipo === 'CT' || tipo === 'LQ') return `${tipo}-${anio}-${String(n).padStart(4, '0')}`;
  return `${tipo}-${String(n).padStart(4, '0')}`;
}
