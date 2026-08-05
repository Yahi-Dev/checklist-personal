import { CheckCircle2 } from 'lucide-react';

import type { CompletionDay } from '../../domain/task/completion-log';
import type { Task } from '../../domain/task/task';

import { EmptyState } from '../../shared/ui/feedback';
import { TaskItem } from '../task-list/task-item';
import { useCategoryIndex, useTagIndex } from '../../shared/hooks/use-live-query';
import { useNow } from '../../shared/hooks/use-now';

/**
 * El historial de lo terminado, un bloque por dia.
 *
 * NO se reutiliza `TaskList` aunque pinte las mismas filas, y la diferencia no es de
 * estilo: alli lo completado va al final y PLEGADO, porque compite por atencion con lo
 * que falta. Aqui lo completado ES el contenido. Envolverlo en un acordeon cerrado
 * significaria abrir la pantalla del historial y no ver ningun historial.
 *
 * Los encabezados de dia NO se quedan pegados arriba, aunque la idea es tentadora. La
 * cabecera de la pantalla ya es pegajosa, mide distinto segun el ancho -los periodos se
 * reparten en una o dos filas- y tiene mas peso de apilado: un encabezado de dia pegado a
 * `top-0` se meteria debajo y solo asomaria como una banda borrosa. Compensarlo pediria
 * medir la cabecera en tiempo de ejecucion y repartir el numero por CSS, que es bastante
 * maquinaria para un adorno. Separados y con el conteo a la derecha se distinguen igual.
 */

export interface CompletionLogListProps {
  days: readonly CompletionDay[];
  onOpenTask?: (task: Task) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
}

export const CompletionLogList = ({
  days,
  onOpenTask,
  emptyTitle = 'Nada terminado todavia',
  emptyDescription = 'Lo que vayas completando aparecera aqui, agrupado por dia.',
  emptyAction,
}: CompletionLogListProps) => {
  const categories = useCategoryIndex();
  const tagIndex = useTagIndex();
  const now = useNow();

  if (days.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle2 />}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  /* Entrada escalonada continua a traves de los dias, no reiniciada en cada bloque: la
     cascada se lee como una sola lista y no como varias arrancando a la vez. */
  let entranceOrder = 0;

  return (
    <div className="space-y-5">
      {days.map((day) => (
        <section key={day.key} aria-label={formatDayLabel(day.date, now)}>
          <header className="mb-2 flex items-baseline justify-between gap-3 px-1">
            <h2 className="text-sm font-semibold text-ink first-letter:uppercase">
              {formatDayLabel(day.date, now)}
            </h2>
            <span className="shrink-0 text-xs text-ink-muted">
              {day.tasks.length} {day.tasks.length === 1 ? 'tarea' : 'tareas'}
            </span>
          </header>

          <div className="space-y-2">
            {day.tasks.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                category={task.categoryId === null ? undefined : categories.get(task.categoryId)}
                tags={task.tagIds
                  .map((id) => tagIndex.get(id as string))
                  .filter((tag) => tag !== undefined)}
                now={now}
                entranceDelayMs={Math.min(entranceOrder++ * 35, 320)}
                onOpen={onOpenTask}
                // La fecha de vencimiento sobra en una vista ya ordenada por el dia en que
                // se hizo: enseñar las dos invita a leer una por la otra.
                hideDueDate
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

const dayFormatter = new Intl.DateTimeFormat('es-DO', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const dayWithYearFormatter = new Intl.DateTimeFormat('es-DO', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/**
 * "Hoy" y "Ayer" por su nombre; el resto por su fecha.
 *
 * El año solo aparece cuando NO es el actual. Repetirlo en todos los encabezados es ruido
 * once meses al año, y omitirlo siempre convierte el historial viejo en un acertijo.
 */
const formatDayLabel = (date: Date, now: number): string => {
  const today = new Date(now);
  const diff = calendarDaysApart(date, today);

  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';

  return date.getFullYear() === today.getFullYear()
    ? dayFormatter.format(date)
    : dayWithYearFormatter.format(date);
};

const calendarDaysApart = (from: Date, to: Date): number => {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
};
