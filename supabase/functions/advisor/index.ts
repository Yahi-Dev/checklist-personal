/**
 * Edge Function: asistente de priorizacion.
 *
 * POR QUE EXISTE ESTA FUNCION, EN UNA FRASE: la clave de la API de Anthropic es un
 * secreto de verdad y no puede viajar al cliente.
 *
 * Conviene ser explicito porque en este proyecto ya hay una clave que SI va en el
 * bundle, y confundirlas seria caro. La clave `anon` de Supabase es publica por
 * diseño: identifica al proyecto y lo que protege los datos son las politicas RLS.
 * `ANTHROPIC_API_KEY` es lo contrario: quien la tenga gasta dinero de la cuenta sin
 * limite. En una PWA servida por GitHub Pages, "meterla en una variable de entorno de
 * Vite" significa publicarla en un archivo .js que cualquiera descarga. Por eso la
 * llamada al modelo ocurre aqui, donde la clave se queda.
 *
 * Lo que esta funcion NO hace, tambien a proposito: no toca la base de datos. Recibe
 * el resumen del dia que le manda el cliente, habla con el modelo y devuelve el flujo.
 * Ni siquiera necesita la clave de servicio. Escribir es cosa del dispositivo, que
 * pasa por sus casos de uso y su cola de sincronizacion (ver `advisor-plan.ts`).
 *
 * DESPLIEGUE
 *   supabase functions deploy advisor
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 *
 * Sin `--no-verify-jwt`: aqui el que llama SI es un usuario con sesion, y Supabase
 * rechaza la peticion antes de invocarnos si el token no vale.
 */

import Anthropic from 'npm:@anthropic-ai/sdk@0.115.0';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// --- Configuracion ---------------------------------------------------------

const MODEL = 'claude-opus-5';

/**
 * `medium` y no el `high` por defecto. Esto es un chat: el usuario mira la pantalla
 * mientras responde, asi que la latencia se nota en cada turno. Ordenar veinte tareas
 * con criterios explicitos no es de los problemas donde el esfuerzo alto cambia la
 * respuesta, y en Opus 5 los niveles bajos rinden notablemente bien.
 */
const EFFORT = 'medium';

/** Con streaming no hay riesgo de timeout, asi que el tope solo acota el gasto. */
const MAX_TOKENS = 8000;

/**
 * Reserva de modelo.
 *
 * Si los clasificadores de seguridad declinan la peticion, Anthropic la reintenta sola
 * en el modelo que corresponda en vez de devolver un rechazo. Priorizar tareas
 * domesticas no es terreno de rechazos, pero un falso positivo cuesta un turno perdido
 * y activarlo no cuesta nada. Como sigue en beta, el codigo reintenta sin ella si el
 * servidor la rechaza: el asistente tiene que seguir contestando, no caerse entero.
 */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Limites de entrada. La funcion esta autenticada, pero autenticado no es de fiar. */
const MAX_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 4000;
const MAX_BRIEF_TASKS = 60;

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

/**
 * `*` es correcto aqui: quien autoriza es el token Bearer, no el origen. No se usan
 * cookies, asi que no hay nada que un origen ajeno pueda reutilizar sin la sesion. Y
 * hace falta: en Electron la app se sirve por `file://`, cuyo origen es `null`.
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// --- Tipos del contrato con el cliente ------------------------------------

interface BriefTask {
  id: string;
  titulo: string;
  horizonte: 'atrasada' | 'hoy' | 'pronto' | 'sin-fecha';
  prioridad: 'low' | 'medium' | 'high';
  destacada: boolean;
  vence: string | null;
  minutosParaVencer: number | null;
  minutosEstimados: number | null;
  subtareas: { hechas: number; total: number } | null;
  vecesPospuesta: number;
  categoria: string | null;
  etiquetas: string[];
  notas: string | null;
}

interface PlanningBrief {
  ahora: string;
  zonaHoraria: string;
  tareas: BriefTask[];
  completadasHoy: number;
  omitidas: number;
}

interface ClientMessage {
  role: 'user' | 'assistant';
  text: string;
  plan: unknown;
  planOutcome: 'pendiente' | 'aplicado' | 'descartado';
}

// --- Herramienta -----------------------------------------------------------

/**
 * La unica herramienta. No escribe nada: devuelve una propuesta que el dispositivo
 * enseña y el usuario aprueba.
 *
 * Sin `strict: true` deliberadamente. El cliente valida el plan contra los
 * identificadores que existen de verdad antes de aplicarlo (`parseAdvisorPlan`), asi
 * que la garantia de esquema no aporta nada que no este ya cubierto, y no depender de
 * ella deja una superficie menos donde la peticion pueda ser rechazada.
 */
