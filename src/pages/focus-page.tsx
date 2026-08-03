import { Coffee, Pause, Play, RotateCcw, SkipForward, Timer } from 'lucide-react';
import { toast } from 'sonner';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { TaskId } from '../domain/shared/branded';

import { Badge, RingProgress } from '../shared/ui/feedback';
import { Button } from '../shared/ui/button';
import { Card, CardContent, PageContent, PageHeader } from '../shared/ui/layout';
import { cn } from '../shared/lib/cn';
import { FOCUS_MODE_LABEL, formatDuration } from '../domain/focus/focus-session';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../shared/ui/form-controls';
import { getContainer } from '../infrastructure/di/container';
import { isPendingSpec } from '../domain/task/task-specifications';
import { sortTasks } from '../domain/task/task-sorting';
import { useAllTasks } from '../shared/hooks/use-live-query';
import { useFocusTimer } from '../features/focus/use-focus-timer';
import { usePreferences } from '../shared/stores/preferences-store';

/**
 * Modo enfoque (Pomodoro) enlazado a una tarea.
 *
 * Al terminar un bloque de concentracion se suma un pomodoro a la tarea, y esa cuenta
 * alimenta las estadisticas. Es la parte que convierte el temporizador en algo mas que
 * una cuenta atras bonita: mide en que se fue el tiempo de verdad.
 */
export const FocusPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tasks = useAllTasks();
  const settings = usePreferences((state) => state.focusSettings);
  const container = getContainer();

  const selectedTaskId = (searchParams.get('tarea') as TaskId | null) ?? null;

  const timer = useFocusTimer(settings, (mode) => {
    const message =
      mode === 'focus' ? 'Bloque completado. Toca descansar.' : 'Descanso terminado. A darle.';

    toast.success(message);

    void container.context.notifications.showNow({
      id: `focus-${Date.now()}`,
      title: mode === 'focus' ? 'Bloque de concentracion completado' : 'Se acabo el descanso',
      body: message,
      taskId: null,
    });
  });

  const pendingTasks = useMemo(() => {
    if (tasks === undefined) return [];
    const spec = isPendingSpec();
    return sortTasks(
      tasks.filter((task) => spec.isSatisfiedBy(task)),
      'smart',
    ).slice(0, 50);
  }, [tasks]);

  const activeTask = useMemo(
    () => pendingTasks.find((task) => task.id === (timer.taskId ?? selectedTaskId)) ?? null,
    [pendingTasks, timer.taskId, selectedTaskId],
  );

  const isBreak = timer.mode !== 'focus';
  const isLocked = timer.status === 'running' || timer.status === 'paused';

  return (
    <>
      <PageHeader title="Enfoque" subtitle="Bloques de concentracion sin distracciones" />

      <PageContent className="max-w-xl">
        <div className="flex flex-col items-center gap-6 pt-4">
          <Badge variant={isBreak ? 'success' : 'brand'} className="gap-1.5 px-3 py-1 text-sm">
            {isBreak ? <Coffee className="size-3.5" /> : <Timer className="size-3.5" />}
            {FOCUS_MODE_LABEL[timer.mode]}
          </Badge>

          {/* El anillo respira mientras corre el bloque: un recordatorio periferico
              de que el tiempo avanza, sin numeros parpadeando. */}
          <RingProgress
            value={timer.progress}
            size={260}
            strokeWidth={12}
            className={cn(timer.status === 'running' && 'animate-breathe')}
          >
            <span className="font-mono text-5xl font-semibold tracking-tight text-ink tabular-nums">
              {formatDuration(timer.remainingSeconds)}
            </span>
            <span className="mt-1 text-xs text-ink-muted">
              {timer.completedCyclesToday} {timer.completedCyclesToday === 1 ? 'bloque' : 'bloques'}{' '}
              hoy
            </span>
          </RingProgress>

          {/* Los puntos del ciclo: cuantos bloques faltan para el descanso largo. */}
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {Array.from({ length: settings.cyclesBeforeLongBreak }, (_, index) => (
              <span
                key={index}
                className={cn(
                  'size-2 rounded-full transition-colors',
                  index < timer.completedCyclesToday % settings.cyclesBeforeLongBreak
                    ? 'bg-brand-500'
                    : 'bg-line-strong',
                )}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {timer.status === 'running' ? (
              <Button size="lg" variant="secondary" onClick={timer.pause}>
                <Pause className="size-5" />
                Pausar
              </Button>
            ) : timer.status === 'paused' ? (
              <Button size="lg" variant="primary" onClick={timer.resume}>
                <Play className="size-5" />
                Continuar
              </Button>
            ) : (
              <Button
                size="lg"
                variant="primary"
                onClick={() => void timer.start(timer.mode, activeTask?.id ?? null)}
              >
                <Play className="size-5" />
                Empezar {isBreak ? 'descanso' : `${settings.focusMinutes} min`}
              </Button>
            )}

            {isLocked && (
              <>
                <Button
                  size="lg"
                  variant="ghost"
                  onClick={() => void timer.skip()}
                  aria-label="Saltar"
                >
                  <SkipForward className="size-5" />
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  onClick={() => void timer.stop()}
                  aria-label="Reiniciar"
                >
                  <RotateCcw className="size-5" />
                </Button>
              </>
            )}
          </div>

          <Card className="w-full">
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <span className="text-sm font-medium text-ink-soft">¿En que estas trabajando?</span>
                <Select
                  value={activeTask?.id ?? '__none__'}
                  onValueChange={(value) => {
                    setSearchParams(value === '__none__' ? {} : { tarea: value });
                  }}
                  disabled={isLocked}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sin tarea concreta" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sin tarea concreta</SelectItem>
                    {pendingTasks.map((task) => (
                      <SelectItem key={task.id} value={task.id}>
                        {task.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isLocked && (
                  <p className="text-xs text-ink-muted">
                    No se puede cambiar con un bloque en marcha.
                  </p>
                )}
              </div>

              {activeTask !== null && (
                <div className="rounded-lg bg-sunken px-3 py-2 text-sm">
                  <p className="font-medium text-ink">{activeTask.title}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {activeTask.completedPomodoros}
                    {activeTask.estimatedPomodoros !== null
                      ? ` de ${activeTask.estimatedPomodoros}`
                      : ''}{' '}
                    {activeTask.completedPomodoros === 1 ? 'pomodoro' : 'pomodoros'}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </PageContent>
    </>
  );
};
