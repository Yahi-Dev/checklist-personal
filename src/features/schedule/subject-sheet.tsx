import { Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { AttentionLevel } from '../../domain/schedule/value-objects/attention-level';
import type { ScheduleBlock } from '../../domain/schedule/schedule-block';
import type { Subject } from '../../domain/schedule/subject';
import type { Task } from '../../domain/task/task';

import {
  ATTENTION_HINT,
  ATTENTION_LABEL,
  ATTENTION_LEVELS,
} from '../../domain/schedule/value-objects/attention-level';
import { Button } from '../../shared/ui/button';
import { CATEGORY_COLORS } from '../../domain/category/category';
import { ClassEditDialog } from './class-edit-dialog';
import { cn } from '../../shared/lib/cn';
import { CLASS_MODALITY_LABEL } from '../../domain/schedule/value-objects/class-modality';
import { describeLocation, formatClassTime } from './schedule-format';
import { Dialog, DialogContent } from '../../shared/ui/overlays';
import { Field } from '../../shared/ui/form-controls';
import type { CalendarDate } from '../../domain/shared/clock';

import { SubjectAttendanceSection } from './subject-attendance-section';
import { SubjectNotesSection } from './subject-notes-section';
import { SubjectTasksSection } from './subject-tasks-section';
import { useScheduleActions } from './use-schedule-actions';
import { WEEKDAY_LABEL } from '../../domain/recurrence/recurrence-rule';

/**
 * La casa de una materia.
 *
 * Es lo que se abre al tocar una clase, y ese cambio es el que de verdad reordena la
 * pantalla. Antes, tocar abria el formulario de editar el tramo: el gesto facil llevaba a
 * lo que se hace tres veces por cuatrimestre, mientras que lo que se hace a diario -mirar
 * que tienes pendiente de esa materia, apuntar lo que acaban de mandar- no tenia puerta.
 *
 * Y no estrena ningun gesto. El chevron de la tarjeta ya prometia "esto lleva a algun
 * sitio"; lo unico que cambia es que ahora dice la verdad.
 */

export interface SubjectSheetProps {
  readonly subject: Subject | null;
  readonly blocks: readonly ScheduleBlock[];
  readonly onClose: () => void;
  readonly onOpenTask: (task: Task) => void;
  readonly today: CalendarDate;
}

export const SubjectSheet = ({
  subject,
  blocks,
  onClose,
  onOpenTask,
  today,
}: SubjectSheetProps) => {
  const actions = useScheduleActions();
  const [editing, setEditing] = useState<ScheduleBlock | null>(null);

  if (subject === null) return null;

  const own = blocks
    .filter((block) => block.subjectId === subject.id && block.deletedAt === null)
    .sort((a, b) => a.weekday - b.weekday || a.startsAt.localeCompare(b.startsAt));

  return (
    <>
      <Dialog
        open
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      >
        <DialogContent
          title={subject.name}
          description={[
            subject.code,
            subject.section === '' ? null : `Seccion ${subject.section}`,
            subject.credits === null ? null : `${String(subject.credits)} creditos`,
          ]
            .filter((part): part is string => part !== null)
            .join(' · ')}
        >
          <div className="space-y-5 overflow-y-auto px-5 py-4">
            {subject.teacherName !== null && (
              <p className="text-sm text-ink-soft">{subject.teacherName}</p>
            )}

            <AttentionPicker
              value={subject.attention}
              onChange={(attention) => {
                void actions.updateSubject({ subjectId: subject.id, attention });
              }}
            />

            {/* ---------------- Clases ---------------- */}
            <section className="space-y-2">
              <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
                Clases
              </h3>

              {own.length === 0 ? (
                <p className="px-1 text-xs text-ink-muted">
                  Esta asignatura no trae horario en el documento.
                </p>
              ) : (
                <ul className="space-y-1">
                  {own.map((block) => {
                    const location = describeLocation(block);

                    return (
                      <li
                        key={block.id}
                        className="flex items-center gap-2 rounded-xl px-1 py-1.5 hover:bg-hover"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-ink">
                            {WEEKDAY_LABEL[block.weekday]} · {formatClassTime(block.startsAt)} a{' '}
                            {formatClassTime(block.endsAt)}
                          </p>
                          <p className="truncate font-mono text-xs text-ink-muted">
                            {location.isRemote
                              ? 'Virtual'
                              : (location.fallback ??
                                [location.building, location.room]
                                  .filter((part): part is string => part !== null)
                                  .join(' · '))}
                            {' · '}
                            {CLASS_MODALITY_LABEL[block.modality]}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Editar la clase de ${WEEKDAY_LABEL[block.weekday]}`}
                          onClick={() => {
                            setEditing(block);
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <SubjectAttendanceSection subject={subject} blocks={blocks} today={today} />

            <SubjectTasksSection subject={subject} onOpenTask={onOpenTask} />

            <SubjectNotesSection subject={subject} />

            {/* ---------------- Color ---------------- */}
            <Field label="Color" hint="Solo identifica la materia; no cambia con la atencion.">
              <div className="flex flex-wrap gap-2">
                {CATEGORY_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Color ${color}`}
                    aria-pressed={subject.color === color}
                    onClick={() => {
                      void actions.updateSubject({ subjectId: subject.id, color });
                    }}
                    className={cn(
                      'size-7 rounded-full transition-transform duration-200',
                      'focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none',
                      subject.color === color
                        ? 'ring-2 ring-brand-500 ring-offset-2 ring-offset-panel'
                        : 'hover:scale-110',
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </Field>

            <Button
              variant="ghost"
              size="sm"
              className="text-danger"
              leadingIcon={<Trash2 className="size-4" />}
              onClick={() => {
                void actions.deleteSubject(subject.id);
                onClose();
              }}
            >
              Quitar la asignatura del horario
            </Button>

            {/* Se dice explicitamente porque es lo contrario de lo que la gente teme. */}
            <p className="text-[11px] text-ink-muted">
              Sus tareas se quedan: son tuyas, no de la materia.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <ClassEditDialog
        block={editing}
        onClose={() => {
          setEditing(null);
        }}
      />
    </>
  );
};

const ATTENTION_TONE: Readonly<Record<AttentionLevel, string>> = {
  critical: 'border-danger bg-danger/10 text-danger',
  watch: 'border-warning bg-warning/10 text-warning',
  normal: 'border-line-strong bg-sunken text-ink',
  relaxed: 'border-line bg-sunken text-ink-muted',
};

const AttentionPicker = ({
  value,
  onChange,
}: {
  value: AttentionLevel;
  onChange: (level: AttentionLevel) => void;
}) => (
  <Field label="Atencion" hint={ATTENTION_HINT[value]}>
    <div className="grid grid-cols-4 gap-1.5">
      {ATTENTION_LEVELS.map((level) => (
        <button
          key={level}
          type="button"
          aria-pressed={value === level}
          onClick={() => {
            onChange(level);
          }}
          className={cn(
            'rounded-xl border px-2 py-1.5 text-xs font-medium transition-colors',
            'focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none',
            value === level ? ATTENTION_TONE[level] : 'border-line text-ink-muted hover:bg-hover',
          )}
        >
          {ATTENTION_LABEL[level]}
        </button>
      ))}
    </div>
  </Field>
);