const PLAN_TOOL = {
  name: 'proponer_plan',
  description:
    'Propone un orden concreto de ejecucion para lo que el usuario tiene pendiente. ' +
    'Usalo en cuanto tengas criterio suficiente para decidir un orden, que suele ser ' +
    'en el primer turno. No lo uses si todavia necesitas un dato que cambiaria el orden, ' +
    'ni si el usuario solo esta preguntando algo puntual sobre una tarea.',
  input_schema: {
    type: 'object',
    properties: {
      resumen: {
        type: 'string',
        description:
          'Una o dos frases con la LOGICA del plan (que criterio mando y por que). ' +
          'No repitas la lista de pasos: ya va aparte.',
      },
      pasos: {
        type: 'array',
        description: 'Las tareas en el orden en que conviene hacerlas. Como mucho 12.',
        items: {
          type: 'object',
          properties: {
            taskId: {
              type: 'string',
              description: 'El id exacto de una tarea del resumen. Nunca inventes uno.',
            },
            minutos: {
              type: 'integer',
              description: 'Cuanto calculas que lleva. Pon 0 si no tienes con que estimarlo.',
            },
            porque: {
              type: 'string',
              description: 'El motivo de que vaya en esta posicion, en una linea.',
            },
          },
          required: ['taskId', 'minutos', 'porque'],
          additionalProperties: false,
        },
      },
      ajustes: {
        type: 'array',
        description:
          'Cambios sobre las tareas que el usuario podra aplicar de un toque. Lista ' +
          'vacia si no propones ninguno. No cambies la prioridad de algo solo para que ' +
          'encaje en el orden que elegiste.',
        items: {
          anyOf: [
            {
              type: 'object',
              properties: {
                taskId: { type: 'string' },
                tipo: { const: 'prioridad' },
                valor: { enum: ['high', 'medium', 'low'] },
              },
              required: ['taskId', 'tipo', 'valor'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                taskId: { type: 'string' },
                tipo: { const: 'destacar' },
                valor: { type: 'boolean' },
              },
              required: ['taskId', 'tipo', 'valor'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                taskId: { type: 'string' },
                tipo: { const: 'posponer' },
                valor: {
                  enum: ['esta-noche', 'manana', 'fin-de-semana', 'semana-que-viene'],
                },
              },
              required: ['taskId', 'tipo', 'valor'],
              additionalProperties: false,
            },
          ],
        },
      },
    },
    required: ['resumen', 'pasos', 'ajustes'],
    additionalProperties: false,
  },
} as const;

// --- Instrucciones ---------------------------------------------------------

const SYSTEM_PROMPT = `Eres el asistente de priorizacion de "Checklist Personal", la app de tareas de quien te escribe. Hablas español rioplatense neutro, con el trato de tu.

Tu trabajo es UNO: ayudar a decidir en que orden atacar lo pendiente, y por que. No eres un asistente de proposito general.

CON QUE DECIDES
En cada turno recibes el estado real del dia: las tareas pendientes con su vencimiento, prioridad, marca de destacada, estimacion, subtareas y cuantas veces se pospusieron. Eso es lo que hay; no supongas tareas que no aparecen.
El usuario aporta lo que tu no puedes ver: cuanto tiempo real tiene, con que energia esta, que compromisos son inamovibles, que le esta pesando. Eso suele importar mas que las fechas.

COMO PRIORIZAS
Lo atrasado no es automaticamente lo primero: a veces lo sensato es reconocer que ya no llega y reprogramarlo.
Una prioridad alta puesta hace dos semanas vale menos que un vencimiento de esta tarde.
Una tarea pospuesta muchas veces casi nunca es un problema de agenda: suele estar mal definida, ser mas grande de lo que aparenta, o depender de otra persona. Dilo cuando lo veas.
Aprovecha los bloques de tiempo reales: si quedan 40 minutos antes de una reunion, ahi no entra lo que lleva dos horas.
Agrupa lo que comparte contexto cuando no rompa el orden por urgencia.

COMO RESPONDES
Ve al grano. El usuario esta mirando la pantalla para decidir que hacer AHORA, no para leer.
Da el orden y el motivo. El motivo es lo que le permite corregirte.
Pregunta como mucho UNA cosa, y solo si la respuesta cambiaria el orden. Si con lo que hay ya puedes decidir, decide: mas vale un plan que se corrige que tres preguntas.
Di lo que no cabe. Un plan que finge que todo entra en el dia no sirve; si algo se queda fuera, dilo y propon cuando.
No repitas la lista de tareas en el texto: los pasos del plan ya se enseñan aparte.
Sin preambulos ni resumenes de lo que vas a hacer.

CUANDO PROPONER UN PLAN
Llama a proponer_plan en cuanto tengas criterio para un orden. Los ajustes (prioridad, destacar, posponer) son opcionales: proponlos solo cuando el dato actual este claramente mal, no para maquillar tu propio orden.
Si el usuario solo pregunta algo puntual, respondele y ya: no todo turno termina en un plan.`;

