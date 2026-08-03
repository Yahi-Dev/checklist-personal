import type {
  AdvisorEvent,
  AdvisorTurn,
  PlanningAdvisorService,
} from '../../application/ports/services';
import type { AppSupabaseClient } from '../supabase/client';

import { appConfig } from '../../shared/config/app-config';
import { DomainErrors } from '../../domain/shared/domain-error';
import { isErr } from '../../domain/shared/result';
import { parseAdvisorPlan } from '../../domain/assistant/advisor-plan';

/**
 * El asistente, hablando con la Edge Function.
 *
 * Este adaptador es una FRONTERA DE DESCONFIANZA, y esa es su razon de ser mas que el
 * transporte en si. Al otro lado hay un modelo de lenguaje: el esquema de la
 * herramienta hace que el JSON llegue con la forma correcta, pero nada impide que un
 * identificador de tarea sea inventado, este repetido o apunte a algo que el usuario
 * borro hace un minuto. Por eso el plan no pasa de aqui sin validarse contra los
 * identificadores que de verdad viajaron en el resumen.
 *
 * De la clave de la API no hay ni rastro en este archivo, que es justo el objetivo:
 * vive como secreto de la funcion y nunca entra en el bundle.
 */

const FUNCTION_NAME = 'advisor';

/** Corta la espera si el servidor deja de mandar trozos. */
const IDLE_TIMEOUT_MS = 90_000;

export class EdgeAdvisorService implements PlanningAdvisorService {
  constructor(private readonly supabase: AppSupabaseClient) {}

  readonly isAvailable = true;

  async *ask(turn: AdvisorTurn): AsyncIterable<AdvisorEvent> {
    const knownTaskIds = new Set(turn.brief.tareas.map((task) => task.id as string));

    const { data } = await this.supabase.auth.getSession();
    const accessToken = data.session?.access_token;

    if (accessToken === undefined) {
      yield {
        type: 'error',
        error: DomainErrors.unauthenticated('Tu sesion caduco. Vuelve a entrar para seguir.'),
      };
      return;
    }

    // Un temporizador propio ademas del `signal` del usuario: si el servidor se queda
    // colgado sin cerrar la conexion, `fetch` no vence nunca por su cuenta y la
    // interfaz se quedaria con los tres puntitos para siempre.
    const idle = new AbortController();
    let timer = setTimeout(() => {
      idle.abort();
    }, IDLE_TIMEOUT_MS);

    const onExternalAbort = () => {
      idle.abort();
    };
    turn.signal?.addEventListener('abort', onExternalAbort);

    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    try {
      const response = await fetch(`${appConfig.supabase.url}/functions/v1/${FUNCTION_NAME}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          apikey: appConfig.supabase.anonKey,
        },
        body: JSON.stringify({ brief: turn.brief, messages: turn.messages }),
        signal: idle.signal,
      });

      if (!response.ok || response.body === null) {
        yield { type: 'error', error: await readErrorBody(response) };
        return;
      }

      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        clearTimeout(timer);
        timer = setTimeout(() => {
          idle.abort();
        }, IDLE_TIMEOUT_MS);

        buffer += decoder.decode(value, { stream: true });

        // Se procesa por eventos completos (`\n\n`). Un trozo de red puede partir un
        // evento por la mitad, y parsear medio JSON tiraria la conversacion entera.
        let separator = buffer.indexOf('\n\n');
        while (separator !== -1) {
          const raw = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);

          const event = this.toAdvisorEvent(raw, knownTaskIds);
          if (event !== null) yield event;

          separator = buffer.indexOf('\n\n');
        }
      }
    } catch (cause) {
      // Cancelar a proposito no es un error que haya que enseñar: el usuario ya sabe
      // que le dio a parar, y un aviso rojo despues de pulsarlo solo confunde.
      if (turn.signal?.aborted === true) return;

      yield {
        type: 'error',
        error: DomainErrors.infrastructure(
          idle.signal.aborted
            ? 'El asistente tardo demasiado en responder. Vuelve a intentarlo.'
            : 'No se pudo contactar con el asistente. Revisa tu conexion.',
        ),
      };
    } finally {
      clearTimeout(timer);
      turn.signal?.removeEventListener('abort', onExternalAbort);

      // Este `finally` tambien corre cuando el consumidor abandona el bucle a medias
      // (un `break`, o el componente que se desmonta), porque el motor cierra el
      // generador. Sin cancelar el lector, esa respuesta se quedaria abierta y el
      // servidor seguiria generando -y cobrando- una respuesta que ya nadie lee.
      await reader?.cancel().catch(() => undefined);
    }
  }

  private toAdvisorEvent(raw: string, knownTaskIds: ReadonlySet<string>): AdvisorEvent | null {
    const line = raw.split('\n').find((part) => part.startsWith('data: '));
    if (line === undefined) return null;

    let payload: unknown;
    try {
      payload = JSON.parse(line.slice(6));
    } catch {
      return null;
    }

    if (typeof payload !== 'object' || payload === null) return null;
    const message = payload as Record<string, unknown>;

    switch (message.type) {
      case 'text':
        return typeof message.text === 'string' ? { type: 'text', text: message.text } : null;

      case 'plan': {
        const parsed = parseAdvisorPlan(message.plan, knownTaskIds);
        return isErr(parsed)
          ? { type: 'error', error: parsed.error }
          : { type: 'plan', plan: parsed.value };
      }

      case 'done':
        return { type: 'done' };

      case 'error':
        return {
          type: 'error',
          error: DomainErrors.infrastructure(
            typeof message.message === 'string'
              ? message.message
              : 'El asistente no pudo completar la respuesta.',
          ),
        };

      default:
        return null;
    }
  }
}

/**
 * El asistente cuando no hay nube configurada.
 *
 * Existe para que el contenedor pueda construirse siempre con un puerto real y ningun
 * caso de uso tenga que preguntar si el servicio es `null`. La interfaz lee
 * `isAvailable` y explica que falta, en vez de ofrecer un chat que fallaria al enviar.
 */
export class UnavailableAdvisorService implements PlanningAdvisorService {
  readonly isAvailable = false;

  async *ask(): AsyncIterable<AdvisorEvent> {
    yield {
      type: 'error',
      error: DomainErrors.infrastructure(
        'El asistente necesita Supabase configurado y la funcion `advisor` desplegada.',
      ),
    };
  }
}

const readErrorBody = async (response: Response) => {
  if (response.status === 401 || response.status === 403) {
    return DomainErrors.unauthenticated('Tu sesion caduco. Vuelve a entrar para seguir.');
  }

  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string') return DomainErrors.infrastructure(body.error);
  } catch {
    /* El cuerpo no era JSON: se usa el mensaje generico de abajo. */
  }

  return DomainErrors.infrastructure(
    response.status === 404
      ? 'La funcion `advisor` no esta desplegada todavia. Ejecuta: supabase functions deploy advisor'
      : `El asistente respondio con un error (${String(response.status)}).`,
  );
};
