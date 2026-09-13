import { Plus } from 'lucide-react';
import { useState } from 'react';

import type { Subject } from '../../domain/schedule/subject';
import type { Task } from '../../domain/task/task';

import { Button } from '../../shared/ui/button';
import { Checkbox } from '../../shared/ui/form-controls';
import { cn } from '../../shared/lib/cn';
import { formatDueDate } from '../../shared/lib/date-format';
import { Input } from '../../shared/ui/form-controls';
import { useTaskActions } from '../task-actions/use-task-actions';
import { useTasksBySubject } from '../../shared/hooks/use-live-query';

/**
 * Las tareas de la materia.
 *
 * No son una entidad nueva: son TAREAS con `subjectId`, las mismas que salen en Hoy, en
 * Proximas y en el Calendario, con su vencimiento, su recordatorio y sus subtareas. Esta
 * seccion es una vista mas sobre ellas, no un segundo sitio donde viven.
 *
 * Por eso aqui solo se hacen las dos cosas que se hacen desde el horario -apuntar algo
 * que acaban de mandar y tachar lo que ya esta-. Todo lo demas se hace en la tarea, que
 * es donde estan las herramientas.
 */

export interface SubjectTasksSectionProps {
  readonly subject: Subject;
  readonly onOpenTask: (task: Task) => void;
}

export const SubjectTasksSection = ({ subject, onOpenTask }: SubjectTasksSectionProps) => {
  const tasks = useTasksBySubject(subject.id);
  const actions = useTaskActions();

  const [title, setTitle] = useState('');

  const add = async () => {
    const clean = title.trim();
    if (clean.length === 0) return;

    const created = await actions.create({ title: clean, subjectId: subject.id });
    if (created !== null) setTitle('');
  };

  const pending = (tasks ?? []).filter((task) => task.status === 'pending');
  const done = (tasks ?? []).filter((task) => task.status === 'completed');

  return (
    <section className="space-y-2">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Tareas</h3>
        {done.length > 0 && (
          <span className="text-[11px] text-ink-muted tabular-nums">
            {done.length} hecha{done.length === 1 ? '' : 's'}
          </span>
        )}
      </header>

      <div className="flex gap-2">
        <Input
          value={title}
          placeholder="Apunta algo que mandaron"
          aria-label={`Nueva tarea de ${subject.name}`}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void add();
          }}
        />
        <Button
          variant="secondary"
          size="icon"
          aria-label="Añadir tarea"
          disabled={title.trim().length === 0}
          onClick={() => void add()}
        >
          <Plus className="size-4" />
        </Button>
      </div>

      {pending.length === 0 && done.length === 0 ? (
        <p className="px-1 py-1 text-xs text-ink-muted">
          Lo que escribas aqui es una tarea normal: aparece en Hoy y te avisa igual.
        </p>
      ) : (
        <ul className="space-y-1">
          {[...pending, ...done].map((task) => (
            <TaskRow key={task.id} task={task} onOpen={onOpenTask} />
          ))}
        </ul>
      )}
    </section>
  );
};

const TaskRow = ({ task, onOpen }: { task: Task; onOpen: (task: Task) => void }) => {
  const actions = useTaskActions();
  const isDone = task.status === 'completed';

  return (
    <li className="flex items-center gap-2.5 rounded-xl px-1 py-1.5 hover:bg-hover">
      <Checkbox
        checked={isDone}
        aria-label={isDone ? `Reabrir ${task.title}` : `Completar ${task.title}`}
        onCheckedChange={() => {
          if (isDone) void actions.uncomplete(task.id);
          else void actions.complete(task);
        }}
      />

      <button
        type="button"
        onClick={() => {
          onOpen(task);
        }}
        className="min-w-0 flex-1 text-left"
      >
        <span
          className={cn('block truncate text-sm text-ink', isDone && 'text-ink-muted line-through')}
        >
          {task.title}
        </span>
        {task.dueAt !== null && !isDone && (
          <span className="block text-[11px] text-ink-muted">
            {formatDueDate(task.dueAt, { isAllDay: task.isAllDay })}
          </span>
        )}
      </button>
    </li>
  );
};
