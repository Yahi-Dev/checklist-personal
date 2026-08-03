import { toast } from 'sonner';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

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
 * El estado de la conversacion con el asistente.
 *
 * VIVE EN MEMORIA Y SE PIERDE AL SALIR DE LA PANTALLA. No es un descuido: la
 * conversacion util es la de este momento ("tengo hora y media antes de la reunion"),
 * y arrastrarla manaña no ayuda a decidir nada, solo abulta el contexto que se manda
 * al modelo y el coste de cada turno. Lo que si persiste es lo unico que importa: los
 * cambios que el usuario decidio aplicar, que son tareas de verdad.
 */

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

export const useAdvisorChat = (): AdvisorChatState => {
  const container = getContainer();
  const navigate = useNavigate();

  const [messages, setMessages] = useState<readonly AdvisorMessage[]>([]);
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
        setMessages((current) =>
          current.map((message) =>
            message.id === answerId ? { ...message, text: started.error.message } : message,
          ),
        );
        setStreaming(false);
        abortRef.current = null;
        return;
      }

      setBrief(started.value.brief);

      try {
        for await (const event of started.value.events) {
          if (controller.signal.aborted) break;

          switch (event.type) {
            case 'text':
              setMessages((current) =>
                current.map((message) =>
                  message.id === answerId
                    ? { ...message, text: message.text + event.text }
                    : message,
                ),
              );
              break;

            case 'plan':
              setMessages((current) =>
                current.map((message) =>
                  message.id === answerId ? { ...message, plan: event.plan } : message,
                ),
              );
              break;

            case 'error':
              setMessages((current) =>
                current.map((message) =>
                  message.id === answerId
                    ? {
                        ...message,
                        // Si ya habia texto se conserva y el fallo se añade debajo:
                        // borrar media respuesta util para poner un error es peor.
                        text:
                          message.text === ''
                            ? event.error.message
                            : `${message.text}\n\n⚠ ${event.error.message}`,
                      }
                    : message,
                ),
              );
              break;

            case 'done':
              break;
          }
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [isStreaming, messages, useCases],
  );

  const markPlan = useCallback((messageId: string, outcome: PlanOutcome) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId ? { ...message, planOutcome: outcome } : message,
      ),
    );
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
          action: {
            label: 'Ver en Hoy',
            onClick: () => {
              void navigate('/hoy');
            },
          },
        });

        markPlan(messageId, 'aplicado');
      } finally {
        setApplying(false);
      }
    },
    [markPlan, navigate, useCases],
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
    setMessages([]);
    setBrief(null);
    setStreaming(false);
  }, []);

  return {
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
  };
};