// --- Punto de entrada ------------------------------------------------------

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== 'POST') {
    return errorResponse(405, 'Metodo no permitido.');
  }

  if (ANTHROPIC_API_KEY === '') {
    return errorResponse(
      500,
      'Falta ANTHROPIC_API_KEY en los secretos de la funcion. Ejecuta: supabase secrets set ANTHROPIC_API_KEY=...',
    );
  }

  // Supabase ya valido el JWT antes de llegar aqui, pero se vuelve a resolver el
  // usuario: es lo que convierte "hay un token" en "hay una persona", y deja el id
  // disponible para las trazas sin abrir la puerta a llamadas anonimas.
  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) {
    return errorResponse(401, 'Falta la sesion.');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError !== null || userData.user === null) {
    return errorResponse(401, 'La sesion no es valida o caduco. Vuelve a entrar.');
  }

  let payload: { brief?: PlanningBrief; messages?: ClientMessage[] };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return errorResponse(400, 'El cuerpo de la peticion no es JSON valido.');
  }

  const validation = validate(payload);
  if (validation !== null) return errorResponse(400, validation);

  const brief = payload.brief as PlanningBrief;
  const messages = payload.messages as ClientMessage[];

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const titles = new Map(brief.tareas.map((task) => [task.id, task.titulo]));

  const params = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: EFFORT },
    system: [
      {
        type: 'text' as const,
        text: SYSTEM_PROMPT,
        // Las instrucciones no cambian entre turnos; el resumen del dia si, y por eso
        // viaja en el ultimo mensaje, despues de este punto de corte.
        cache_control: { type: 'ephemeral' as const },
      },
    ],
    tools: [PLAN_TOOL],
    messages: buildMessages(messages, brief, titles),
  };

  const abort = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();

      /**
       * Escribir en un controlador ya cerrado lanza, y hay dos formas de llegar ahi:
       * el usuario cancela (`cancel()` desconecta el flujo mientras seguimos iterando)
       * o se emite el error final. Ese fallo taparia el error de verdad con un
       * "Invalid state" inutil, asi que se traga a proposito.
       */
      let closed = false;

      const send = (event: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const close = (): void => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* Ya estaba cerrado por el otro extremo. */
        }
      };

      let emitted = 0;

      /**
       * Una pasada completa contra el modelo.
       *
       * `stream()` devuelve el objeto de forma SINCRONA: la peticion se resuelve al
       * iterarlo, asi que un 400 no aparece al crearlo sino aqui dentro. Por eso el
       * intento entero -crear, iterar y cerrar- vive en la misma funcion, y no solo
       * la creacion: de lo contrario el reintento de mas abajo nunca llegaria a
       * dispararse.
       */
      const attempt = async (withFallbacks: boolean) => {
        const run = anthropic.beta.messages.stream(
          withFallbacks ? { ...params, betas: [FALLBACK_BETA], fallbacks: 'default' } : params,
          { signal: abort.signal },
        );

        for await (const chunk of run) {
          if (
            chunk.type === 'content_block_delta' &&
            chunk.delta.type === 'text_delta' &&
            chunk.delta.text !== ''
          ) {
            emitted += 1;
            send({ type: 'text', text: chunk.delta.text });
          }
        }

        // El plan se emite entero al final y no trozo a trozo. Un JSON de herramienta a
        // medias no se puede parsear, y una tarjeta que se va rellenando sola mientras
        // el modelo se lo repiensa es peor de leer que una que aparece ya hecha.
        return await run.finalMessage();
      };

      try {
        let final;

        try {
          final = await attempt(true);
        } catch (cause) {
          // Solo se reintenta si no salio nada por el cable. Un 400 de validacion llega
          // antes de generar, asi que en la practica siempre se cumple; la condicion
          // esta para que un fallo tardio no repita texto ya escrito en pantalla.
          if (!isBadRequest(cause) || emitted > 0) throw cause;

          console.warn('Reserva de modelo rechazada, se reintenta sin ella:', describe(cause));
          final = await attempt(false);
        }

        if (final.stop_reason === 'refusal') {
          send({
            type: 'error',
            message: 'El modelo no pudo responder a eso. Prueba a plantearlo de otra forma.',
          });
          return;
        }

        for (const block of final.content) {
          if (block.type === 'tool_use' && block.name === PLAN_TOOL.name) {
            send({ type: 'plan', plan: block.input });
          }
        }

        send({ type: 'done' });
      } catch (cause) {
        // Cancelar no es un fallo que haya que contar: el usuario pulso parar.
        if (!abort.signal.aborted) send({ type: 'error', message: describe(cause) });
      } finally {
        // Un solo punto de cierre. Antes la rama de rechazo cerraba y despues el
        // `finally` volvia a cerrar, porque un `return` dentro del `try` tambien pasa
        // por el, y el segundo cierre lanza.
        close();
      }
    },

    // El usuario cerro la pestaña o pulso "parar": no tiene sentido seguir generando
    // (y pagando) una respuesta que ya no va a leer nadie.
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
});

