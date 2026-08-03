import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import type { AdvisorMessage, PlanOutcome } from '../../application/ports/services';
import type { AdvisorPlan } from '../../domain/assistant/advisor-plan';
import type { IsoDateTime } from '../../domain/task/value-objects/iso-date-time';
import type { PlanningBrief } from '../../domain/assistant/planning-brief';

import {
  ApplyAdvisorPlanUseCase,
  AskAdvisorUseCase,
} from '../../application/use-cases/assistant/advisor-commands';
import { getContainer } from '../../infrastructure/di/container';
import { isErr } from '../../domain/shared/result';

/**
 * La conversacion con el asistente.
 *
 * VIVE AQUI ARRIBA, Y NO EN LA PANTALLA, POR UN MOTIVO CONCRETO.
 *
 * Estaba en el propio componente, con el argumento de que una conversacion de
 * priorizacion solo sirve para el momento en que se tiene. El argumento vale para el dia
 * siguiente, pero no para lo que de verdad pasaba: el enrutador remonta cada pantalla al
 * cambiar de ruta, asi que bastaba tocar "Hoy" un segundo -para mirar justo lo que el
 * asistente acababa de nombrar- y al volver no quedaba nada. Justo el gesto que la
 * conversacion invita a hacer era el que la borraba.
 *
 * Al estar por encima del enrutador, ademas, una respuesta a medias sigue llegando
 * mientras se navega: se puede salir, mirar la lista y volver con la respuesta ya
 * completa en vez de haberla perdido.
 *
 * Se guarda entre recargas, pero SOLO DEL MISMO DIA. Es el equilibrio entre no perder
 * nada por cerrar la app sin querer y no arrastrar manaña un contexto que ya no describe
 * la situacion -y que ademas se pagaria en tokens en cada turno-.
 */

const STORAGE_KEY = 'checklist.asistente.conversacion';

export interface AdvisorChatState {
  readonly messages: readonly AdvisorMessage[];
  /** Lo que el asistente vio en el ultimo turno. La interfaz lo enseña bajo demanda. */
  readonly brief: PlanningBrief | null;
  readonly isStreaming: boolean;
  readonly isApplying: boolean;
  readonly isAvailable: boolean;
  send: (text: string) => Promise<void>;
  stop: () => void;
  applyPlan: (messageId: string, plan: AdvisorPlan) => Promise<void>;
  dismissPlan: (messageId: string) => void;
  reset: () => void;
}

const AdvisorChatContext = createContext<AdvisorChatState | null>(null);

export const AdvisorChatProvider = ({ children }: { children: ReactNode }) => {
  const container = getContainer();

  const [messages, setMessages] = useState<readonly AdvisorMessage[]>(loadTodaysConversation);
  const [brief, setBrief] = useState<PlanningBrief | null>(null);
  const [isStreaming, setStreaming] = useState(false);
  const [isApplying, setApplying] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const useCases = useMemo(
    () => ({
      ask: new AskAdvisorUseCase(container.context),
      apply: new ApplyAdvisorPlanUseCase(container.context),
    }),
    [container],
  );

  /**
   * Guarda tras cada cambio. Se llama a mano y no desde un efecto sobre `messages`
   * porque durante el flujo ese array cambia con CADA trozo de texto que llega: un
   * efecto escribiria en disco decenas de veces por respuesta.
   */
  const remember = useCallback((next: readonly AdvisorMessage[]) => {
    setMessages(next);
    save(next);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed === '' || isStreaming) return;

      const now: IsoDateTime = new Date().toISOString();

      const question: AdvisorMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        text: trimmed,
        plan: null,
        planOutcome: 'pendiente',
        at: now,
      };

      // El id de la respuesta se reserva ANTES de que llegue nada: los trozos que van
      // llegando necesitan un mensaje al que pegarse, y crearlo al recibir el primero
      // dejaria un hueco visible entre el envio y la primera letra.
      const answerId = crypto.randomUUID();
      const answer: AdvisorMessage = {
        id: answerId,
        role: 'assistant',
        text: '',
        plan: null,
        planOutcome: 'pendiente',
        at: now,
      };

      const history = [...messages, question];
      setMessages([...history, answer]);
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const started = await useCases.ask.execute({
        messages: history,
        signal: controller.signal,
      });

      if (isErr(started)) {
        setMessages((current) => {
          const next = current.map((message) =>
            message.id === answerId ? { ...message, text: started.error.message } : message,
          );
          save(next);
          return next;
        });
        setStreaming(false);
        abortRef.current = null;
        return;
      }

      setBrief(started.value.brief);

      const patchAnswer = (change: (message: AdvisorMessage) => AdvisorMessage) => {
        setMessages((current) =>
          current.map((message) => (message.id === answerId ? change(message) : message)),
        );
      };

      try {
        for await (const event of started.value.events) {
          if (controller.signal.aborted) break;

          switch (event.type) {
            case 'text':
              patchAnswer((message) => ({ ...message, text: message.text + event.text }));
              break;

            case 'plan':
              patchAnswer((message) => ({ ...message, plan: event.plan }));
              break;

            case 'error':
              patchAnswer((message) => ({
                ...message,
                // Si ya habia texto se conserva y el fallo se añade debajo: borrar media
                // respuesta util para poner un error es peor.
                text:
                  message.text === ''
                    ? event.error.message
                    : `${message.text}\n\n⚠ ${event.error.message}`,
              }));
              break;

            case 'done':
              break;
          }
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
        // Una sola escritura, con la respuesta ya completa.
        setMessages((current) => {
          save(current);
          return current;
        });
      }
    },
    [isStreaming, messages, useCases],
  );

  const markPlan = useCallback((messageId: string, outcome: PlanOutcome) => {
    setMessages((current) => {
      const next = current.map((message) =>
        message.id === messageId ? { ...message, planOutcome: outcome } : message,
      );
      save(next);
      return next;
    });
  }, []);

  const applyPlan = useCallback(
    async (messageId: string, plan: AdvisorPlan) => {
      setApplying(true);

      try {
        const result = await useCases.apply.execute({ plan });

        if (isErr(result)) {
          toast.error(result.error.message);
          return;
        }

        const { reordenadas, ajustadas, omitidas } = result.value;
        const parts: string[] = [];
        if (reordenadas > 0) parts.push(`${reordenadas} tareas en el nuevo orden`);
        if (ajustadas > 0) parts.push(`${ajustadas} ajustadas`);
        if (omitidas > 0) parts.push(`${omitidas} sin aplicar`);

        toast.success('Plan aplicado', {
          description: parts.join(' · '),
          // Se ofrece el salto en vez de navegar solo: aplicar el plan no siempre es el
          // final de la conversacion, y sacar al usuario del chat le cortaria el hilo.
          //
          // Se escribe el hash a mano en vez de usar `useNavigate` porque este proveedor
          // esta POR ENCIMA del enrutador -que es justo lo que hace que la conversacion
          // sobreviva- y ahi ese hook no existe. Con enrutado por hash, asignarlo es una
          // navegacion de pleno derecho.
          action: {
            label: 'Ver en Hoy',
            onClick: () => {
              globalThis.location.hash = '#/hoy';
            },
          },
        });

        markPlan(messageId, 'aplicado');
      } finally {
        setApplying(false);
      }
    },
    [markPlan, useCases],
  );

  const dismissPlan = useCallback(
    (messageId: string) => {
      markPlan(messageId, 'descartado');
    },
    [markPlan],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    remember([]);
    setBrief(null);
    setStreaming(false);
  }, [remember]);

  const value = useMemo<AdvisorChatState>(
    () => ({
      messages,
      brief,
      isStreaming,
      isApplying,
      isAvailable: container.context.advisor.isAvailable,
      send,
      stop,
      applyPlan,
      dismissPlan,
      reset,
    }),
    [
      messages,
      brief,
      isStreaming,
      isApplying,
      container,
      send,
      stop,
      applyPlan,
      dismissPlan,
      reset,
    ],
  );

  return <AdvisorChatContext value={value}>{children}</AdvisorChatContext>;
};

