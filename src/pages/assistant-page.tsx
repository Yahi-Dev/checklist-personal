import { ArrowUp, CloudOff, Eye, RotateCcw, Sparkles, Square } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

import type { AdvisorMessage } from '../application/ports/services';

import { AdvisorPlanCard } from '../features/assistant/advisor-plan-card';
import { Button, Spinner } from '../shared/ui/button';
import { cn } from '../shared/lib/cn';
import { EmptyState } from '../shared/ui/feedback';
import { PageContent, PageHeader } from '../shared/ui/layout';
import { useAdvisorChat } from '../app/providers/advisor-chat-provider';

/**
 * El asistente de priorizacion.
 *
 * La pregunta que resuelve esta pantalla no es "¿que tengo que hacer?" -para eso esta
 * la lista- sino "¿por donde empiezo?". La diferencia esta en el contexto que solo
 * tiene el usuario: cuanto tiempo real le queda, con que cabeza esta, que no se puede
 * mover. Nada de eso cabe en un campo de la base de datos, y por eso la interfaz es
 * una conversacion y no un boton de "ordenar por mi".
 *
 * Lo que el asistente propone NO se aplica solo. Aparece como una tarjeta con el orden
 * y el motivo de cada paso, y hay que pulsar Aplicar. Un asistente que reorganiza el
 * dia sin preguntar es un asistente que se desactiva la segunda vez que se equivoca.
 */

const SUGGESTIONS = [
  'Tengo hora y media libre antes de una reunion. ¿Que hago?',
  'Estoy cansado, dame algo que pueda cerrar rapido.',
  'Se me acumulo todo. ¿Que dejo para mañana?',
] as const;

export const AssistantPage = () => {
  const chat = useAdvisorChat();
  const [draft, setDraft] = useState('');
  const [showBrief, setShowBrief] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Se sigue el final de la conversacion en vez de calcular alturas: el compositor es
  // pegajoso y la barra movil es fija, asi que un `scrollTop = scrollHeight` dejaria
  // las ultimas lineas escondidas debajo. `useLayoutEffect` y no `useEffect` porque
  // con el efecto normal el navegador llega a pintar antes de bajar y se ve el salto.
  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [chat.messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    const text = draft;
    setDraft('');
    void chat.send(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter envia y Mayus+Enter salta de linea: es lo que la mano ya espera de un chat.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  if (!chat.isAvailable) {
    return (
      <>
        <PageHeader title="Asistente" subtitle="Te ayuda a decidir por donde empezar" />
        <PageContent>
          <EmptyState
            icon={<CloudOff />}
            title="El asistente necesita la nube"
            description="Configura Supabase y despliega la funcion `advisor` para poder usarlo. Mientras tanto, el resto de la app funciona igual en local."
          />
        </PageContent>
      </>
    );
  }

  const hasConversation = chat.messages.length > 0;

  return (
    <>
      <PageHeader
        title="Asistente"
        subtitle="Cuentale tu situacion y te dice por donde empezar"
        actions={
          <>
            {chat.brief !== null && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={showBrief ? 'Ocultar lo que vio' : 'Ver lo que vio'}
                onClick={() => {
                  setShowBrief((visible) => !visible);
                }}
              >
                <Eye className={cn('size-4.5', showBrief && 'text-brand-500')} />
              </Button>
            )}

            {hasConversation && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Empezar de nuevo"
                onClick={chat.reset}
              >
                <RotateCcw className="size-4.5" />
              </Button>
            )}
          </>
        }
      />

      {/* `flex-1` para que la conversacion ocupe el alto disponible y el compositor
          quede pegado abajo. Sin esto, una conversacion corta lo deja flotando a media
          pantalla con un hueco muerto debajo. */}
      <PageContent className="flex flex-1 flex-col gap-4 pb-2">
        {showBrief && chat.brief !== null && <BriefPanel count={chat.brief.tareas.length} />}

        {!hasConversation ? (
          <EmptyState
            className="my-auto"
            icon={<Sparkles />}
            title="¿Por donde empiezo hoy?"
            description="El asistente ya ve tus tareas, sus fechas y sus prioridades. Lo que le falta es lo que solo sabes tu."
            action={
              <div className="flex w-full max-w-md flex-col gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => {
                      void chat.send(suggestion);
                    }}
                    className={cn(
                      'rounded-card border border-line bg-panel px-4 py-2.5 text-left text-sm',
                      'text-ink-soft shadow-soft transition-all duration-200 ease-spring',
                      'hover:-translate-y-0.5 hover:border-brand-300 hover:text-ink hover:shadow-raised',
                    )}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            }
          />
        ) : (
          chat.messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              isApplying={chat.isApplying}
              isStreaming={chat.isStreaming}
              onApply={() => {
                if (message.plan !== null) void chat.applyPlan(message.id, message.plan);
              }}
              onDismiss={() => {
                chat.dismissPlan(message.id);
              }}
            />
          ))
        )}

        <div ref={bottomRef} />
      </PageContent>

      {/* El compositor se pega al fondo del viewport, pero en movil la barra de
          navegacion es FIJA y quedaria encima: el relleno inferior le deja el hueco
          justo, mas el area segura del iPhone. */}
      <div
        className={cn(
          'sticky bottom-0 z-30 border-t border-line bg-canvas/85 px-4 backdrop-blur-md',
          'pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+4.25rem)] lg:px-6 lg:pb-3',
        )}
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Tengo dos horas y estoy con poca cabeza…"
            className={cn(
              'max-h-40 min-h-11 flex-1 resize-none rounded-card border border-line bg-panel px-4 py-3',
              'text-sm text-ink shadow-soft transition-shadow duration-200 outline-none',
              'placeholder:text-ink-faint focus:border-brand-300 focus:shadow-glow',
            )}
          />

          {chat.isStreaming ? (
            <Button variant="secondary" size="icon-lg" onClick={chat.stop} aria-label="Parar">
              <Square className="size-4 fill-current" />
            </Button>
          ) : (
            <Button
              variant="primary"
              size="icon-lg"
              onClick={submit}
              disabled={draft.trim() === ''}
              aria-label="Enviar"
            >
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>
    </>
  );
};

