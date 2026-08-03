import {
  AlarmClock,
  Calendar,
  Check,
  Clock3,
  Ellipsis,
  Paperclip,
  Pencil,
  Repeat,
  Star,
  Timer,
  Trash2,
} from 'lucide-react';
import { memo, useState } from 'react';

import type { Category } from '../../domain/category/category';
import type { SnoozePreset } from '../../application/use-cases/task/task-commands';
import type { Tag } from '../../domain/tag/tag';
import type { Task } from '../../domain/task/task';

import { Badge } from '../../shared/ui/feedback';
import { Button } from '../../shared/ui/button';
import { Checkbox } from '../../shared/ui/form-controls';
import { cn } from '../../shared/lib/cn';
import { formatDueDate } from '../../shared/lib/date-format';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../shared/ui/overlays';
import { Progress } from '../../shared/ui/feedback';
import { SNOOZE_PRESET_LABEL } from '../../application/use-cases/task/task-commands';
import { subtaskProgress } from '../../domain/task/subtask';
import { useTaskActions } from '../task-actions/use-task-actions';

/**
 * Una fila de la lista de tareas.
 *
 * Va envuelta en `memo` porque en la vista de Hoy se renderizan decenas y el estado
 * del padre cambia a menudo (filtros, reloj, sincronizacion). Sin memo, cada tic
 * repintaria la lista entera.
 *
 * El completado tiene retardo deliberado: al marcar la casilla, la fila se tacha y
 * desaparece 320 ms despues. Ese respiro confirma visualmente lo que acaba de pasar,
 * en lugar de que la tarea se esfume dejando la duda de si se marco la correcta.
 */

export interface TaskItemProps {
  task: Task;
  category?: Category | undefined;
  tags?: readonly Tag[];
  /**
   * Instante de referencia para decidir si esta vencida.
   *
   * Llega desde arriba en vez de llamar a `Date.now()` aqui: leer el reloj durante el
   * render vuelve impuro el componente, y con la app abierta durante horas el color
   * "vencida" se quedaria congelado en el momento del primer render.
   */
  now: number;
  onOpen?: (task: Task) => void;
  onStartFocus?: (task: Task) => void;
  /** Oculta la fecha: util en vistas ya agrupadas por dia. */
  hideDueDate?: boolean;
  className?: string;
}

const SNOOZE_PRESETS: readonly SnoozePreset[] = [
  '1h',
  '3h',
  'tonight',
  'tomorrow',
  'weekend',
  'next-week',
];

const PRIORITY_BAR: Record<Task['priority'], string> = {
  high: 'bg-[--color-priority-high]',
  medium: 'bg-[--color-priority-medium]',
  low: 'bg-transparent',
};

