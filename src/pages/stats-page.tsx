import { CheckCircle2, Clock, Flame, Timer, TrendingUp } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useMemo, useState } from 'react';

import { Badge } from '../shared/ui/feedback';
import { buildProductivitySnapshot } from '../domain/stats/productivity-stats';
import { Card, CardContent, PageContent, PageHeader } from '../shared/ui/layout';
import { cn } from '../shared/lib/cn';
import { EmptyState } from '../shared/ui/feedback';
import { SegmentedGroup, SegmentedItem } from '../shared/ui/form-controls';
import { useAllTasks, useCategoryIndex, useFocusSessions } from '../shared/hooks/use-live-query';
import { useNow } from '../shared/hooks/use-now';
import { WEEKDAY_LABEL, type Weekday } from '../domain/recurrence/recurrence-rule';

/**
 * Estadisticas de productividad.
 *
 * Todo se calcula EN EL CLIENTE con las funciones puras del dominio. Podria hacerse en
 * SQL, pero entonces habria dos implementaciones de "que cuenta como racha" que se
 * irian separando con el tiempo, y las cifras dejarian de salir estando sin conexion.
 */
export const StatsPage = () => {
  const tasks = useAllTasks();
  const [windowDays, setWindowDays] = useState(30);
  const categories = useCategoryIndex();

  /* El reloj entra como estado en vez de leerse con `Date.now()` durante el render.
     Ademas de mantener el componente puro, hace que la racha y el "completadas hoy"
     se actualicen solos si la ventana se queda abierta hasta pasada la medianoche.
     Se refresca cada cinco minutos: mas frecuente seria recalcular la ventana entera
     para nada. */
  const now = useNow(5 * 60_000);

  const since = useMemo(
    () => new Date(now - windowDays * 86_400_000).toISOString(),
    [now, windowDays],
  );
  const sessions = useFocusSessions(since);

  const snapshot = useMemo(() => {
    if (tasks === undefined) return null;
    return buildProductivitySnapshot(tasks, sessions ?? [], new Date(now), windowDays);
  }, [tasks, sessions, windowDays, now]);

  if (snapshot === null) {
    return (
      <>
        <PageHeader title="Estadisticas" />
        <PageContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, index) => (
              <Card key={index} className="h-24 animate-pulse" />
            ))}
          </div>
        </PageContent>
      </>
    );
  }

  if (snapshot.totalTasks === 0) {
    return (
      <>
        <PageHeader title="Estadisticas" />
        <PageContent>
          <EmptyState
            icon={<TrendingUp />}
            title="Todavia no hay nada que medir"
            description="En cuanto empieces a completar tareas apareceran aqui tus rachas y tus mejores dias."
          />
        </PageContent>
      </>
    );
  }

  const dailyData = snapshot.dailyCounts.map((day) => ({
    date: day.date,
    label: new Date(`${day.date}T12:00:00`).getDate().toString(),
    completadas: day.completed,
    creadas: day.created,
  }));

  const weekdayData = snapshot.weekdayProductivity.map((entry) => ({
    weekday: WEEKDAY_LABEL[entry.weekday as Weekday].slice(0, 3),
    media: entry.average,
    total: entry.completed,
  }));

  const bestWeekday = [...snapshot.weekdayProductivity].sort((a, b) => b.average - a.average)[0];
  const bestWeekdayLabel =
    bestWeekday === undefined ? null : WEEKDAY_LABEL[bestWeekday.weekday as Weekday].slice(0, 3);

  return (
    <>
      <PageHeader title="Estadisticas" subtitle="Como te ha ido de verdad">
        <SegmentedGroup
          type="single"
          value={String(windowDays)}
          onValueChange={(value) => {
            if (value !== '') setWindowDays(Number(value));
          }}
        >
          <SegmentedItem value="7">7 dias</SegmentedItem>
          <SegmentedItem value="30">30 dias</SegmentedItem>
          <SegmentedItem value="90">90 dias</SegmentedItem>
        </SegmentedGroup>
      </PageHeader>

      <PageContent className="space-y-4">
        {/* ---------------- Resumen ---------------- */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            icon={<Flame className="size-4" />}
            label="Racha actual"
            value={`${snapshot.streak.current} ${snapshot.streak.current === 1 ? 'dia' : 'dias'}`}
            hint={`Tu record: ${snapshot.streak.longest}`}
            tone={snapshot.streak.current > 0 ? 'warning' : 'neutral'}
          />
          <StatTile
            icon={<CheckCircle2 className="size-4" />}
            label="Esta semana"
            value={String(snapshot.completedThisWeek)}
            hint={`Hoy: ${snapshot.completedToday}`}
            tone="success"
          />
          <StatTile
            icon={<TrendingUp className="size-4" />}
            label="Completadas"
            value={`${Math.round(snapshot.completionRate * 100)}%`}
            hint={`${snapshot.completedTotal} de ${snapshot.completedTotal + snapshot.pendingTotal}`}
            tone="brand"
          />
          <StatTile
            icon={<Timer className="size-4" />}
            label="Concentracion"
            value={`${Math.floor(snapshot.focusMinutesThisWeek / 60)}h ${snapshot.focusMinutesThisWeek % 60}m`}
            hint={`${snapshot.focusSessionsThisWeek} bloques`}
            tone="brand"
          />
        </div>

        {snapshot.overdueTotal > 0 && (
          <Card className="border-danger/30 bg-danger/5">
            <CardContent className="flex items-center gap-3 py-3">
              <Clock className="size-5 shrink-0 text-danger" />
              <p className="text-sm text-ink">
                Tienes <strong className="text-danger">{snapshot.overdueTotal}</strong>{' '}
                {snapshot.overdueTotal === 1 ? 'tarea atrasada' : 'tareas atrasadas'}.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ---------------- Actividad diaria ---------------- */}
        <Card>
          <CardContent className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-ink">Actividad diaria</h2>
              <span className="text-xs text-ink-muted">Ultimos {windowDays} dias</span>
            </div>

            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={dailyData} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="var(--border-subtle)"
                />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                  // Con 90 dias no caben todas las etiquetas: se muestra una de cada N.
                  interval={Math.max(0, Math.floor(dailyData.length / 12) - 1)}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                  width={32}
                />
                <ChartTooltip
                  content={<ChartTooltipCard />}
                  cursor={{ fill: 'var(--surface-hover)' }}
                />
                {/* Degradado vertical celeste -> morado en las barras: el mismo
                    crepusculo de la marca, para que la grafica sea de ESTA app. */}
                <defs>
                  <linearGradient id="barra-actividad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-brand-400)" />
                    <stop offset="100%" stopColor="var(--color-accent-500)" />
                  </linearGradient>
                </defs>
                <Bar dataKey="completadas" fill="url(#barra-actividad)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* ---------------- Mejores dias ---------------- */}
        <Card>
          <CardContent className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-ink">En que dias rindes mas</h2>
              {bestWeekday !== undefined && bestWeekday.average > 0 && (
                <Badge variant="brand" size="sm">
                  {WEEKDAY_LABEL[bestWeekday.weekday as Weekday]}
                </Badge>
              )}
            </div>

            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={weekdayData} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="var(--border-subtle)"
                />
                <XAxis
                  dataKey="weekday"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                  width={32}
                />
                <ChartTooltip
                  content={<ChartTooltipCard suffix=" de media" />}
                  cursor={{ fill: 'var(--surface-hover)' }}
                />
                {/* El color por barra sale de una funcion `fill` y no de componentes
                    `<Cell>`, que recharts 3 dejo obsoletos. El dia mas productivo va
                    en el tono fuerte para que se identifique sin leer la leyenda. */}
                <Bar
                  dataKey="media"
                  radius={[3, 3, 0, 0]}
                  fill="var(--color-brand-300)"
                  activeBar={{ fill: 'var(--color-brand-600)' }}
                  shape={(props: BarShapeProps) => (
                    <rect
                      x={props.x}
                      y={props.y}
                      width={props.width}
                      height={props.height}
                      rx={3}
                      fill={
                        props.payload?.weekday === bestWeekdayLabel
                          ? 'var(--color-brand-500)'
                          : 'var(--color-brand-300)'
                      }
                    />
                  )}
                />
              </BarChart>
            </ResponsiveContainer>

            <p className="text-xs text-ink-muted">
              Se muestra la MEDIA por dia de la semana, no el total: en 30 dias unos dias aparecen
              cinco veces y otros cuatro, y el total premiaria a los primeros.
            </p>
          </CardContent>
        </Card>

        {/* ---------------- Por categoria ---------------- */}
        {snapshot.categoryBreakdown.length > 0 && (
          <Card>
            <CardContent className="space-y-3">
              <h2 className="text-sm font-semibold text-ink">Por categoria</h2>

              <ul className="space-y-2">
                {[...snapshot.categoryBreakdown]
                  .sort((a, b) => b.completed + b.pending - (a.completed + a.pending))
                  .map((entry) => {
                    const category =
                      entry.categoryId === null ? null : categories.get(entry.categoryId);
                    const total = entry.completed + entry.pending;
                    const ratio = total === 0 ? 0 : entry.completed / total;

                    return (
                      <li key={entry.categoryId ?? 'none'} className="space-y-1">
                        <div className="flex items-center gap-2 text-sm">
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: category?.color ?? '#94a3b8' }}
                          />
                          <span className="flex-1 truncate text-ink">
                            {category?.name ?? 'Sin categoria'}
                          </span>
                          {entry.overdue > 0 && (
                            <Badge variant="danger" size="sm">
                              {entry.overdue} atrasadas
                            </Badge>
                          )}
                          <span className="text-xs text-ink-muted tabular-nums">
                            {entry.completed}/{total}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
                          <div
                            className="h-full rounded-full transition-[width] duration-500"
                            style={{
                              width: `${ratio * 100}%`,
                              backgroundColor: category?.color ?? '#94a3b8',
                            }}
                          />
                        </div>
                      </li>
                    );
                  })}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* ---------------- Lo que siempre pateas ---------------- */}
        {snapshot.mostPostponed.length > 0 && (
          <Card>
            <CardContent className="space-y-3">
              <h2 className="text-sm font-semibold text-ink">Lo que mas pospones</h2>
              <p className="text-xs text-ink-muted">
                Si algo lleva cinco aplazamientos, quiza el problema no sea la agenda: dividelo en
                pasos mas pequeños o borralo sin culpa.
              </p>

              <ul className="space-y-1.5">
                {snapshot.mostPostponed.map((entry) => (
                  <li
                    key={entry.taskId}
                    className="flex items-center gap-2 rounded-lg bg-sunken px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{entry.title}</span>
                    <Badge variant="warning" size="sm">
                      {entry.snoozeCount}x
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </PageContent>
    </>
  );
};

const TONE_STYLES = {
  neutral: 'text-ink-muted bg-sunken',
  brand: 'text-brand-600 bg-brand-100 dark:text-brand-300 dark:bg-brand-900/50',
  success: 'text-success bg-success/15',
  warning: 'text-warning bg-warning/15',
} as const;

const StatTile = ({
  icon,
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: keyof typeof TONE_STYLES;
}) => (
  <Card>
    <CardContent className="space-y-1.5 p-3.5">
      <div className="flex items-center gap-2">
        <span
          className={cn('flex size-7 items-center justify-center rounded-lg', TONE_STYLES[tone])}
        >
          {icon}
        </span>
        <span className="text-xs font-medium text-ink-muted">{label}</span>
      </div>
      <p className="text-2xl font-semibold tracking-tight text-ink tabular-nums">{value}</p>
      {hint !== undefined && <p className="text-xs text-ink-muted">{hint}</p>}
    </CardContent>
  </Card>
);

/** Lo que recharts pasa a una `shape` personalizada de barra. */
interface BarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: { weekday?: string };
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: readonly { name?: string; value?: number; payload?: { date?: string } }[];
  label?: string;
  suffix?: string;
}

const ChartTooltipCard = ({ active, payload, suffix = '' }: ChartTooltipProps) => {
  if (active !== true || payload === undefined || payload.length === 0) return null;

  const entry = payload[0];
  const rawDate = entry?.payload?.date;

  return (
    <div className="rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs shadow-raised">
      {rawDate !== undefined && (
        <p className="font-medium text-ink">
          {new Intl.DateTimeFormat('es-DO', { day: 'numeric', month: 'short' }).format(
            new Date(`${rawDate}T12:00:00`),
          )}
        </p>
      )}
      <p className="text-ink-soft">
        {entry?.value ?? 0}
        {suffix.length > 0 ? suffix : ' completadas'}
      </p>
    </div>
  );
};