// --- Construccion de la conversacion --------------------------------------

/**
 * Traduce la conversacion del cliente al formato de la API.
 *
 * Los planes anteriores se reinyectan como TEXTO, no como bloques `tool_use` con su
 * `tool_result` emparejado. Reconstruir esos pares obligaria a inventar identificadores
 * que no existieron nunca (el cliente jamas devolvio un resultado de herramienta:
 * devolvio una decision humana) y a mantener el emparejamiento intacto a lo largo de
 * toda la conversacion. Como contexto, un resumen legible cumple igual: el modelo
 * necesita saber que propuso y que se hizo con ello, no volver a ver la llamada.
 */
const buildMessages = (
  messages: ClientMessage[],
  brief: PlanningBrief,
  titles: Map<string, string>,
  // deno-lint-ignore no-explicit-any
): any[] => {
  // deno-lint-ignore no-explicit-any
  const out: any[] = [];

  for (const message of messages) {
    if (message.role === 'assistant') {
      const text = [message.text.trim(), renderPastPlan(message, titles)]
        .filter((part) => part !== '')
        .join('\n\n');

      // Un turno del asistente sin nada que decir romperia la alternancia.
      if (text !== '') out.push({ role: 'assistant', content: text });
      continue;
    }

    out.push({ role: 'user', content: message.text.trim() });
  }

  // El resumen del dia va pegado al ULTIMO mensaje del usuario, no al primero: asi el
  // modelo decide sobre el estado de ahora y no sobre el de hace cinco turnos.
  const last = out[out.length - 1];
  if (last !== undefined && last.role === 'user') {
    last.content = `${renderBrief(brief)}\n\n---\n\n${last.content as string}`;
  } else {
    out.push({ role: 'user', content: renderBrief(brief) });
  }

  return out;
};

const renderPastPlan = (message: ClientMessage, titles: Map<string, string>): string => {
  const plan = message.plan as { pasos?: { taskId: string; porque?: string }[] } | null;
  if (plan === null || plan === undefined || !Array.isArray(plan.pasos)) return '';

  const steps = plan.pasos
    .map((step, index) => `${index + 1}. ${titles.get(step.taskId) ?? step.taskId}`)
    .join('\n');

  const outcome =
    message.planOutcome === 'aplicado'
      ? 'El usuario APLICO este plan.'
      : message.planOutcome === 'descartado'
        ? 'El usuario DESCARTO este plan.'
        : 'El usuario todavia no ha decidido sobre este plan.';

  return `[Plan que propusiste:\n${steps}\n${outcome}]`;
};

/**
 * El resumen del dia en texto.
 *
 * En texto tabulado y no en JSON crudo: el JSON gasta tokens en llaves y comillas
 * repetidas en cada tarea, y las claves nulas ocupan sitio para no decir nada.
 */