export const TaskItem = memo(
  ({
    task,
    category,
    tags = [],
    now,
    onOpen,
    onStartFocus,
    hideDueDate = false,
    className,
  }: TaskItemProps) => {
    const actions = useTaskActions();
    const [isCompleting, setIsCompleting] = useState(false);

    const isCompleted = task.status === 'completed';
    const isOverdue =
      task.status === 'pending' && task.dueAt !== null && Date.parse(task.dueAt) < now;

    const doneSubtasks = task.subtasks.filter((subtask) => subtask.isDone).length;

    const handleToggle = async () => {
      if (isCompleted) {
        await actions.uncomplete(task.id);
        return;
      }

      setIsCompleting(true);
      // La escritura se lanza tras la animacion; el estado local ya da el feedback.
      setTimeout(() => {
        void actions.complete(task);
        setIsCompleting(false);
      }, 320);
    };

    return (
      <div
        className={cn(
          'group relative flex items-start gap-3 overflow-hidden rounded-[--radius-card]',
          'border border-line bg-panel p-3.5 shadow-soft',
          'transition-[opacity,transform,box-shadow] duration-200',
          'hover:shadow-raised',
          isCompleting && 'scale-[0.99] opacity-0',
          isCompleted && 'opacity-60',
          className,
        )}
      >
        {/* Franja de prioridad: se lee de reojo, sin necesidad de decodificar un icono. */}
        <span
          className={cn('absolute inset-y-0 left-0 w-1', PRIORITY_BAR[task.priority])}
          aria-hidden="true"
        />

        <Checkbox
          checked={isCompleted || isCompleting}
          onCheckedChange={() => void handleToggle()}
          className="mt-0.5 shrink-0"
          aria-label={isCompleted ? `Reabrir ${task.title}` : `Completar ${task.title}`}
        />

        <button
          type="button"
          onClick={() => onOpen?.(task)}
          className="min-w-0 flex-1 space-y-1.5 text-left"
        >
          <div className="flex items-start gap-1.5">
            <span
              className={cn(
                'min-w-0 flex-1 text-[15px] leading-snug text-ink',
                (isCompleted || isCompleting) && 'strike-in text-ink-muted',
              )}
            >
              {task.title}
            </span>

            {task.isImportant && (
              <Star
                className="mt-0.5 size-4 shrink-0 fill-warning text-warning"
                aria-label="Destacada"
              />
            )}
          </div>

          {task.notes !== null && (
            <p className="line-clamp-1 text-xs text-ink-muted">{task.notes}</p>
          )}

          {task.subtasks.length > 0 && (
            <div className="flex items-center gap-2 pt-0.5">
              <Progress
                value={subtaskProgress(task.subtasks)}
                className="h-1 max-w-28"
                tone={doneSubtasks === task.subtasks.length ? 'success' : 'brand'}
              />
              <span className="text-[11px] text-ink-muted tabular-nums">
                {doneSubtasks}/{task.subtasks.length}
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {!hideDueDate && task.dueAt !== null && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 text-xs',
                  isOverdue ? 'font-medium text-danger' : 'text-ink-soft',
                )}
              >
                {isOverdue ? <AlarmClock className="size-3" /> : <Calendar className="size-3" />}
                {formatDueDate(task.dueAt, { isAllDay: task.isAllDay })}
              </span>
            )}

            {category !== undefined && (
              <span className="inline-flex items-center gap-1 text-xs text-ink-soft">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: category.color }}
                  aria-hidden="true"
                />
                {category.name}
              </span>
            )}

            {tags.map((tag) => (
              <Badge key={tag.id} variant="outline" size="sm">
                {tag.name}
              </Badge>
            ))}

            {(task.recurrence !== null || task.seriesId !== null) && (
              <Repeat className="size-3 text-ink-muted" aria-label="Se repite" />
            )}

            {task.attachments.length > 0 && (
              <span className="inline-flex items-center gap-0.5 text-xs text-ink-muted">
                <Paperclip className="size-3" />
                {task.attachments.length}
              </span>
            )}

            {task.snoozeCount >= 3 && (
              <Badge variant="warning" size="sm" title="La has pospuesto varias veces">
                <Clock3 className="size-3" />
                {task.snoozeCount}
              </Badge>
            )}
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-0.5">
          {/* En escritorio los atajos aparecen al pasar el raton; en tactil siempre,
              porque ahi no existe el hover. */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void actions.toggleImportant(task.id)}
            className={cn(
              'transition-opacity',
              task.isImportant ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 sm:opacity-0',
              'max-sm:opacity-100',
            )}
            aria-label={task.isImportant ? 'Quitar destacado' : 'Destacar'}
          >
            <Star className={cn('size-4', task.isImportant && 'fill-warning text-warning')} />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Opciones de ${task.title}`}>
                <Ellipsis className="size-4" />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onOpen?.(task)}>
                <Pencil />
                Editar
              </DropdownMenuItem>

              {onStartFocus !== undefined && task.status === 'pending' && (
                <DropdownMenuItem onSelect={() => onStartFocus(task)}>
                  <Timer />
                  Concentrarme en esto
                </DropdownMenuItem>
              )}

              {task.status === 'pending' && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Posponer</DropdownMenuLabel>
                  {SNOOZE_PRESETS.map((preset) => (
                    <DropdownMenuItem
                      key={preset}
                      onSelect={() => void actions.snooze(task, preset)}
                    >
                      <Clock3 />
                      {SNOOZE_PRESET_LABEL[preset]}
                    </DropdownMenuItem>
                  ))}
                </>
              )}

              <DropdownMenuSeparator />

              {isCompleted ? (
                <DropdownMenuItem onSelect={() => void actions.uncomplete(task.id)}>
                  <Check />
                  Marcar como pendiente
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => void actions.complete(task)}>
                  <Check />
                  Completar
                </DropdownMenuItem>
              )}

              <DropdownMenuItem destructive onSelect={() => void actions.remove(task)}>
                <Trash2 />
                Borrar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  },
  // Solo se repinta si cambio algo que se ve. `updatedAt` cubre cualquier edicion de
  // la tarea; el resto son datos externos que si hay que comparar aparte.
  (previous, next) =>
    previous.task.id === next.task.id &&
    previous.task.updatedAt === next.task.updatedAt &&
    previous.now === next.now &&
    previous.category?.id === next.category?.id &&
    previous.category?.color === next.category?.color &&
    previous.tags?.length === next.tags?.length &&
    previous.hideDueDate === next.hideDueDate,
);

TaskItem.displayName = 'TaskItem';

/** Icono compacto de una tarea, para el calendario. */
export const TaskDot = ({ task }: { task: Task }) => (
  <span
    className={cn(
      'block size-1.5 rounded-full',
      task.status === 'completed'
        ? 'bg-ink-muted'
        : task.priority === 'high'
          ? 'bg-[--color-priority-high]'
          : task.priority === 'medium'
            ? 'bg-[--color-priority-medium]'
            : 'bg-brand-400',
    )}
    aria-hidden="true"
  />
);
