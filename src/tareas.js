// Tareas programadas (en el mismo proceso). Cada módulo registra la suya con registrarTarea().
// Render y cualquier contenedor sirven así; si más adelante se escala a varias instancias, se activan solo en una (TAREAS=0 en las demás).
const tareas = [];
export function registrarTarea(nombre, cadaMs, fn) { tareas.push({ nombre, cadaMs, fn }); }

export async function correrTarea(nombre) {
  const t = tareas.find((x) => x.nombre === nombre);
  if (t) await t.fn();
}

export async function iniciarTareas() {
  // Los módulos se registran al importarse (src/api/*.js ya se cargaron en crearApp)
  for (const t of tareas) {
    const correr = async () => { try { await t.fn(); } catch (e) { console.error(`[tarea ${t.nombre}]`, e.message); } };
    setTimeout(correr, 15e3);
    setInterval(correr, t.cadaMs).unref();
  }
  if (tareas.length) console.log(`Tareas programadas: ${tareas.map((t) => t.nombre).join(', ')}`);
}
