import { Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { ClassModality } from '../../domain/schedule/value-objects/class-modality';
import type { ScheduleBlock } from '../../domain/schedule/schedule-block';
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
 * Editar UN tramo del horario: dia, hora, aula y modalidad.
 *
 * Antes esto era lo que se abria al tocar una clase, y era el gesto facil llevando a lo
 * raro: cambiar un aula pasa dos o tres veces por cuatrimestre, mientras que consultar la
 * materia pasa a diario. Ahora vive DENTRO de la hoja de la materia, detras del lapiz de
 * cada tramo.
 *
 * El nombre, el codigo y la seccion no se editan aqui ni en ningun sitio: vienen del
 * documento oficial y son la clave natural con la que se reconcilia el siguiente import.
 * Cambiarlos a mano daria de baja la asignatura editada y crearia otra igual al lado.
 */

export interface ClassEditDialogProps {
  readonly block: ScheduleBlock | null;
  readonly onClose: () => void;
}

export const ClassEditDialog = ({ block, onClose }: ClassEditDialogProps) => {
  if (block === null) return null;

  /* El `key` es lo que rellena el formulario, y no un efecto que copie las props al
     estado: asi el estado nace con los valores correctos y nadie lo pisa despues. */
  return <ClassForm key={block.id} block={block} onClose={onClose} />;
};

const ClassForm = ({ block, onClose }: { block: ScheduleBlock; onClose: () => void }) => {
  const actions = useScheduleActions();

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
        title="Editar clase"
        description={`${WEEKDAY_LABEL[block.weekday]} · ${block.startsAt}`}
        size="sm"
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
        </div>
      </DialogContent>
    </Dialog>
  );
};
