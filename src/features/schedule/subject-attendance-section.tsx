import { useState } from 'react';

import type { AttendanceStatus } from '../../domain/schedule/class-attendance';
import type { CalendarDate } from '../../domain/shared/clock';
import type { ScheduleBlock } from '../../domain/schedule/schedule-block';
import type { Subject } from '../../domain/schedule/subject';

import { attendanceKeyFor, ATTENDANCE_LABEL } from '../../domain/schedule/class-attendance';
import { Badge } from '../../shared/ui/feedback';
import { buildAttendanceTally, pendingSessions } from '../../domain/schedule/attendance-report';
import { cn } from '../../shared/lib/cn';
import { Field, Input } from '../../shared/ui/form-controls';
import { formatFullDate } from '../../shared/lib/date-format';
import { useAttendance } from '../../shared/hooks/use-live-query';
import { useScheduleActions } from './use-schedule-actions';
import { WEEKDAY_LABEL } from '../../domain/recurrence/recurrence-rule';

/**
 * Cuantas faltas llevas en esta materia.
 *
 * Lo que se enseña grande es FALTAS RESTANTES, no un porcentaje. Un 85% obliga a hacer
 * una division mental para responder a la unica pregunta que se hace de verdad, que es
 * "¿puedo faltar el jueves?".
 *
 * El limite lo pone el usuario porque cada universidad y cada profesor tienen el suyo. Sin
 * limite no se miente con un numero inventado: se enseña el recuento y ya.
 */

export interface SubjectAttendanceSectionProps {
  readonly subject: Subject;
  readonly blocks: readonly ScheduleBlock[];
  readonly today: CalendarDate;
}

export const SubjectAttendanceSection = ({
  subject,
  blocks,
  today,
}: SubjectAttendanceSectionProps) => {
  const records = useAttendance(subject.id);
  const actions = useScheduleActions();
  const [showPending, setShowPending] = useState(false);

  const tally = buildAttendanceTally(subject, blocks, records ?? [], today);
  const pending = pendingSessions(subject, blocks, records ?? [], today);

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Asistencia</h3>

      <div className="rounded-card border border-line bg-sunken px-4 py-3">
        {tally.remainingAbsences === null ? (
          <p className="text-sm text-ink">
            <span className="font-semibold tabular-nums">{tally.absent}</span>{' '}
            {tally.absent === 1 ? 'falta' : 'faltas'} de{' '}
            <span className="tabular-nums">{tally.held}</span>{' '}
            {tally.held === 1 ? 'clase' : 'clases'}
          </p>
        ) : (
          <p
            className={cn(
              'text-lg font-semibold',
              tally.overLimit
                ? 'text-danger'
                : tally.remainingAbsences <= 1
                  ? 'text-warning'
                  : 'text-ink',
            )}
          >
            {tally.overLimit
              ? 'Pasaste el limite de faltas'
              : tally.remainingAbsences === 0
                ? 'No te queda ninguna falta'
                : `Te ${tally.remainingAbsences === 1 ? 'queda' : 'quedan'} ${String(tally.remainingAbsences)} ${tally.remainingAbsences === 1 ? 'falta' : 'faltas'}`}
          </p>
        )}

        <p className="mt-1 text-xs text-ink-muted tabular-nums">
          {tally.attended} asistidas · {tally.absent} faltas
          {tally.excused > 0 && ` · ${String(tally.excused)} justificadas`}
          {tally.cancelled > 0 && ` · ${String(tally.cancelled)} sin clase`}
        </p>

        {/* Lo no marcado se dice como lo que es: casillas vacias, nunca faltas. */}
        {tally.unmarked > 0 && (
          <button
            type="button"
            onClick={() => {
              setShowPending((previous) => !previous);
            }}
            className="mt-2 text-xs font-medium text-brand-600 dark:text-brand-400"
          >
            {tally.unmarked} {tally.unmarked === 1 ? 'clase' : 'clases'} sin marcar
            {showPending ? ' · ocultar' : ' · rellenar'}
          </button>
        )}
      </div>

      {showPending && pending.length > 0 && (
        <ul className="space-y-1.5">
          {pending.map((session) => {
            const block = blocks.find((candidate) => candidate.id === session.blockId);
            if (block === undefined) return null;

            return (
              <li
                key={attendanceKeyFor(session.blockId, session.date)}
                className="rounded-card border border-line/70 bg-panel p-2.5"
              >
                <p className="mb-1.5 text-xs text-ink-soft">
                  {WEEKDAY_LABEL[block.weekday]} · {formatFullDate(`${session.date}T12:00:00.000Z`)}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(['attended', 'absent', 'excused', 'cancelled'] as AttendanceStatus[]).map(
                    (status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => {
                          void actions.markAttendance(session.blockId, session.date, status, null);
                        }}
                        className={cn(
                          'rounded-full border border-line px-2.5 py-1 text-xs font-medium',
                          'text-ink-muted transition-colors hover:bg-hover',
                          'focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none',
                        )}
                      >
                        {ATTENDANCE_LABEL[status]}
                      </button>
                    ),
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Field
        label="Faltas permitidas"
        htmlFor="materia-faltas"
        hint="Lo que admite esta materia antes de reprobar. Vacio = sin limite."
      >
        <Input
          id="materia-faltas"
          type="number"
          min={0}
          inputMode="numeric"
          defaultValue={subject.maxAbsences ?? ''}
          placeholder="Sin limite"
          onBlur={(event) => {
            const raw = event.target.value.trim();
            const next = raw === '' ? null : Number.parseInt(raw, 10);

            if (next !== null && Number.isNaN(next)) return;
            if (next === subject.maxAbsences) return;

            void actions.updateSubject({ subjectId: subject.id, maxAbsences: next });
          }}
        />
      </Field>

      {tally.overLimit && (
        <Badge variant="danger" size="sm">
          {tally.absent} faltas de {subject.maxAbsences} permitidas
        </Badge>
      )}
    </section>
  );
};
