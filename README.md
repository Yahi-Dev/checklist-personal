# Checklist Personal

Gestor de tareas personal **offline-first** con sincronización en la nube. Corre como
aplicación de escritorio en Windows (`.exe`) y como PWA en el iPhone, contra la misma
base de datos.

```
┌──────────────┐         ┌──────────────┐
│   Windows    │         │    iPhone    │
│  (Electron)  │         │    (PWA)     │
└──────┬───────┘         └──────┬───────┘
       │  IndexedDB local        │  IndexedDB local
       │  (fuente de verdad      │  (fuente de verdad
       │   para leer)            │   para leer)
       └────────────┬────────────┘
                    │  cola de salida + sincronización delta
             ┌──────▼───────┐
             │   Supabase   │  Postgres + RLS + Realtime + Storage
             └──────┬───────┘
                    │  Edge Function (guarda la clave; no toca la base)
             ┌──────▼───────┐
             │    Claude    │  Asistente de priorización
             └──────────────┘
```

---

## Qué hace

**Lo esencial**

- Captura rápida en lenguaje natural: escribes `comprar leche mañana 6pm !alta #casa`
  y sale la tarea con fecha, hora, prioridad y etiqueta. Debajo del campo se muestra en
  vivo lo que ha entendido, para que la interpretación sea verificable.
- Vista **Hoy** con lo que vence hoy **y lo que ya se venció**, en un bloque aparte.
- Completar con un toque y **deshacer** desde el aviso, sin diálogos de confirmación.
- Prioridad (alta / media / baja) y marca de destacado, independientes entre sí.
- Repeticiones: diaria, cada N días, días concretos de la semana, mensual y anual, con
  fin por fecha o por número de veces, y la opción "contar desde que la completo".
- Recordatorios a la hora que elijas, con notificación del sistema.

**Lo que marca la diferencia**

- Categorías y etiquetas, con filtros combinables.
- Subtareas con barra de progreso.
- Posponer con un toque: en 1 hora, esta noche, mañana, el fin de semana, la semana que viene.
- Búsqueda insensible a mayúsculas y acentos sobre títulos, notas y subtareas.
- Notas y adjuntos (enlaces y archivos hasta 10 MB).
- Calendario en vista mes o semana; al pulsar un día, la captura rápida queda anclada a esa fecha.
- Sincronización entre dispositivos, con resolución de conflictos y funcionamiento sin conexión.

**Asistente de priorización (con Claude)**

- Un chat que responde a "¿por dónde empiezo?". Ve tus tareas atrasadas, las de hoy y las
  de los próximos tres días, con prioridad, estimación, progreso de subtareas y cuántas
  veces has pospuesto cada una.
- Tú aportas lo que no cabe en la base de datos: cuánto tiempo real tienes, con qué
  cabeza estás, qué compromisos no se mueven.
- Propone un **orden concreto con el motivo de cada paso**, y opcionalmente ajustes de
  prioridad, destacado o posponer. Nada se aplica solo: hay que pulsar **Aplicar**.
- Al aplicar, los cambios pasan por los mismos casos de uso que un toque tuyo, así que
  respetan las reglas del dominio, funcionan sin conexión y se sincronizan por la cola de
  siempre.
