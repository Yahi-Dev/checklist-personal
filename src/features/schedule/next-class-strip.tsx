import { Building2, ChevronRight, GraduationCap, Globe } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { activeTermCode, buildWeeklySchedule } from '../../domain/schedule/weekly-schedule';
import { cn } from '../../shared/lib/cn';
import { describeLocation, describeUpcoming, minutesOfDay } from './schedule-format';
import { findUpcomingClass } from '../../domain/schedule/next-class';
import { toDateKey } from '../../shared/lib/date-format';
import { useNow } from '../../shared/hooks/use-now';
import { useScheduleBlocks, useSubjects } from '../../shared/hooks/use-live-query';

/**
 * La proxima clase, arriba del todo en Hoy.
 *
 * Es lo mas barato de toda la funcion y probablemente lo mas mirado: responde de un
 * vistazo a las dos preguntas que uno se hace diez veces al dia -cuanto falta y a que
 * aula- sin abrir el horario.
 *
 * NO SE PINTA SI NO HAY NADA. Un hueco fijo que dice "no tienes clases" ocupa el mejor
 * sitio de la pantalla para no decir nada; en fin de semana o en vacaciones,
 * sencillamente no esta.
 */
export const NextClassStrip = () => {
  const subjects = useSubjects();
  const blocks = useScheduleBlocks();
  const navigate = useNavigate();
  const now = new Date(useNow());

  if (subjects === undefined || blocks === undefined) return null;

  const termCode = activeTermCode(subjects, toDateKey(now));
  if (termCode === null) return null;

  const days = buildWeeklySchedule(subjects, blocks, { termCode });
  const upcoming = findUpcomingClass(
    days,
    now.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6,
    minutesOfDay(now),
  );

  if (upcoming === null) return null;

  const { item } = upcoming;
  const location = describeLocation(item.block);

  return (
    <button
      type="button"
      onClick={() => {
        void navigate('/horario');
      }}
      className={cn(
        'flex w-full items-center gap-3 rounded-card border border-line/70 bg-panel px-3.5 py-2.5',
        'text-left shadow-soft transition-[transform,box-shadow,border-color] duration-200 ease-spring',
        'hover:-translate-y-0.5 hover:border-line hover:shadow-raised',
        'focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none',
      )}
      aria-label={`Proxima clase: ${item.subject.name}`}
    >
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-xl"
        style={{ backgroundColor: `${item.subject.color}1f`, color: item.subject.color }}
        aria-hidden="true"
      >
        <GraduationCap className="size-4.5" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 truncate text-sm font-semibold text-ink">
            {item.subject.name}
          </span>
          <span
            className={cn(
              'shrink-0 text-xs font-medium',
              upcoming.isNow ? 'text-success' : 'text-brand-600 dark:text-brand-400',
            )}
          >
            {describeUpcoming(upcoming)}
          </span>
        </span>

        <span className="mt-0.5 flex items-center gap-1 font-mono text-xs text-ink-muted">
          {location.isRemote ? (
            <>
              <Globe className="size-3.5 shrink-0" aria-hidden="true" />
              Virtual
            </>
          ) : (
            <>
              <Building2 className="size-3.5 shrink-0" aria-hidden="true" />
              {location.fallback ??
                [location.building, location.room]
                  .filter((part): part is string => part !== null)
                  .join(' · ')}
            </>
          )}
        </span>
      </span>

      <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
    </button>
  );
};
