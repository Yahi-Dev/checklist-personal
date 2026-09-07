import { Building2, ChevronRight, DoorOpen, Globe } from 'lucide-react';

import type { ScheduleDay, ScheduledClass } from '../../domain/schedule/weekly-schedule';

import { Badge } from '../../shared/ui/feedback';
import { cn } from '../../shared/lib/cn';
import {
  classProgressAt,
  describeLocation,
  formatClassCount,
  formatClassTime,
  formatGap,
  weekdayLabel,
} from './schedule-format';

/**
 * Un dia del horario como una linea de tiempo vertical.
 *
 * La forma no es decorativa. Un horario se consulta para responder a dos preguntas -"a
 * que hora entro" y "cuanto me queda"- y las dos se leen mejor en vertical: la hora a la
 * izquierda hace de regla, el hilo une las clases del dia y los huecos aparecen como lo
 * que son, tiempo entre dos puntos. Una rejilla de columnas por dia, que es lo que hace
 * la universidad en el PDF, obliga a buscar en dos ejes y no cabe en un telefono.
 *
 * El hueco entre clases se ANUNCIA ("4h libre") en vez de dibujarse a escala. Cuatro
 * horas a escala serian cuatro pantallas de vacio, y el usuario no necesita medirlas:
 * necesita saber que estan ahi.
 */

export interface ScheduleDayCardProps {
  readonly day: ScheduleDay;
  readonly isToday: boolean;
  /** Minutos transcurridos del dia. Solo se usa si `isToday`. */
  readonly nowMinutes: number;
  readonly onSelect: (item: ScheduledClass) => void;
  /** Escalona la entrada de las tarjetas al abrir la pantalla. */
  readonly entranceDelayMs?: number;
}

/* Una sola definicion de rejilla para las filas de clase Y para las de hueco: es lo que
   mantiene la barrita del hueco exactamente sobre el hilo del dia. Con dos rejillas
   distintas se desalinean en cuanto cambia el tamaño de la fuente. */
const ROW_GRID = 'grid grid-cols-[4.25rem_0.75rem_1fr_auto] items-stretch gap-x-3';

export const ScheduleDayCard = ({
  day,
  isToday,
  nowMinutes,
  onSelect,
  entranceDelayMs = 0,
}: ScheduleDayCardProps) => (
  <section
    className={cn(
      'animate-rise-in overflow-hidden rounded-card border bg-panel shadow-soft',
      // El dia de hoy se distingue por el BORDE, no por el fondo: un relleno de color
      // detras del texto le quita contraste justo a la tarjeta que mas se mira.
      isToday ? 'border-brand-500' : 'border-line/70',
    )}
    style={entranceDelayMs > 0 ? { animationDelay: `${String(entranceDelayMs)}ms` } : undefined}
    aria-label={weekdayLabel(day.weekday)}
  >
    <header
      className={cn(
        'flex items-center gap-2.5 border-b border-line/70 px-4 py-3',
        isToday && 'bg-linear-to-r from-brand-600/8 to-accent-600/5',
        isToday && 'dark:from-brand-400/10 dark:to-accent-400/6',
      )}
    >
      <h2 className="text-lg font-semibold tracking-tight text-ink">{weekdayLabel(day.weekday)}</h2>
      {isToday && (
        <Badge variant="brand" size="sm">
          HOY
        </Badge>
      )}
      <span className="ml-auto shrink-0 text-sm text-ink-muted tabular-nums">
        {formatClassCount(day.classes.length)}
      </span>
    </header>

    <div className="px-4 py-3">
      {day.classes.map((item, index) => {
        const gap = item.gapAfterMinutes === null ? null : formatGap(item.gapAfterMinutes);

        return (
          <div key={item.block.id}>
            <ClassRow
              item={item}
              progress={isToday ? classProgressAt(item.block, nowMinutes) : 'upcoming'}
              isLast={index === day.classes.length - 1 && gap === null}
              onSelect={onSelect}
            />
            {gap !== null && <GapRow label={gap} />}
          </div>
        );
      })}
    </div>
  </section>
);

interface ClassRowProps {
  readonly item: ScheduledClass;
  readonly progress: ReturnType<typeof classProgressAt>;
  readonly isLast: boolean;
  readonly onSelect: (item: ScheduledClass) => void;
}