// ---------------------------------------------------------------------------

const MessageBubble = ({
  message,
  isApplying,
  isStreaming,
  onApply,
  onDismiss,
}: {
  message: AdvisorMessage;
  isApplying: boolean;
  isStreaming: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) => {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <p
          className={cn(
            'max-w-[85%] animate-rise-in rounded-card rounded-br-sm px-4 py-2.5',
            'bg-brand-gradient text-sm text-white shadow-soft',
          )}
        >
          {message.text}
        </p>
      </div>
    );
  }

  // Respuesta todavia vacia: el modelo esta pensando. Sin esto la pantalla se queda
  // igual tras enviar y parece que no se registro el mensaje.
  const isThinking = message.text === '' && message.plan === null;

  return (
    <div className="space-y-3">
      {isThinking ? (
        <div className="flex items-center gap-2 px-1 text-sm text-ink-soft">
          <Spinner className="size-4 text-brand-500" />
          Pensando en tu dia…
        </div>
      ) : (
        message.text !== '' && (
          <div className="max-w-[92%] space-y-2 text-sm leading-relaxed whitespace-pre-wrap text-ink">
            {message.text}
            {isStreaming && <span className="ml-0.5 inline-block animate-breathe">▍</span>}
          </div>
        )
      )}

      {message.plan !== null && (
        <AdvisorPlanCard
          plan={message.plan}
          outcome={message.planOutcome}
          isApplying={isApplying}
          onApply={onApply}
          onDismiss={onDismiss}
        />
      )}
    </div>
  );
};

const BriefPanel = ({ count }: { count: number }) => (
  <p className="animate-rise-in rounded-card border border-line bg-sunken/60 px-4 py-2.5 text-xs text-ink-soft">
    El asistente esta viendo <strong className="text-ink">{count}</strong> tareas: las atrasadas,
    las de hoy y las de los proximos tres dias, con su prioridad, estimacion y cuantas veces se
    pospusieron. No ve tus adjuntos ni tu cuenta.
  </p>
);