export const useAdvisorChat = (): AdvisorChatState => {
  const context = use(AdvisorChatContext);

  if (context === null) {
    throw new Error('useAdvisorChat tiene que usarse dentro de <AdvisorChatProvider>.');
  }

  return context;
};

// ---------------------------------------------------------------------------
// Persistencia del dia
// ---------------------------------------------------------------------------

interface StoredConversation {
  readonly savedAt: string;
  readonly messages: readonly AdvisorMessage[];
}

const sameLocalDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * Recupera la conversacion si es de hoy; si no, la descarta.
 *
 * Nunca lanza: un almacenamiento lleno, en modo privado o con un formato viejo tiene que
 * degradar a "empezamos de cero", jamas impedir que la app arranque.
 */
const loadTodaysConversation = (): readonly AdvisorMessage[] => {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw === null || raw === undefined) return [];

    const stored: unknown = JSON.parse(raw);
    if (!isStoredConversation(stored)) return [];

    if (!sameLocalDay(new Date(stored.savedAt), new Date())) {
      globalThis.localStorage?.removeItem(STORAGE_KEY);
      return [];
    }

    return stored.messages;
  } catch {
    return [];
  }
};

/**
 * Comprueba la forma de lo guardado en vez de dar por hecho que es correcta.
 *
 * Lo que sale del almacenamiento no es de fiar: puede venir de una version anterior de
 * la app, con otros campos. Un mensaje a medio formar reventaria al pintarse -y el fallo
 * saldria al abrir la pantalla, lejos de aqui-, asi que ante la duda se empieza limpio.
 */
const isStoredConversation = (value: unknown): value is StoredConversation => {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Partial<StoredConversation>;
  if (typeof candidate.savedAt !== 'string' || !Array.isArray(candidate.messages)) return false;

  return candidate.messages.every(
    (message: unknown) =>
      typeof message === 'object' &&
      message !== null &&
      typeof (message as AdvisorMessage).id === 'string' &&
      typeof (message as AdvisorMessage).text === 'string' &&
      ((message as AdvisorMessage).role === 'user' ||
        (message as AdvisorMessage).role === 'assistant'),
  );
};

const save = (messages: readonly AdvisorMessage[]): void => {
  try {
    if (messages.length === 0) {
      globalThis.localStorage?.removeItem(STORAGE_KEY);
      return;
    }

    const payload: StoredConversation = { savedAt: new Date().toISOString(), messages };
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* Sin sitio o sin permiso: la conversacion sigue viva en memoria, que es lo que
       importa para la sesion en curso. */
  }
};
