import { useState } from 'react';

import type { RecurrenceRule, Weekday } from '../../domain/recurrence/recurrence-rule';

import { Button } from '../../shared/ui/button';
import { cn } from '../../shared/lib/cn';
import {
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '../../shared/ui/form-controls';
import {
  createRecurrenceRule,
  defaultRecurrenceRule,
  describeRecurrence,
  WEEKDAY_LABEL,
  WEEKDAY_SHORT,
  WEEKDAYS,
} from '../../domain/recurrence/recurrence-rule';
import { isErr } from '../../domain/shared/result';

/**
 * Editor de repeticion.
 *
 * Muestra en todo momento la frase resultante ("Cada 2 semanas los lunes y jueves").
 * Con cuatro controles combinables es facil construir una regla que no es la que se
 * queria, y la frase es la unica forma de comprobarlo sin esperar una semana a ver
 * cuando reaparece la tarea.
 */

export interface RecurrenceEditorProps {
  value: RecurrenceRule | null;
  onChange: (rule: RecurrenceRule | null) => void;
  /** Necesaria para que la regla tenga desde donde contar. */
  hasDueDate: boolean;
}

export const RecurrenceEditor = ({ value, onChange, hasDueDate }: RecurrenceEditorProps) => {
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<RecurrenceRule>) => {
    const result = createRecurrenceRule({ ...(value ?? defaultRecurrenceRule()), ...patch });

    if (isErr(result)) {
      setError(result.error.message);
      return;
    }

    setError(null);
    onChange(result.value);
  };

  const toggleEnabled = (enabled: boolean) => {
    setError(null);
    onChange(enabled ? defaultRecurrenceRule() : null);
  };

  const toggleWeekday = (day: Weekday) => {
    const current = value?.weekdays ?? [];
    const next = current.includes(day)
      ? current.filter((entry) => entry !== day)
      : [...current, day];

    update({ weekdays: next });
  };

  return (
    <div className="space-y-3">
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-ink-soft">Se repite</span>
        <Switch
          checked={value !== null}
          onCheckedChange={toggleEnabled}
          disabled={!hasDueDate}
          aria-label="Activar repeticion"
        />
      </label>

      {!hasDueDate && (
        <p className="text-xs text-ink-muted">
          Ponle una fecha de vencimiento para poder repetirla.
        </p>
      )}

      {value !== null && (
        <div className="animate-fade-in space-y-3 rounded-xl border border-line bg-sunken p-3">
          <div className="flex items-end gap-2">
            <Field label="Cada" className="w-20 shrink-0">
              <Input
                type="number"
                min={1}
                max={365}
                value={value.interval}
                onChange={(event) =>
                  update({ interval: Math.max(1, Number(event.target.value) || 1) })
                }
                inputMode="numeric"
              />
            </Field>

            <Field label="Periodo" className="flex-1">
              <Select
                value={value.frequency}
                onValueChange={(frequency) =>
                  update({ frequency: frequency as RecurrenceRule['frequency'] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">{value.interval === 1 ? 'Dia' : 'Dias'}</SelectItem>
                  <SelectItem value="weekly">
                    {value.interval === 1 ? 'Semana' : 'Semanas'}
                  </SelectItem>
                  <SelectItem value="monthly">{value.interval === 1 ? 'Mes' : 'Meses'}</SelectItem>
                  <SelectItem value="yearly">{value.interval === 1 ? 'Año' : 'Años'}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          {value.frequency === 'weekly' && (
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-ink-soft">Que dias</span>
              <div className="flex gap-1">
                {WEEKDAYS.map((day) => {
                  const active = value.weekdays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleWeekday(day)}
                      aria-pressed={active}
                      aria-label={WEEKDAY_LABEL[day]}
                      className={cn(
                        'size-9 rounded-lg text-sm font-medium transition-colors',
                        'focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none',
                        active
                          ? 'bg-brand-600 text-white'
                          : 'bg-panel text-ink-soft hover:bg-hover',
                      )}
                    >
                      {WEEKDAY_SHORT[day]}
                    </button>
                  );
                })}
              </div>
              {value.weekdays.length === 0 && (
                <p className="text-xs text-ink-muted">
                  Sin dias marcados usa el mismo dia de la semana que la fecha de vencimiento.
                </p>
              )}
            </div>
          )}

          {value.frequency === 'monthly' && (
            <Field label="Como se repite cada mes">
              <Select
                value={value.monthlyMode}
                onValueChange={(mode) =>
                  update({ monthlyMode: mode as RecurrenceRule['monthlyMode'] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day-of-month">El mismo dia del mes</SelectItem>
                  <SelectItem value="day-of-week">El mismo dia de la semana</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}

          {/* Esta opcion cambia por completo el comportamiento y merece explicacion:
              "pagar la renta" va por calendario; "regar las plantas" va desde que lo hiciste. */}
          <label className="flex items-start justify-between gap-3 rounded-lg bg-panel p-2.5">
            <span className="space-y-0.5">
              <span className="block text-sm font-medium text-ink">
                Contar desde que la complete
              </span>
              <span className="block text-xs text-ink-muted">
                Activado: si la haces 3 dias tarde, la siguiente se corre 3 dias. Desactivado: sigue
                el calendario pase lo que pase.
              </span>
            </span>
            <Switch
              checked={value.fromCompletion}
              onCheckedChange={(fromCompletion) => update({ fromCompletion })}
              aria-label="Contar desde que la complete"
            />
          </label>

          <Field label="Termina">
            <Select
              value={value.ends.kind}
              onValueChange={(kind) => {
                if (kind === 'never') update({ ends: { kind: 'never' } });
                else if (kind === 'after') update({ ends: { kind: 'after', occurrences: 10 } });
                else
                  update({
                    ends: {
                      kind: 'on',
                      date: new Date(Date.now() + 90 * 86_400_000).toISOString(),
                    },
                  });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="never">Nunca</SelectItem>
                <SelectItem value="after">Despues de N veces</SelectItem>
                <SelectItem value="on">En una fecha</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {value.ends.kind === 'after' && (
            <Field label="Cuantas veces">
              <Input
                type="number"
                min={1}
                max={1000}
                value={value.ends.occurrences}
                onChange={(event) =>
                  update({
                    ends: {
                      kind: 'after',
                      occurrences: Math.max(1, Number(event.target.value) || 1),
                    },
                  })
                }
                inputMode="numeric"
              />
            </Field>
          )}

          {value.ends.kind === 'on' && (
            <Field label="Hasta">
              <Input
                type="date"
                value={value.ends.date.slice(0, 10)}
                onChange={(event) => {
                  const parsed = new Date(`${event.target.value}T23:59:59`);
                  if (!Number.isNaN(parsed.getTime())) {
                    update({ ends: { kind: 'on', date: parsed.toISOString() } });
                  }
                }}
              />
            </Field>
          )}

          <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs font-medium text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
            {describeRecurrence(value)}
          </p>

          {error !== null && (
            <p className="text-xs text-danger" role="alert">
              {error}
            </p>
          )}

          <Button variant="ghost" size="sm" onClick={() => toggleEnabled(false)} type="button">
            Quitar repeticion
          </Button>
        </div>
      )}
    </div>
  );
};