const ClassRow = ({ item, progress, isLast, onSelect }: ClassRowProps) => {
  const { block, subject } = item;
  const location = describeLocation(block);
  const isNow = progress === 'now';

  return (
    <button
      type="button"
      onClick={() => {
        onSelect(item);
      }}
      className={cn(
        ROW_GRID,
        'group w-full rounded-xl py-1 text-left transition-colors duration-200',
        'hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none',
        // Lo que ya paso se apaga, no se tacha: sigue siendo consultable.
        progress === 'past' && 'opacity-45',
      )}
      aria-label={`${subject.name}, ${formatClassTime(block.startsAt)} a ${formatClassTime(block.endsAt)}`}
    >
      {/* Columna de horas: la de entrada arriba y la de salida abajo del todo, para que
          el hueco entre ambas se lea como la duracion de la clase. */}
      <span className="flex flex-col justify-between py-0.5 text-right">
        <span className="text-[15px] leading-tight font-bold text-ink tabular-nums">
          {formatClassTime(block.startsAt)}
        </span>
        <span className="text-[13px] leading-tight text-ink-muted tabular-nums">
          {formatClassTime(block.endsAt)}
        </span>
      </span>

      {/* El hilo del dia. El punto toma el color de la asignatura: en una semana con seis
          materias, el color es lo que deja reconocer cual es sin leer. */}
      <span className="flex flex-col items-center pt-1" aria-hidden="true">
        <span
          className={cn(
            'size-2.5 shrink-0 rounded-full border-2 bg-panel',
            isNow && 'animate-breathe',
          )}
          style={{ borderColor: subject.color }}
        />
        <span
          className={cn('w-px flex-1 bg-line', isLast && 'bg-linear-to-b from-line to-transparent')}
        />
        <span className="size-1.5 shrink-0 rounded-full bg-line-strong" />
      </span>

      <span className="min-w-0 space-y-0.5 pb-3">
        <span className="flex items-center gap-2">
          <span className="min-w-0 truncate text-[15px] leading-snug font-semibold text-ink">
            {subject.name}
          </span>
          {isNow && (
            <Badge variant="success" size="sm">
              Ahora
            </Badge>
          )}
        </span>

        <span className="block truncate text-xs text-ink-muted">
          <span className="font-mono">{subject.code}</span>
          {subject.teacherName !== null && <> · {toTitleCase(subject.teacherName)}</>}
        </span>

        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs text-ink-soft">
          {location.isRemote ? (
            <span className="inline-flex items-center gap-1">
              <Globe className="size-3.5 shrink-0" aria-hidden="true" />
              Virtual
            </span>
          ) : (
            <>
              {location.building !== null && (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="size-3.5 shrink-0" aria-hidden="true" />
                  {location.building}
                </span>
              )}
              {location.room !== null && (
                <span className="inline-flex items-center gap-1">
                  <DoorOpen className="size-3.5 shrink-0" aria-hidden="true" />
                  {location.room}
                </span>
              )}
              {location.fallback !== null && (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="size-3.5 shrink-0" aria-hidden="true" />
                  {location.fallback}
                </span>
              )}
            </>
          )}
        </span>
      </span>

      <ChevronRight
        className="mt-1.5 size-4 shrink-0 self-start text-ink-muted transition-transform duration-200 group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </button>
  );
};

const GapRow = ({ label }: { label: string }) => (
  <div className={cn(ROW_GRID, 'items-center pb-3')} aria-hidden="true">
    <span />
    <span className="flex justify-center">
      <span className="h-5 w-0.5 rounded-full bg-brand-400/70 dark:bg-brand-500/60" />
    </span>
    <span className="text-xs font-medium text-brand-600 dark:text-brand-400">{label}</span>
    <span />
  </div>
);

/**
 * `LEDESMA UREÑA, JORGE LUIS` -> `Ledesma Ureña, Jorge Luis`.
 *
 * La universidad imprime los nombres en mayusculas porque su sistema es de los ochenta.
 * En una lista, un bloque en mayusculas grita y ademas se lee mas despacio: el ojo
 * pierde la silueta de la palabra, que es por donde reconoce.
 */
const toTitleCase = (value: string): string =>
  value
    .toLocaleLowerCase('es')
    .replace(
      /(^|[\s,.-])(\p{L})/gu,
      (_match, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase('es')}`,
    );
