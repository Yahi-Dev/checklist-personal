import { useState } from 'react';

import type { ClassModality } from '../../domain/schedule/value-objects/class-modality';
import type { SubjectId } from '../../domain/shared/branded';
import type { Subject } from '../../domain/schedule/subject';
import type { Weekday } from '../../domain/recurrence/recurrence-rule';

import { Button } from '../../shared/ui/button';
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
 * Añadir una clase que el PDF no trae.
 *
 * Pasa mas de lo que parece: una tutoria semanal, un laboratorio que se acuerda en
 * clase, una asignatura que aparece en el horario sin tramo impreso. Se apoya siempre en
 * una asignatura EXISTENTE del cuatrimestre; para dar de alta una asignatura entera esta
 * el import, que es la via que mantiene la clave natural coherente.
 *
 * Aviso que la propia interfaz da: un tramo añadido a mano desaparece al volver a
 * importar ese cuatrimestre, porque el documento manda. Decirlo aqui evita que parezca
 * un fallo cuando ocurra.
 */

export interface AddClassDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly termCode: string;
  readonly subjects: readonly Subject[];
}

export const AddClassDialog = ({ open, onOpenChange, termCode, subjects }: AddClassDialogProps) => {
  const actions = useScheduleActions();

  const [subjectId, setSubjectId] = useState<string>('');
  const [weekday, setWeekday] = useState<Weekday>(1);
  const [startsAt, setStartsAt] = useState('18:00');
  const [endsAt, setEndsAt] = useState('20:00');
  const [modality, setModality] = useState<ClassModality>('presencial');
  const [locationLabel, setLocationLabel] = useState('');

  const save = async () => {
    if (subjectId === '') return;

    const created = await actions.createBlock({
      subjectId: subjectId as SubjectId,
      weekday,
      startsAt,
      endsAt,
      modality,
      locationLabel,
    });

    if (created !== null) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Añadir clase"
        description={`Al horario de ${termCode}.`}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancelar
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={subjectId === ''}>
              Añadir
            </Button>
          </div>
        }
      >
        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <Field label="Asignatura" required>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Elige una" />
              </SelectTrigger>
              <SelectContent>
                {subjects.map((subject) => (
                  <SelectItem key={subject.id} value={subject.id}>
                    <span className="font-mono text-xs">{subject.code}</span> {subject.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

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
            <Field label="Entra" htmlFor="nueva-clase-inicio">
              <Input
                id="nueva-clase-inicio"
                type="time"
                value={startsAt}
                onChange={(event) => {
                  setStartsAt(event.target.value);
                }}
              />
            </Field>
            <Field label="Sale" htmlFor="nueva-clase-fin">
              <Input
                id="nueva-clase-fin"
                type="time"
                value={endsAt}
                onChange={(event) => {
                  setEndsAt(event.target.value);
                }}
              />
            </Field>
          </div>

          <Field label="Aula" htmlFor="nueva-clase-aula">
            <Input
              id="nueva-clase-aula"
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

          <p className="text-xs text-ink-muted">
            Al volver a importar el PDF de este cuatrimestre, las clases añadidas a mano se quitan:
            manda el documento de la universidad.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};
