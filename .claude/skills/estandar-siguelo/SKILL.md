---
name: estandar-siguelo
description: Reglas de trabajo de Síguelo GPS para cualquier cambio en sus herramientas (CRM Síguelo Gestión, Síguelo OS, On Bus, On Rent, On Tow, On Route, On Mix, On Book, On Check, Go, On Board). Úsala antes de programar, hacer un mockup, abrir un PR o encargarle trabajo a un agente, y al revisar lo que entregó. Cubre lenguaje en pantalla, datos, pantallas, plataforma GPS, git y entrega.
---

# Estándar Síguelo

Reglas que Pablo (dueño de Síguelo GPS) pidió y repitió en muchas sesiones. Valen para todas las herramientas. El `CLAUDE.md` de cada
repositorio manda si dice algo más específico.

## 1. Lo que ve el cliente
- **Español neutro, sin voseo.** «Elige», «Ingresa», «Revisa»; nunca «Elegí», «Ingresá». Fechas `dd-mm-aaaa HH:MM` (24 h, hora de Chile),
  montos CLP con punto de miles (`$1.234.567`), RUT con dígito verificador, patentes `BCDF-12`.
- **Nunca se nombra al proveedor de la plataforma GPS** (ni Wialon, Gurtam, Flespi, BSJ, Supabase) en pantallas, errores, correos ni PDF:
  se dice «plataforma GPS» (o Síguelo Pro / Síguelo Lite). En el código interno sí puede aparecer.
- **Vocabulario común:** «Conexiones» (no «Integraciones»), «Configuración» (no «Ajustes» ni «Mi Perfil»), «Cerrar sesión» (no «Salir»),
  «Mi cuenta», «Ver como» (no «Ingresar como»), «Activo / Desactivado», «Cliente» en el backoffice y «Empresa» para la propia del usuario.
- **No se inventan datos.** Lo que no se sabe se muestra «—». «No se pudo leer» no es «apagado» ni «cero». Un total no suma lo desconocido.
  Un paso que no se pudo comprobar nunca se marca «ok»: queda «con avisos» o en error, con el motivo.

## 2. Pantallas
- **Antes de cualquier cambio visual: mockup y visto bueno de Pablo.** Las capturas del proveedor o de Pablo pueden ser la maqueta.
- **Toda lista paginada de a 50** (también las de los modales). En el servidor, las listas que crecen se piden por partes (LIMIT/OFFSET).
  No se agregan botones «Ver más».
- **Búsqueda por palabras:** cada palabra en cualquier orden, sin mayúsculas ni tildes («juan perez» encuentra «Juan Carlos Pérez»).
- **Todo desplegable de 8 opciones o más lleva buscador** (selector buscable); el `<select>` nativo sigue siendo el valor.
- **Los modales se cierran solo con sus botones o Esc**; un clic fuera nunca los cierra. Con dos ventanas abiertas, Esc cierra solo la de arriba.
- **Botón principal amarillo y a la derecha**, «Cancelar» a su izquierda; rojo solo para acciones de riesgo (eliminar, cortar motor),
  que piden confirmación escribiendo el nombre.
- **Estándar de las 5 pantallas** (maqueta aprobada `estandar-siguelo.html`): ingreso «Ingresa a Síguelo <Producto>», menú lateral por grupos
  con Configuración al final, barra con «?» (solo si hay manual), avatar y «Mi cuenta» (Cambiar mi clave · Tema Claro/Automático/Oscuro · Cerrar
  sesión), Configuración con pestañas Empresa · Usuarios · Conexiones · Bandeja de salida · Bitácora, backoffice con menú oscuro y sello
  «BACKOFFICE SÍGUELO». Franjas: azul «Ver como» (solo lectura, bloqueado en el servidor), negra «Operar» y backoffice, amarilla marcha blanca.
- **Fuentes IBM Plex locales** (nada de Google Fonts). Modo oscuro de tres estados. Nada de `100vw`/`100vh`. Revisar a 400 px: sin desborde lateral.
- **Obligatorios con « *»** puesto por el helper común, no a mano.

## 3. Plataforma GPS
- **El cliente y la cuenta salen del token o la sesión, nunca del pedido.** Los secretos (tokens, claves, hashes) no vuelven al navegador
  ni se escriben en registros, bitácoras o correos internos.
- **Los IMEI se cruzan siempre completos**, nunca por el inicio (TAC) ni por los últimos dígitos.
- **Tipos de objeto en `core/search_items`:** usuarios = `user` (no `avl_user`, que devuelve vacío sin error; `avl_user` solo es el servicio
  de facturación), cuentas/recursos = `avl_resource`, unidades = `avl_unit`, grupos = `avl_unit_group`, tipos de equipo = `avl_hw`.
- **Muchas llamadas iguales van en lote** (`core/batch`, de a 50): la sesión con la plataforma es una fila y en serie cientos de cuentas
  tardan minutos.
- **Se elige el creador y eso define la cuenta**, como en la ventana de la plataforma.
- **Después de escribir, se comprueba con una lectura sin la copia de la sesión** (`core/search_items` con `force: 1` por `sys_id`).
- **Lo que no esté confirmado por la documentación** (que no se puede leer desde el ambiente de desarrollo) se marca «VALIDAR» en el código,
  se prueba en variantes en orden y se anota en el registro de Render **solo nombres de campos, códigos de error y la variante que funcionó**,
  nunca valores ni datos de clientes. Con una prueba de Pablo en producción se confirma y se ajusta.

## 4. Git y entrega
- **Siempre desde la rama por defecto actual del remoto** (`git fetch origin <rama>:refs/remotes/origin/<rama>`), en una **rama propia**.
  Nunca push ni merge a la rama por defecto; sin force-push.
- **Entrega por PR** (por la API REST: `gh api repos/siguelogps/<repo>/pulls -f title -f head -f base -f body`). Pablo hace el merge.
- **Nunca se suman commits a un PR ya abierto:** Pablo los fusiona en minutos y lo nuevo se pierde. Un cambio nuevo es un PR nuevo.
- **Commits en español que explican el porqué** (qué vio Pablo, la causa y la decisión), terminando con las líneas de atribución de la sesión.
  Cuerpo del PR en español: problema, causa, arreglo, pruebas y «Qué tienes que hacer». Sin nombres de modelos de IA en el repositorio.
- **Pruebas en verde antes del PR.** Cada conducta nueva lleva su prueba; si una conducta cambia, la prueba se actualiza con una nota del
  porqué, nunca se debilita para que pase. Si una prueba falla igual en la rama base (por hora, fecha o ambiente), se dice y se demuestra.
- **Comprobar en un navegador real** (Playwright ya instalado en `/opt/node-tools/node_modules/playwright/index.js`; no instalar otro) con
  capturas a 1300 y 400 px, claro y oscuro.
- **Migraciones:** las del CRM y las herramientas On se aplican solas; las de Síguelo OS van en `migraciones/` y Pablo las corre a mano en
  Supabase, en orden: se le entrega el archivo y se dice cuál correr.
- **Después de cada merge**, revisar que la publicación en Render quedó «live» y mirar el registro por errores.
- Nunca subir `.env`, claves, keystores, bases de datos ni datos reales.

## 5. Cómo hablarle a Pablo
- Respuestas cortas: qué cambió, qué tiene que hacer él (con el bloque listo para pegar si debe ejecutar algo) y lo que quedó por validar.
- Enlaces de PR completos. Si algo no se pudo comprobar, decirlo primero.
- Los avisos de «archivos sin seguimiento» por la carpeta `.claude/worktrees/` no son trabajo pendiente.
