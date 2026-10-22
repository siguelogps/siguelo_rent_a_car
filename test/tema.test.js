// Modo claro / oscuro (/tema.js): tres estados (Automático, Claro, Oscuro), se recuerda por navegador, sobrevive a un
// almacenamiento bloqueado y se carga en el <head> antes de las hojas de estilo (sin parpadeo en claro).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const PUBLICO = new URL('../public/', import.meta.url).pathname;
const CODIGO = fs.readFileSync(path.join(PUBLICO, 'tema.js'), 'utf8');
const CLAVE = 'onrent-tema';

function correr({ guardado = null, sistemaOscuro = false, bloqueado = false, ruta = '/inicio', busqueda = '' } = {}) {
  const attrs = {};
  const datos = guardado ? { [CLAVE]: guardado } : {};
  const oyentes = {};
  const mq = { matches: sistemaOscuro, addEventListener: (_t, f) => { mq.f = f; } };
  const localStorage = {
    getItem: (k) => { if (bloqueado) throw new Error('bloqueado'); return k in datos ? datos[k] : null; },
    setItem: (k, v) => { if (bloqueado) throw new Error('bloqueado'); datos[k] = String(v); },
    removeItem: (k) => { if (bloqueado) throw new Error('bloqueado'); delete datos[k]; },
  };
  const elementos = [];
  const document = {
    documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k] ?? null, dataset: {} },
    createElement: () => { const el = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this['on' + t] = f; } }; elementos.push(el); return el; },
  };
  const window = { matchMedia: () => mq, addEventListener: (t, f) => { oyentes[t] = f; }, dispatchEvent: () => true };
  const ctx = { window, document, localStorage, location: { pathname: ruta, search: busqueda }, URLSearchParams, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } } };
  window.localStorage = localStorage;
  vm.runInNewContext(CODIGO, ctx);
  return { attrs, datos, mq, oyentes, api: window.SigueloTema };
}

test('Automático sigue al sistema operativo, también cuando cambia', () => {
  const r = correr({ sistemaOscuro: false });
  assert.equal(r.attrs['data-theme'], 'claro');
  assert.equal(r.attrs['data-tema-pref'], 'auto');
  r.mq.matches = true; r.mq.f();
  assert.equal(r.attrs['data-theme'], 'oscuro');
  assert.equal(correr({ sistemaOscuro: true }).attrs['data-theme'], 'oscuro');
});

test('lo elegido a mano manda sobre el sistema y queda guardado', () => {
  assert.equal(correr({ guardado: 'claro', sistemaOscuro: true }).attrs['data-theme'], 'claro');
  assert.equal(correr({ guardado: 'oscuro', sistemaOscuro: false }).attrs['data-theme'], 'oscuro');
  const r = correr();
  r.api.elegir('oscuro');
  assert.equal(r.datos[CLAVE], 'oscuro');
  r.api.elegir('auto');
  assert.equal(r.datos[CLAVE], undefined, 'Automático no deja nada guardado');
});

test('el botón pasa Automático → Claro → Oscuro → Automático', () => {
  const r = correr();
  const b = r.api.boton();
  const vistos = [];
  for (let i = 0; i < 3; i++) { b.onclick(); vistos.push(r.api.preferencia()); }
  assert.deepEqual(vistos, ['claro', 'oscuro', 'auto']);
  assert.match(b.title, /Automático/);
});

test('con el almacenamiento bloqueado no falla y sigue al sistema', () => {
  const r = correr({ bloqueado: true, sistemaOscuro: true });
  assert.equal(r.attrs['data-theme'], 'oscuro');
  r.api.elegir('claro');
  assert.equal(r.attrs['data-theme'], 'claro');
});

test('al imprimir queda en claro (informes y PDF siempre claros)', () => {
  const r = correr({ guardado: 'oscuro' });
  r.oyentes.beforeprint();
  assert.equal(r.attrs['data-theme'], 'claro');
  r.oyentes.afterprint();
  assert.equal(r.attrs['data-theme'], 'oscuro');
});

test('el formulario incrustado (/embed/…) queda siempre claro, como la web del rentacar', () => {
  assert.equal(correr({ guardado: 'oscuro', ruta: '/embed/andes-rent' }).attrs['data-theme'], 'claro');
});

test('cada página del sistema carga /tema.js antes de sus hojas de estilo', () => {
  for (const f of fs.readdirSync(PUBLICO).filter((n) => n.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(PUBLICO, f), 'utf8');
    if (!html.includes('/app.css')) continue; // hojas legales (privacidad, soporte, 404): quedan claras a propósito
    const i = html.indexOf('<script src="/tema.js"></script>');
    assert.ok(i > 0, `${f} no carga /tema.js`);
    assert.ok(i < html.indexOf('rel="stylesheet"'), `${f}: /tema.js debe ir antes de las hojas de estilo`);
  }
});
