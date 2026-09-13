import { Ban, Check, X } from 'lucide-react';

import type { AttendanceStatus } from '../../domain/schedule/class-attendance';
import type { CalendarDate } from '../../domain/shared/clock';
import type { ScheduleBlockId } from '../../domain/shared/branded';

import { cn } from '../../shared/lib/cn';
import { useScheduleActions } from './use-schedule-actions';

/**
 * Marcar la clase de hoy con un toque.
 *
 * Esto es lo que decide si la funcion se usa o se queda vacia a las dos semanas. Un
 * control de asistencia que obliga a entrar en la materia, buscar el dia y elegir en un
 * desplegable se rellena tres veces y se abandona; uno que aparece solo en la clase que
 * acaba de empezar, a un toque, se rellena al salir del aula.
 *
 * Solo aparece cuando la clase YA EMPEZO. Antes no hay nada que marcar, y enseñarlo seria
 * invitar a marcar por adelantado una asistencia que aun no ocurrio.
 *
 * "Justificada" no esta aqui a proposito: se pone desde la materia. En el aula se decide
 * entre tres cosas -fui, no fui, no hubo clase-; lo de justificarla llega despues, con el
 * papel en la mano.
 */

const OPTIONS: readonly {
  readonly status: AttendanceStatus;
  readonly label: string;
  readonly icon: typeof Check;
  readonly tone: string;
}[] = [
  {
    status: 'attended',
    label: 'Asisti',
    icon: Check,
    tone: 'border-success bg-success/15 text-success',
  },
  { status: 'absent', label: 'Falte', icon: X, tone: 'border-danger bg-danger/15 text-danger' },
  {
    status: 'cancelled',
    label: 'No hubo',
    icon: Ban,
    tone: 'border-line-strong bg-sunken text-ink-soft',
  },
];

export interface AttendanceToggleProps {
  readonly blockId: ScheduleBlockId;
  readonly sessionDate: CalendarDate;
  readonly current: AttendanceStatus | null;
}

export const AttendanceToggle = ({ blockId, sessionDate, current }: AttendanceToggleProps) => {
  const actions = useScheduleActions();

  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Asistencia a esta clase">
      {OPTIONS.map((option) => {
        const isActive = current === option.status;

        return (
          <button
            key={option.status}
            type="button"
            aria-pressed={isActive}
            onClick={() => {
              void actions.markAttendance(blockId, sessionDate, option.status, current);
            }}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1',
              'text-xs font-medium transition-colors duration-200',
              'focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none',
              isActive ? option.tone : 'border-line text-ink-muted hover:bg-hover',
            )}
          >
            <option.icon className="size-3.5" aria-hidden="true" />
            {option.label}
          </button>
        );
      })}

      {/* Una justificada marcada desde la materia tiene que verse tambien aqui, o daria
          la sensacion de que la clase sigue sin marcar. */}
      {current === 'excused' && (
        <span className="inline-flex items-center rounded-full border border-warning bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning">
          Justificada
        </span>
      )}
    </div>
  );
};
