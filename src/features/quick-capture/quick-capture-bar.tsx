import { CalendarClock, CornerDownLeft, Flag, Hash, Plus, Repeat, Star, Tag } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type SyntheticEvent,
} from 'react';

import { Badge } from '../../shared/ui/feedback';
import { Button } from '../../shared/ui/button';
import { cn } from '../../shared/lib/cn';
import { formatDueDate } from '../../shared/lib/date-format';
import { PRIORITY_LABEL } from '../../domain/task/value-objects/priority';
import { previewQuickCapture } from '../../application/use-cases/task/quick-capture-task';
import { describeRecurrence } from '../../domain/recurrence/recurrence-rule';
import { useTaskActions } from '../task-actions/use-task-actions';

/**
 * La caja de captura rapida.
 *
 * Es la puerta principal de la app: escribes la frase entera y ella se encarga del
 * resto. Mientras escribes, debajo aparece lo que ha entendido, asi que la magia es
 * VERIFICABLE y no un acto de fe. Si interpreta mal la fecha, se ve al instante.
 *
 * Un solo campo, una sola pulsacion de Enter. Ese era el requisito de "sin friccion".
 */

export interface QuickCaptureBarProps {
  /** Fecha que se aplica si el texto no menciona ninguna. */
  defaultDueAt?: string | null;
  autoFocus?: boolean;
  onCreated?: () => void;
  className?: string;
  placeholder?: string;
}

export const QuickCaptureBar = ({
  defaultDueAt = null,
  autoFocus = false,
  onCreated,
  className,
  // Corto a proposito: en un iPhone (390px) caben ~34 caracteres antes del recorte,
  // y un ejemplo cortado por la mitad enseña peor que uno breve completo.
  placeholder = 'Añadir tarea... "pagar la luz mañana 6pm !alta"',
}: QuickCaptureBarProps) => {
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { create, quickCapture } = useTaskActions();

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  /**
   * Se analiza en cada tecla. Es barato -son unas cuantas expresiones regulares sobre
   * una frase corta- y a cambio la interpretacion se ve en vivo.
   */
  const preview = useMemo(
    () => (text.trim().length === 0 ? null : previewQuickCapture(text)),
    [text],
  );

  const submit = async (event?: SyntheticEvent) => {
    event?.preventDefault();

    const value = text.trim();
    if (value.length === 0 || isSubmitting) return;

    setIsSubmitting(true);

    try {
      // Sin nada que interpretar y con una fecha de contexto (por ejemplo, el dia que
      // tienes abierto en el calendario), se crea directo con esa fecha.
      const parsed = previewQuickCapture(value);
      const shouldUseContextDate =
        defaultDueAt !== null && parsed.dueAt === null && parsed.recurrence === null;

      if (shouldUseContextDate) {
        await create({ title: value, dueAt: defaultDueAt, isAllDay: true });
      } else {
        await quickCapture(value);
      }

      setText('');
      onCreated?.();
      // El foco se queda dentro: apuntar tres cosas seguidas no deberia obligar a
      // volver a pulsar el campo entre una y otra.
      inputRef.current?.focus();
    } finally {
      setIsSubmitting(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setText('');
      inputRef.current?.blur();
    }
  };

  return (
    <form onSubmit={submit} className={cn('space-y-2', className)}>
      <div
        className={cn(
          'group flex items-center gap-2 rounded-2xl border border-line bg-panel',
          'px-3 shadow-soft transition-[border-color,box-shadow,transform] duration-200',
          // Al enfocar, el campo se enciende con un halo del acento: la puerta
          // principal de la app tiene que sentirse como tal.
          'focus-within:-translate-y-px focus-within:border-brand-400 focus-within:shadow-glow',
        )}
      >
        <Plus className="size-5 shrink-0 text-ink-muted transition-colors duration-200 group-focus-within:text-brand-500" />

        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          // 16px en movil: por debajo, Safari en iOS hace zoom al enfocar.
          className="h-12 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-muted sm:text-sm"
          enterKeyHint="done"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Nueva tarea"
        />

        {text.trim().length > 0 && (
          <Button
            type="submit"
            size="icon-sm"
            variant="primary"
            loading={isSubmitting}
            aria-label="Crear tarea"
          >
            <CornerDownLeft className="size-4" />
          </Button>
        )}
      </div>

      {preview !== null && preview.tokens.length > 0 && (
        <div className="flex animate-fade-in flex-wrap items-center gap-1.5 px-1">
          <span className="text-xs text-ink-muted">Se entiende:</span>

          {preview.dueAt !== null && (
            <Badge variant="brand" size="sm">
              <CalendarClock className="size-3" />
              {formatDueDate(preview.dueAt, { isAllDay: preview.isAllDay })}
            </Badge>
          )}

          {preview.recurrence !== null && (
            <Badge variant="brand" size="sm">
              <Repeat className="size-3" />
              {describeRecurrence(preview.recurrence)}
            </Badge>
          )}

          {preview.priority !== null && (
            <Badge
              size="sm"
              variant={
                preview.priority === 'high'
                  ? 'danger'
                  : preview.priority === 'medium'
                    ? 'warning'
                    : 'neutral'
              }
            >
              <Flag className="size-3" />
              {PRIORITY_LABEL[preview.priority]}
            </Badge>
          )}

          {preview.isImportant && (
            <Badge variant="warning" size="sm">
              <Star className="size-3" />
              Destacada
            </Badge>
          )}

          {preview.categoryName !== null && (
            <Badge variant="outline" size="sm">
              <Hash className="size-3" />
              {preview.categoryName}
            </Badge>
          )}

          {preview.tagNames.map((tag) => (
            <Badge key={tag} variant="outline" size="sm">
              <Tag className="size-3" />
              {tag}
            </Badge>
          ))}

          {preview.title !== text.trim() && (
            <span className="ml-1 truncate text-xs text-ink-muted">
              Titulo: <span className="text-ink-soft">{preview.title}</span>
            </span>
          )}
        </div>
      )}
    </form>
  );
};