- La clave de la API vive como secreto de una Edge Function y **nunca entra en el
  bundle**. Ver [§ 8](#8-asistente-de-priorización-opcional).

**Extras**

- Estadísticas: rachas, actividad diaria, en qué días rindes más, desglose por categoría
  y "lo que más pospones".
- Modo enfoque (Pomodoro) enlazado a una tarea concreta.
- Exportar e importar en JSON, y exportar a CSV.
- Modo claro / oscuro / automático.
- Bandeja del sistema, contador en la barra de tareas y arranque con Windows.

**Lo que NO hace, y por qué**

| Pedido                                     | Estado                                       | Motivo                                                                                                                                                       |
| ------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Recordatorios por ubicación                | El modelo de datos lo soporta; no se dispara | Ningún navegador permite geolocalización en segundo plano. `watchPosition` se detiene al pasar la pestaña a segundo plano. Requeriría una app nativa de iOS. |
| Widget en la pantalla de inicio del iPhone | No disponible                                | Los widgets de iOS exigen una extensión en Swift dentro de una app nativa. Una PWA no puede declararlos.                                                     |
| Integración con Google Calendar            | No incluido                                  | Necesita OAuth con pantalla de consentimiento verificada por Google. Se puede añadir después sobre el puerto `SyncService`.                                  |

---

## Puesta en marcha

### 1. Requisitos

- Node.js 20.19+ (probado con 22)
- pnpm 10+
- Una cuenta de Supabase (plan gratuito)

### 2. Instalar

```bash
pnpm install
cp .env.example .env
```

### 3. Configurar Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. Copia la URL y la clave `anon` desde **Project Settings → Data API** a tu `.env`:

   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGci...
   ```

3. Aplica el esquema. Con la CLI de Supabase:

   ```bash
   pnpm dlx supabase link --project-ref <tu-ref>
   pnpm dlx supabase db push
   ```

   O pega a mano, en orden, los archivos de [`supabase/migrations/`](supabase/migrations/)
   en el editor SQL del panel.

> Sin `.env` la app **también arranca**: funciona en modo local contra IndexedDB, sin
> cuenta y sin sincronización. Es útil para probarla antes de configurar nada.

### 4. Desarrollo

```bash
pnpm dev            # navegador, http://localhost:5173
pnpm dev:desktop    # ventana de Electron con recarga en caliente
```

### 5. Generar el `.exe`

```bash
pnpm build:win
```

Deja en `release/`:

- `Checklist Personal-1.0.0-x64.exe` — instalador (elige carpeta, crea accesos directos)
- `Checklist Personal-1.0.0-portable.exe` — ejecutable único, sin instalar

### 6. Instalarla en el iPhone

La PWA necesita estar servida por **HTTPS**. La forma gratuita es GitHub Pages:

1. En GitHub: **Settings → Pages → Source: GitHub Actions**.
2. Añade los secretos del repositorio (**Settings → Secrets and variables → Actions**):
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y, si usas notificaciones,
   `VITE_VAPID_PUBLIC_KEY`.
3. Haz push a `main`. El flujo de trabajo publica en
   `https://yahi-dev.github.io/checklist-personal/`.
4. En el iPhone, abre esa URL en **Safari** → botón Compartir → **Añadir a inicio**.

> El paso 4 no es opcional. En una pestaña normal de Safari no existe el permiso de
> notificaciones: iOS solo lo concede a las PWA añadidas a la pantalla de inicio.

### 7. Notificaciones con la app cerrada (opcional)

Un `setTimeout` muere al cerrar la pestaña, y iOS no permite alarmas en segundo plano a
las aplicaciones web. La única vía que despierta al teléfono es Web Push, y eso exige un
emisor con llave privada:

```bash
pnpm keys:vapid          # genera el par de llaves e imprime las instrucciones

# La pública va al cliente:
#   VITE_VAPID_PUBLIC_KEY=...   en .env

# La privada nunca sale del servidor:
pnpm dlx supabase secrets set VAPID_PUBLIC_KEY=...
pnpm dlx supabase secrets set VAPID_PRIVATE_KEY=...
pnpm dlx supabase secrets set VAPID_SUBJECT=mailto:tu@correo.com
pnpm dlx supabase functions deploy dispatch-reminders --no-verify-jwt
```

La migración `0004` programa un `pg_cron` que llama a esa función cada minuto. Antes de
aplicarla hay que guardar dos secretos en el Vault de Supabase (`project_url` y
`service_role_key`); las instrucciones están comentadas dentro del propio archivo SQL.

### 8. Asistente de priorización (opcional)

```bash
# La clave se guarda como secreto de la función. NO va en .env.
pnpm dlx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
pnpm dlx supabase functions deploy advisor
```

Sin esto, la pantalla del asistente explica qué falta y el resto de la app funciona igual.

**Por qué esta clave sí necesita servidor y la de Supabase no.** Son secretos de
naturaleza distinta y conviene no mezclarlos:

| Clave                    | ¿Va en el bundle?             | Qué protege los datos                                                    |
| ------------------------ | ----------------------------- | ------------------------------------------------------------------------ |
| `VITE_SUPABASE_ANON_KEY` | Sí, **es pública por diseño** | Las políticas RLS. Identifica el proyecto, no autoriza nada por sí sola. |
| `ANTHROPIC_API_KEY`      | **Nunca**                     | Nada: quien la tenga gasta de tu cuenta sin límite.                      |

En una PWA servida por GitHub Pages, "ponerla en una variable de Vite" significa
publicarla en un `.js` que cualquiera descarga. Por eso la llamada al modelo ocurre en
[`supabase/functions/advisor`](supabase/functions/advisor/index.ts), que verifica la
sesión del usuario y hace de proxy del flujo. Esa función **no toca la base de datos** y
ni siquiera necesita la clave de servicio.

Se puede comprobar sobre el bundle compilado:

```bash
pnpm run build:web
grep -ril "anthropic\|sk-ant" dist/    # no debe devolver nada
```

**Modelo y coste.** Usa `claude-opus-5` con esfuerzo `medium` y respuesta en streaming.
El resumen que se envía es una proyección recortada de las tareas (máximo 40, sin
adjuntos ni rutas de Storage), no el agregado completo: cada campo que viaja se paga en
tokens en cada turno de la conversación.

---

## Arquitectura

Arquitectura hexagonal en cuatro capas, con las dependencias apuntando **siempre hacia
dentro**:

```
src/
├── domain/          Reglas de negocio. CERO dependencias externas.
│   ├── task/           Agregado Tarea: entidad, value objects, especificaciones
│   ├── recurrence/     Repeticiones (patrón Strategy, una por frecuencia)
│   ├── assistant/      Resumen del día y validación del plan propuesto
│   ├── category/  tag/  focus/  stats/
│   └── shared/         Result, DomainError, Clock, IdGenerator, Specification
│
├── application/     Casos de uso. Depende del dominio y de PUERTOS, nunca de Supabase.
│   ├── ports/          Interfaces: repositorios y servicios
│   ├── use-cases/      Un caso de uso = una clase con un método execute()
│   ├── parsing/        Analizador de lenguaje natural en español
│   └── services/       Planificador de recordatorios
│
├── infrastructure/  Adaptadores. Implementa los puertos.
│   ├── persistence/    Dexie (IndexedDB) + cola de salida
│   ├── supabase/       Cliente, mapeadores, autenticación, Storage
│   ├── sync/           Motor de sincronización
│   ├── assistant/      Cliente SSE de la Edge Function del asistente
│   ├── notifications/  Web y Electron
│   └── di/             Raíz de composición
│
├── features/ widgets/ pages/ app/    Interfaz (Feature-Sliced Design)
└── shared/          Sistema de diseño, utilidades, configuración
```

**Esta separación no es una convención escrita en un README: la comprueba el linter.**
`eslint-plugin-boundaries` rechaza en compilación cualquier import que vaya en la
dirección equivocada.

```bash
# Si el dominio importa infraestructura:
error  There is no policy allowing dependencies from elements of type
       "domain" to elements of type "infrastructure"    boundaries/dependencies
```

### Decisiones que conviene conocer

**El dominio son datos inmutables y funciones puras, no clases con estado.**
Una tarea tiene que sobrevivir intacta a IndexedDB (`structuredClone`), al puente IPC de
Electron, a `JSON.stringify` en la cola de sincronización y a la comparación por
referencia de React. Una clase con métodos pierde su prototipo en la primera frontera y
obliga a rehidratar en cada salto.

**Las subtareas y los adjuntos viven como `jsonb` en la fila de la tarea, no normalizados.**
Una Tarea es un agregado: su frontera transaccional incluye sus subtareas. Con tablas
separadas, guardar una tarea son tres escrituras que pueden sincronizarse por separado, y
aparece el estado "llegó la subtarea pero no su tarea padre". Una fila por agregado hace
que cada operación de sincronización sea atómica por construcción.

**Dos columnas de tiempo: `updated_at` y `server_updated_at`.**
La primera la escribe el cliente y resuelve conflictos (gana la más reciente). La segunda
la escribe un trigger con la hora del servidor y es la marca de agua para bajar cambios.
Con una sola columna, un teléfono con el reloj atrasado escribiría filas "en el pasado"
que quedarían por detrás de la marca guardada y **no se bajarían nunca**.

**Conflictos por "gana el último en escribir", no CRDT.**
Los CRDT resuelven varias personas editando a la vez. Aquí hay una persona con dos
dispositivos, y el conflicto real —editar la misma tarea en ambos, sin conexión, en el
mismo minuto— es rarísimo. La regla se explica en una frase y se depura leyendo una
columna. Un CRDT serían miles de líneas para un caso que casi nunca ocurre.

**El borrado es lógico, nunca físico.**
La fila con `deleted_at` es lo único que propaga un borrado al otro dispositivo. Un
`DELETE` real simplemente reaparecería en la siguiente sincronización.

**Se ejecuta al instante y se ofrece deshacer, en lugar de confirmar antes.**
Confirmar cuesta un toque **cada vez**; deshacer cuesta un toque **solo cuando te
equivocas**, que es mucho más raro.

**El asistente propone; quien escribe es el dispositivo.**
La alternativa —que la Edge Function aplicara los cambios directamente en Postgres— era
más corta de escribir y peor en tres frentes. Las invariantes del dominio dejarían de
valer (nada impediría posponer al pasado); el dispositivo no se enteraría hasta la
siguiente bajada, así que el estado local mentiría un rato; y desaparecería el deshacer,
porque el camino de escritura sería otro. Tal como está, el modelo devuelve una propuesta
inerte y aplicarla pasa por los mismos casos de uso que un toque del usuario. Como efecto
secundario, la función no necesita la clave de servicio: solo la de Anthropic.

**El plan se valida contra los identificadores que existen, antes de tocar nada.**
El esquema de la herramienta garantiza la forma del JSON, no que los identificadores
sean reales: un modelo puede citar una tarea que no existe o repetir una dos veces. Sin
ese filtro
([`parseAdvisorPlan`](src/domain/assistant/advisor-plan.ts)), un id inventado reventaría
a mitad de aplicar y dejaría medio plan escrito. Lo descartado se cuenta y se enseña en
la tarjeta: un plan que encoge sin explicación es peor que uno que dice qué se cayó.

---

## Diseño

Dirección de arte **"Soft Focus"**: lienzo con un tinte lavanda casi imperceptible,
acento periwinkle (hue 282 en oklch), semánticos pastel y una aurora ambiental de
tres gradientes radiales tras el contenido, en claro y en oscuro. La noche es
índigo, no negro.

Todo el sistema vive como tokens de `@theme` en
[`global.css`](src/app/styles/global.css) — colores, radios, sombras teñidas con el
tono de marca y **animaciones como tokens** (`--animate-pop`, `--animate-rise-in`,
`ease-spring` con rebote 1.56). Micro-interacciones: entrada escalonada de la lista,
píldora deslizante en la navegación móvil, pop del checkbox al completar, halo del
acento en la captura rápida y anillo Pomodoro con degradado que respira. Todas se
apagan solas con `prefers-reduced-motion`.

El diseño se validó **iterando con capturas de la app corriendo** (Edge headless):
la primera pasada sacó a la luz el modo oscuro demasiado negro, una estrella
duplicada en tareas destacadas y la pista del anillo invisible en oscuro — las tres
corregidas y re-verificadas en la segunda pasada.

---

## Comandos

| Comando                                                | Qué hace                                                |
| ------------------------------------------------------ | ------------------------------------------------------- |
| `pnpm dev`                                             | Servidor de desarrollo en el navegador                  |
| `pnpm dev:desktop`                                     | Ventana de Electron con recarga en caliente             |
| `pnpm build:web`                                       | Build de la PWA en `dist/`                              |
| `pnpm build:win`                                       | Instalador y portable en `release/`                     |
| `pnpm verify`                                          | typecheck + lint + pruebas                              |
| `pnpm test` / `pnpm test:watch` / `pnpm test:coverage` | Pruebas                                                 |
| `pnpm icons`                                           | Regenera todos los iconos (PNG e ICO, sin dependencias) |
| `pnpm keys:vapid`                                      | Genera el par de llaves para Web Push                   |
| `pnpm db:push`                                         | Aplica las migraciones a Supabase                       |

---

## Pruebas

167 pruebas, centradas donde vive la lógica:

- **Dominio** — recurrencias (31 de enero + 1 mes, años bisiestos, fase de "cada 2
  semanas"), reglas de completado y repetición, especificaciones de la vista Hoy,
  rachas, indexación fraccionaria, y el resumen y el plan del asistente (incluido un
  modelo que cita tareas inexistentes o repetidas).
- **Aplicación** — el analizador de lenguaje natural (38 casos) y los casos de uso
  contra repositorios en memoria. El asistente se ejercita con un doble con guion, sin
  red y sin clave de API: es lo que compra haberlo definido como puerto.
- **Infraestructura** — los repositorios contra **IndexedDB de verdad** (vía
  `fake-indexeddb`), porque un índice compuesto mal declarado solo se manifiesta ahí.

- **Humo de la app completa** — monta `<App />` de verdad y crea una tarea de
  extremo a extremo: analizador → caso de uso → IndexedDB → repintado de la lista.

No hay pruebas de renderizado de componentes mas alla del humo: comprobarían el
marcado, se romperían con cada cambio de estilo y no detectarían ni un fallo real.

```bash
pnpm test
```

---

## Estructura del repositorio

```
electron/          Proceso principal y preload (contextIsolation, sin nodeIntegration)
scripts/           Compilación de Electron, generación de iconos y llaves VAPID
src/               Aplicación (ver Arquitectura)
supabase/
  migrations/      Esquema, RLS, Storage y recordatorios push
  functions/
    dispatch-reminders/  Envía las notificaciones push
    advisor/             Proxy del asistente (guarda la clave de Anthropic)
tests/             Pruebas de dominio, aplicación e infraestructura
```

---

## Licencia

MIT