const renderBrief = (brief: PlanningBrief): string => {
  const lines = brief.tareas.map((task) => {
    const parts = [
      `[${task.id}]`,
      task.titulo,
      `· ${task.horizonte}`,
      `· prioridad ${task.prioridad}`,
    ];

    if (task.destacada) parts.push('· DESTACADA');
    if (task.vence !== null) parts.push(`· vence ${task.vence}`);
    if (task.minutosParaVencer !== null && task.minutosParaVencer < 0) {
      parts.push(`· lleva ${formatDelay(-task.minutosParaVencer)} de retraso`);
    }
    if (task.minutosEstimados !== null) parts.push(`· estimada ${task.minutosEstimados} min`);
    if (task.subtareas !== null) {
      parts.push(`· subtareas ${task.subtareas.hechas}/${task.subtareas.total}`);
    }
    if (task.vecesPospuesta > 0) parts.push(`· pospuesta ${task.vecesPospuesta} veces`);
    if (task.categoria !== null) parts.push(`· ${task.categoria}`);
    if (task.etiquetas.length > 0) parts.push(`· #${task.etiquetas.join(' #')}`);
    if (task.notas !== null) parts.push(`\n    notas: ${task.notas}`);

    return `- ${parts.join(' ')}`;
  });

  const footer: string[] = [];
  if (brief.completadasHoy > 0) {
    footer.push(`Ya completo ${brief.completadasHoy} tarea(s) hoy.`);
  }
  if (brief.omitidas > 0) {
    footer.push(
      `AVISO: hay ${brief.omitidas} tarea(s) mas que no caben en este resumen. Si el ` +
        `plan depende de verlas todas, dilo en vez de dar por hecho que esto es el dia entero.`,
    );
  }

  return [
    `<estado_del_dia ahora="${brief.ahora}" zona="${brief.zonaHoraria}">`,
    lines.join('\n'),
    footer.join(' '),
    '</estado_del_dia>',
  ]
    .filter((part) => part !== '')
    .join('\n');
};

const formatDelay = (minutes: number): string => {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / (60 * 24))} dias`;
};

// --- Validacion y errores --------------------------------------------------

const validate = (payload: { brief?: PlanningBrief; messages?: ClientMessage[] }): string | null => {
  const { brief, messages } = payload;

  if (brief === undefined || !Array.isArray(brief.tareas)) {
    return 'Falta el resumen del dia.';
  }
  if (brief.tareas.length === 0) {
    return 'El resumen del dia no trae ninguna tarea.';
  }
  if (brief.tareas.length > MAX_BRIEF_TASKS) {
    return `El resumen trae demasiadas tareas (maximo ${MAX_BRIEF_TASKS}).`;
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return 'No hay ningun mensaje que responder.';
  }
  if (messages.length > MAX_MESSAGES) {
    return `La conversacion es demasiado larga (maximo ${MAX_MESSAGES} mensajes). Empieza una nueva.`;
  }
  if (messages.some((m) => typeof m.text !== 'string' || m.text.length > MAX_MESSAGE_CHARS)) {
    return `Algun mensaje supera los ${MAX_MESSAGE_CHARS} caracteres.`;
  }
  if (messages[messages.length - 1]?.role !== 'user') {
    return 'El ultimo mensaje tiene que ser del usuario.';
  }

  return null;
};

const isBadRequest = (cause: unknown): boolean =>
  typeof cause === 'object' && cause !== null && (cause as { status?: number }).status === 400;

/** Traduce el fallo a algo que el usuario pueda entender, sin filtrar internals. */
const describe = (cause: unknown): string => {
  const status = (cause as { status?: number } | null)?.status;

  if (status === 401 || status === 403) {
    return 'La clave de la API de Anthropic no es valida. Revisa el secreto de la funcion.';
  }
  if (status === 429) {
    return 'Se alcanzo el limite de peticiones. Espera un momento y vuelve a intentarlo.';
  }
  if (status !== undefined && status >= 500) {
    return 'El servicio del modelo no esta disponible ahora mismo. Reintenta en unos segundos.';
  }
  if (cause instanceof Error && cause.name === 'AbortError') {
    return 'Respuesta cancelada.';
  }

  console.error('Fallo del asistente:', cause);
  return 'No se pudo completar la respuesta del asistente.';
};

const errorResponse = (status: number, message: string): Response =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
