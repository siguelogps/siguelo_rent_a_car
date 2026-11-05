// Decisiones del arranque que conviene probar sin levantar el servidor (src/server.js las aplica).
//
// 🔥 5-nov (revisión exhaustiva, RNT-03): el Blueprint de Render fija SEMBRAR_DEMO=1 con NODE_ENV=production. En el primer
// arranque contra una base vacía eso dejaba en la base real la empresa «Andes Rent a Car» con sus usuarios Y el
// superadmin demo soporte@siguelogps.cl, una cuenta compartida del equipo Síguelo cuya clave queda en el panel de Render.
// La configuración de Render no se toca desde el código (la revisa Pablo); lo que sí se asegura aquí:
//   · En producción la demo nunca crea el superadmin demo: el equipo Síguelo entra con SUPERADMIN_CORREO/CLAVE (o desde
//     On Board), no con una cuenta compartida.
//   · En producción la demo no se siembra con la clave conocida «demo1234»: exige DEMO_CLAVE. Sin ella no se siembra.
//   · En desarrollo y pruebas (sin NODE_ENV=production) todo sigue igual: demo completa con demo1234.
export function planDemo({ produccion, sembrarDemo, demoClave = '' }) {
  if (!sembrarDemo) return { sembrar: false };
  const clave = String(demoClave || '');
  if (produccion && !clave) {
    return { sembrar: false, aviso: 'SEMBRAR_DEMO=1 en producción sin DEMO_CLAVE: no se crean datos de prueba (no se usa la clave conocida demo1234).' };
  }
  return { sembrar: true, clave: clave || 'demo1234', superadminDemo: !produccion };
}
