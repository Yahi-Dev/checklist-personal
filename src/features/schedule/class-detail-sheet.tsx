import { Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { ScheduledClass } from '../../domain/schedule/weekly-schedule';
import type { ClassModality } from '../../domain/schedule/value-objects/class-modality';
import type { Weekday } from '../../domain/recurrence/recurrence-rule';

import { Button } from '../../shared/ui/button';
import { CATEGORY_COLORS } from '../../domain/category/category';
import { cn } from '../../shared/lib/cn';
import {
  CLASS_MODALITIES,
  CLASS_MODALITY_LABEL,
} from '../../domain/schedule/value-objects/class-modality';
import { Dialog, DialogContent } from '../../shared/ui/overlays';
import {
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../shared/ui/form-controls';
import { useScheduleActions } from './use-schedule-actions';
import { WEEKDAY_LABEL, WEEKDAYS } from '../../domain/recurrence/recurrence-rule';

/**
 * Editar una clase concreta.
 *
 * Lo que se toca aqui es el TRAMO -dia, hora, aula, modalidad- y el color de la
 * asignatura, que es lo unico suyo que se cambia a diario. El nombre, el codigo y la
 * seccion no se editan: vienen del documento oficial y cambiarlos a mano romperia la
 * clave natural con la que se reconcilia el siguiente import, de modo que la asignatura
 * editada se daria de baja y se crearia otra igual al lado.
 */

export interface ClassDetailSheetProps {
  readonly item: ScheduledClass | null;
  readonly onClose: () => void;
}

export const ClassDetailSheet = ({ item, onClose }: ClassDetailSheetProps) => {
  if (item === null) return null;

  /* El `key` es lo que rellena el formulario, y no un efecto que copie las props al
     estado. Con el efecto, React avisa -con razon- de renders en cascada, y ademas
     bastaba con que la clase se volviera a leer de IndexedDB para que lo que estabas
     escribiendo en el aula desapareciera. Al remontar por id, el estado nace ya con los
     valores correctos y nadie lo pisa despues. */
  return <ClassForm key={item.block.id} item={item} onClose={onClose} />;
};

const ClassForm = ({ item, onClose }: { item: ScheduledClass; onClose: () => void }) => {
  const actions = useScheduleActions();
  const { block, subject } = item;

  const [startsAt, setStartsAt] = useState(block.startsAt);
  const [endsAt, setEndsAt] = useState(block.endsAt);
  const [weekday, setWeekday] = useState<Weekday>(block.weekday);
  const [modality, setModality] = useState<ClassModality>(block.modality);
  const [locationLabel, setLocationLabel] = useState(block.locationLabel);

  const save = async () => {
    const updated = await actions.updateBlock({
      blockId: block.id,
      weekday,
      startsAt,
      endsAt,
      modality,
      locationLabel,
    });

    if (updated !== null) onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        title={subject.name}
        description={`${subject.code} · Seccion ${subject.section}`}
        footer={
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void actions.deleteBlock(block.id);
                onClose();
              }}
              leadingIcon={<Trash2 className="size-4" />}
            >
              Quitar clase
            </Button>
            <Button variant="primary" onClick={() => void save()}>
              Guardar
            </Button>
          </div>
        }
      >
        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <Field label="Dia">
            <Select
              value={String(weekday)}
              onValueChange={(value) => {
                setWeekday(Number.parseInt(value, 10) as Weekday);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEKDAYS.map((day) => (
                  <SelectItem key={day} value={String(day)}>
                    {WEEKDAY_LABEL[day]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Entra" htmlFor="clase-inicio">
              <Input
                id="clase-inicio"
                type="time"
                value={startsAt}
                onChange={(event) => {
                  setStartsAt(event.target.value);
                }}
              />
            </Field>
            <Field label="Sale" htmlFor="clase-fin">
              <Input
                id="clase-fin"
                type="time"
                value={endsAt}
                onChange={(event) => {
                  setEndsAt(event.target.value);
                }}
              />
            </Field>
          </div>

          <Field label="Aula" htmlFor="clase-aula" hint="Como viene en el horario, ej. FR1-305.">
            <Input
              id="clase-aula"
              value={locationLabel}
              placeholder="FR1-305"
              onChange={(event) => {
                setLocationLabel(event.target.value);
              }}
            />
          </Field>

          <Field label="Modalidad">
            <Select
              value={modality}
              onValueChange={(value) => {
                setModality(value as ClassModality);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLASS_MODALITIES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {CLASS_MODALITY_LABEL[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Color de la asignatura" hint="Se aplica a todas sus clases.">
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

          {subject.teacherName !== null && (
            <p className="text-xs text-ink-muted">
              Profesor: {subject.teacherName}
              {subject.teacherCode !== null && ` (${subject.teacherCode})`}
            </p>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="text-danger"
            onClick={() => {
              void actions.deleteSubject(subject.id);
              onClose();
            }}
          >
            Quitar la asignatura entera
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
