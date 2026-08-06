import {
  Archive,
  ArchiveRestore,
  ExternalLink,
  Flag,
  ChevronDown,
  ChevronUp,
  Link2,
  Paperclip,
  Plus,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import type { CategoryId } from '../../domain/shared/branded';
import type { Priority } from '../../domain/task/value-objects/priority';
import type { RecurrenceRule } from '../../domain/recurrence/recurrence-rule';
import type { Task } from '../../domain/task/task';
import type { UpdateTaskCommand } from '../../application/use-cases/task/task-commands';

import { Badge } from '../../shared/ui/feedback';
import { Button } from '../../shared/ui/button';
import { Checkbox } from '../../shared/ui/form-controls';
import { cn } from '../../shared/lib/cn';
import { ConfirmDialog, Dialog, DialogContent } from '../../shared/ui/overlays';
import {
  Field,
  Input,
  SegmentedGroup,
  SegmentedItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from '../../shared/ui/form-controls';
import { formatBytes } from '../../domain/task/attachment';
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '../../shared/lib/date-format';
import { PRIORITIES, PRIORITY_LABEL } from '../../domain/task/value-objects/priority';
import { RecurrenceEditor } from './recurrence-editor';
import { subtaskProgress } from '../../domain/task/subtask';
import { Progress } from '../../shared/ui/feedback';
import { useCategories, useTags } from '../../shared/hooks/use-live-query';
import { usePreferences } from '../../shared/stores/preferences-store';
import { celebrate, celebrationKindFor, centerOf } from '../celebration/celebration';
import { useTaskActions } from '../task-actions/use-task-actions';

/**
 * Editor completo de una tarea.
 *
 * GUARDA AL VUELO, sin boton de "Guardar".
 *
 * Es la decision de diseño con mas peso de esta pantalla. Un formulario con boton
 * obliga a recordar pulsarlo, y en el movil -donde se sale con el gesto de atras- es
 * la via directa a perder lo escrito. Guardando en cada cambio confirmado (al salir
 * del campo o al pulsar un control) no hay nada que recordar.
 *
 * Los campos de texto guardan en `onBlur` y no en cada tecla: escribir un titulo de
 * treinta letras generaria treinta escrituras y treinta entradas en la cola.
 */

export interface TaskDetailSheetProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Envoltorio del dialogo.
 *
 * El contenido va en un componente aparte con `key={task.id}`, y esa `key` es la que
 * reinicia los borradores al cambiar de tarea. Es la alternativa al patron habitual
 * -un `useEffect` que copia las props al estado- que provoca un render extra en cada
 * apertura y deja una ventana en la que se ve el titulo de la tarea ANTERIOR.
 */
export const TaskDetailSheet = ({ task, open, onOpenChange }: TaskDetailSheetProps) => {
  if (task === null) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <TaskDetailContent key={task.id} task={task} onOpenChange={onOpenChange} />
    </Dialog>
  );
};

interface TaskDetailContentProps {
  task: Task;
  onOpenChange: (open: boolean) => void;
}

const TaskDetailContent = ({ task, onOpenChange }: TaskDetailContentProps) => {
  const actions = useTaskActions();
  const completeCheckboxRef = useRef<HTMLButtonElement>(null);
  const categories = useCategories() ?? [];
  const tags = useTags() ?? [];
  const defaultReminderLead = usePreferences((state) => state.defaultReminderLeadMinutes);

  /* Borradores locales: el texto no se guarda en cada tecla, sino al salir del campo.
     Escribir un titulo de treinta letras generaria treinta escrituras y treinta
     entradas en la cola de sincronizacion. */
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? '');
  const [newSubtask, setNewSubtask] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const progress = useMemo(() => subtaskProgress(task.subtasks), [task.subtasks]);

  const orderedSubtasks = useMemo(
    () => [...task.subtasks].sort((a, b) => a.position - b.position),
    [task.subtasks],
  );

  /**
   * Mueve una subtarea un puesto arriba (`direction` -1) o abajo (+1).
   *
   * El reordenado es por indexacion fraccionaria: no se guarda una lista de indices sino
   * una posicion ENTRE las dos vecinas del destino. Por eso hay que mirar dos puestos
   * mas alla en el sentido del movimiento, no uno: al subir, el destino queda entre la
   * de dos por encima y la que hasta ahora estaba justo encima.
   */
  const moveSubtask = async (index: number, direction: -1 | 1): Promise<void> => {
    const target = index + direction;
    if (target < 0 || target >= orderedSubtasks.length) return;

    const subtask = orderedSubtasks[index];
    if (subtask === undefined) return;

    const previous =
      direction === -1
        ? (orderedSubtasks[index - 2]?.id ?? null)
        : (orderedSubtasks[index + 1]?.id ?? null);
    const next =
      direction === -1
        ? (orderedSubtasks[index - 1]?.id ?? null)
        : (orderedSubtasks[index + 2]?.id ?? null);

    await actions.reorderSubtask(task.id, subtask.id, previous, next);
  };

  const patch = (changes: Omit<UpdateTaskCommand, 'taskId'>) =>
    void actions.update({ taskId: task.id, ...changes });

  const commitTitle = () => {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setTitle(task.title);
      return;
    }
    if (trimmed !== task.title) patch({ title: trimmed });
  };

  const commitNotes = () => {
    const value = notes.trim();
    if (value !== (task.notes ?? '')) patch({ notes: value.length === 0 ? null : value });
  };

  const setDueAt = (value: string) => {
    const iso = fromDateTimeLocalValue(value);

    if (iso === null) {
      patch({ dueAt: null, reminderAt: null, recurrence: null });
      return;
    }

    // Poner una hora activa el recordatorio por defecto, en lugar de dejar al usuario
    // configurarlo aparte. Es lo que casi siempre se quiere al fijar una hora.
    const reminderAt =
      task.reminderAt === null && !task.isAllDay
        ? new Date(Date.parse(iso) - defaultReminderLead * 60_000).toISOString()
        : task.reminderAt;

    patch({ dueAt: iso, reminderAt });
  };

  const addSubtask = () => {
    const value = newSubtask.trim();
    if (value.length === 0) return;
    void actions.addSubtask(task.id, value);
    setNewSubtask('');
  };

  const addLink = () => {
    const value = linkUrl.trim();
    if (value.length === 0) return;
    void actions.addLink(task.id, value);
    setLinkUrl('');
    setShowLinkInput(false);
  };

  return (
    <>
      <DialogContent
        title="Detalle de la tarea"
        hideTitle
        size="lg"
        footer={
          <>
            {/* Archivar tiene que poder deshacerse desde el mismo sitio. Antes solo
                existia el camino de ida: la tarea salia de todas las listas y no habia
                forma de traerla de vuelta. */}
            {task.status === 'archived' ? (
              <Button
                variant="ghost"
                onClick={() => {
                  void actions.restore(task.id);
                  onOpenChange(false);
                }}
              >
                <ArchiveRestore className="size-4" />
                Desarchivar
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={() => {
                  void actions.archive(task.id);
                  onOpenChange(false);
                }}
              >
                <Archive className="size-4" />
                Archivar
              </Button>
            )}
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" />
              Borrar
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          {/* ---------------- Titulo y destacado ---------------- */}
          <div className="flex items-start gap-2">
            <Checkbox
              ref={completeCheckboxRef}
              checked={task.status === 'completed'}
              onCheckedChange={() => {
                if (task.status === 'completed') {
                  void actions.uncomplete(task.id);
                  return;
                }
                // La misma fiesta que en la lista: el premio no depende de desde
                // donde se complete.
                celebrate({
                  kind: celebrationKindFor(task, Date.now()),
                  ...centerOf(completeCheckboxRef.current),
                });
                void actions.complete(task);
              }}
              className="mt-2"
              aria-label="Completar tarea"
            />

            <Textarea
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={commitTitle}
              rows={1}
              className="min-h-10 resize-none border-none bg-transparent px-0 text-lg font-medium focus:ring-0"
              placeholder="Titulo de la tarea"
              aria-label="Titulo"
            />

            <Button
              variant="ghost"
              size="icon-sm"
              className="mt-1"
              onClick={() => void actions.toggleImportant(task.id)}
              aria-label={task.isImportant ? 'Quitar destacado' : 'Destacar'}
            >
              <Star className={cn('size-5', task.isImportant && 'fill-warning text-warning')} />
            </Button>
          </div>

          {/* ---------------- Fecha, hora y recordatorio ---------------- */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Vence" htmlFor="due-at">
              <Input
                id="due-at"
                type="datetime-local"
                value={toDateTimeLocalValue(task.dueAt)}
                onChange={(event) => setDueAt(event.target.value)}
              />
            </Field>

            <Field
              label="Recordatorio"
              htmlFor="reminder-at"
              hint={task.dueAt === null ? 'Necesita fecha de vencimiento.' : undefined}
            >
              <Input
                id="reminder-at"
                type="datetime-local"
                value={toDateTimeLocalValue(task.reminderAt)}
                disabled={task.dueAt === null}
                onChange={(event) =>
                  patch({ reminderAt: fromDateTimeLocalValue(event.target.value) })
                }
              />
            </Field>
          </div>

          {task.dueAt !== null && (
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-ink-soft">Todo el dia (sin hora)</span>
              <Switch
                checked={task.isAllDay}
                onCheckedChange={(isAllDay) => patch({ isAllDay })}
                aria-label="Todo el dia"
              />
            </label>
          )}

          {/* ---------------- Prioridad ---------------- */}
          <Field label="Prioridad">
            <SegmentedGroup
              type="single"
              value={task.priority}
              onValueChange={(priority) => {
                if (priority !== '') patch({ priority: priority as Priority });
              }}
              className="w-full"
            >
              {PRIORITIES.map((priority) => (
                <SegmentedItem key={priority} value={priority} className="flex-1">
                  <Flag
                    className={cn(
                      'size-3.5',
                      priority === 'high' && 'text-priority-high',
                      priority === 'medium' && 'text-priority-medium',
                      priority === 'low' && 'text-priority-low',
                    )}
                  />
                  {PRIORITY_LABEL[priority]}
                </SegmentedItem>
              ))}
            </SegmentedGroup>
          </Field>

          {/* ---------------- Categoria ---------------- */}
          <Field label="Categoria">
            <Select
              value={task.categoryId ?? '__none__'}
              onValueChange={(value) =>
                patch({ categoryId: value === '__none__' ? null : (value as CategoryId) })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Sin categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sin categoria</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    <span className="flex items-center gap-2">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: category.color }}
                      />
                      {category.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* ---------------- Etiquetas ---------------- */}
          {tags.length > 0 && (
            <Field label="Etiquetas">
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => {
                  const active = task.tagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        patch({
                          tagIds: active
                            ? task.tagIds.filter((id) => id !== tag.id)
                            : [...task.tagIds, tag.id],
                        })
                      }
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                        'focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none',
                        active
                          ? 'border-transparent bg-brand-600 text-white'
                          : 'border-line text-ink-soft hover:bg-hover',
                      )}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}

          {/* ---------------- Repeticion ---------------- */}
          <RecurrenceEditor
            value={task.recurrence}
            onChange={(recurrence: RecurrenceRule | null) => patch({ recurrence })}
            hasDueDate={task.dueAt !== null}
          />

          {/* ---------------- Subtareas ---------------- */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink-soft">Subtareas</span>
              {task.subtasks.length > 0 && (
                <span className="text-xs text-ink-muted tabular-nums">
                  {task.subtasks.filter((subtask) => subtask.isDone).length}/{task.subtasks.length}
                </span>
              )}
            </div>

            {task.subtasks.length > 0 && (
              <Progress value={progress} tone={progress === 1 ? 'success' : 'brand'} />
            )}

            <ul className="space-y-1">
              {orderedSubtasks.map((subtask, index) => (
                <li
                  key={subtask.id}
                  className="group flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-hover"
                >
                  {/* Subir y bajar en vez de arrastrar.
                        Aqui habia un asa de arrastre que no hacia NADA: prometia un gesto
                        que nadie habia conectado. Se sustituye por dos botones y no por
                        arrastre de verdad porque esta app se usa sobre todo en el movil,
                        donde el arrastre nativo de HTML no existe; ademas estos funcionan
                        con teclado y con lector de pantalla, que el asa tampoco haria. */}
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => void moveSubtask(index, -1)}
                      aria-label={`Subir ${subtask.title}`}
                      className={cn(
                        'flex h-3.5 w-4 items-center justify-center rounded text-ink-muted',
                        'transition-colors hover:text-ink disabled:opacity-25 disabled:hover:text-ink-muted',
                      )}
                    >
                      <ChevronUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={index === orderedSubtasks.length - 1}
                      onClick={() => void moveSubtask(index, 1)}
                      aria-label={`Bajar ${subtask.title}`}
                      className={cn(
                        'flex h-3.5 w-4 items-center justify-center rounded text-ink-muted',
                        'transition-colors hover:text-ink disabled:opacity-25 disabled:hover:text-ink-muted',
                      )}
                    >
                      <ChevronDown className="size-3.5" />
                    </button>
                  </div>
                  <Checkbox
                    checked={subtask.isDone}
                    onCheckedChange={() => void actions.toggleSubtask(task.id, subtask.id)}
                    className="size-4"
                    aria-label={subtask.title}
                  />
                  <input
                    defaultValue={subtask.title}
                    onBlur={(event) => {
                      const value = event.target.value.trim();
                      if (value.length > 0 && value !== subtask.title) {
                        void actions.renameSubtask(task.id, subtask.id, value);
                      } else if (value.length === 0) {
                        event.target.value = subtask.title;
                      }
                    }}
                    className={cn(
                      'flex-1 bg-transparent text-sm text-ink outline-none',
                      subtask.isDone && 'text-ink-muted line-through',
                    )}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="opacity-0 group-hover:opacity-100"
                    onClick={() => void actions.removeSubtask(task.id, subtask.id)}
                    aria-label={`Borrar ${subtask.title}`}
                  >
                    <X className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>

            <div className="flex items-center gap-2">
              <Plus className="size-4 shrink-0 text-ink-muted" />
              <input
                value={newSubtask}
                onChange={(event) => setNewSubtask(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addSubtask();
                  }
                }}
                onBlur={addSubtask}
                placeholder="Añadir subtarea"
                className="flex-1 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-ink-muted"
                aria-label="Nueva subtarea"
              />
            </div>
          </div>

          {/* ---------------- Notas ---------------- */}
          <Field label="Notas" htmlFor="notes">
            <Textarea
              id="notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              onBlur={commitNotes}
              placeholder="Detalles, enlaces, lo que sea..."
              rows={4}
            />
          </Field>

          {/* ---------------- Adjuntos ---------------- */}
          <div className="space-y-2">
            <span className="text-sm font-medium text-ink-soft">Adjuntos</span>

            {task.attachments.length > 0 && (
              <ul className="space-y-1.5">
                {task.attachments.map((attachment) => (
                  <li
                    key={attachment.id}
                    className="flex items-center gap-2 rounded-lg border border-line bg-sunken px-2.5 py-2"
                  >
                    {attachment.kind === 'link' ? (
                      <Link2 className="size-4 shrink-0 text-ink-muted" />
                    ) : (
                      <Paperclip className="size-4 shrink-0 text-ink-muted" />
                    )}

                    <a
                      href={attachment.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 flex-1 truncate text-sm text-brand-600 hover:underline dark:text-brand-400"
                    >
                      {attachment.name}
                    </a>

                    {attachment.sizeBytes !== null && (
                      <Badge size="sm" variant="neutral">
                        {formatBytes(attachment.sizeBytes)}
                      </Badge>
                    )}

                    <ExternalLink className="size-3.5 shrink-0 text-ink-muted" />

                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => void actions.removeAttachment(task.id, attachment.id)}
                      aria-label={`Quitar ${attachment.name}`}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {showLinkInput ? (
              <div className="flex gap-2">
                <Input
                  value={linkUrl}
                  onChange={(event) => setLinkUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addLink();
                    }
                    if (event.key === 'Escape') setShowLinkInput(false);
                  }}
                  placeholder="https://..."
                  type="url"
                  autoFocus
                />
                <Button onClick={addLink} variant="primary">
                  Añadir
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setShowLinkInput(true)}>
                  <Link2 className="size-4" />
                  Enlace
                </Button>
                <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="size-4" />
                  Archivo
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="image/*,application/pdf,.txt,.csv,.md,.zip,.doc,.docx,.xlsx"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file !== undefined) void actions.addFile(task.id, file);
                    event.target.value = '';
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </DialogContent>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="¿Borrar esta tarea?"
        description="Va a la papelera. Puedes deshacerlo desde el aviso que aparece justo despues."
        confirmLabel="Borrar"
        destructive
        onConfirm={() => {
          void actions.remove(task);
          setConfirmDelete(false);
          onOpenChange(false);
        }}
      />
    </>
  );
};
