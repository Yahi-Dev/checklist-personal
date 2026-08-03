import { ArrowDown, ArrowUp, CalendarClock, Check, Clock, Star, X } from 'lucide-react';

import type { AdvisorPlan, PlanAdjustment } from '../../domain/assistant/advisor-plan';
import type { PlanOutcome } from '../../application/ports/services';
import type { Task } from '../../domain/task/task';

import { Badge } from '../../shared/ui/feedback';
import { Button, Spinner } from '../../shared/ui/button';
import { cn } from '../../shared/lib/cn';
import { POSTPONE_TARGET_LABEL } from '../../domain/assistant/advisor-plan';
import { PRIORITY_LABEL } from '../../domain/task/value-objects/priority';
import { useAllTasks } from '../../shared/hooks/use-live-query';

/**
 * El plan propuesto, como tarjeta revisable.
 *
 * Esta tarjeta es el punto donde la sugerencia se convierte -o no- en cambios reales,
 * y por eso enseña el POR QUE de cada paso al lado del paso. Un orden sin motivos solo
 * se puede aceptar entero o rechazar entero; con los motivos delante, el usuario ve en
 * dos segundos si el asistente entendio mal algo y puede corregirlo escribiendo, que
 * es exactamente la conversacion que hace util a un asistente frente a un boton de
 * "ordenar automaticamente".
 *
 * Los titulos se leen de la base local y no del plan: si una tarea cambio de nombre
 * mientras el modelo respondia, aqui sale el nombre de ahora.
 */

export interface AdvisorPlanCardProps {
  plan: AdvisorPlan;
  outcome: PlanOutcome;
  isApplying: boolean;
  onApply: () => void;
  onDismiss: () => void;
}

export const AdvisorPlanCard = ({
  plan,
  outcome,
  isApplying,
  onApply,
  onDismiss,
}: AdvisorPlanCardProps) => {
  const tasks = useAllTasks();
  const byId = new Map((tasks ?? []).map((task) => [task.id as string, task]));

  const totalMinutes = plan.pasos.reduce((sum, step) => sum + (step.minutos ?? 0), 0);
  const isDecided = outcome !== 'pendiente';

  return (
    <div
      className={cn(
        'animate-rise-in overflow-hidden rounded-card border border-brand-200/70 bg-panel shadow-soft',
        'dark:border-brand-500/25',
        isDecided && 'opacity-80',
      )}
    >
      <div className="flex items-center gap-2 border-b border-line bg-brand-50/60 px-4 py-2.5 dark:bg-brand-500/10">
        <span className="text-sm font-semibold text-brand-700 dark:text-brand-300">
          Orden propuesto
        </span>

        {totalMinutes > 0 && (
          <Badge variant="neutral" size="sm">
            <Clock className="size-3" />
            {formatMinutes(totalMinutes)}
          </Badge>
        )}

        {outcome === 'aplicado' && (
          <Badge variant="success" size="sm" className="ml-auto">
            <Check className="size-3" />
            Aplicado
          </Badge>
        )}
        {outcome === 'descartado' && (
          <Badge variant="neutral" size="sm" className="ml-auto">
            Descartado
          </Badge>
        )}
      </div>

      <ol className="divide-y divide-line">
        {plan.pasos.map((step, index) => {
          const task = byId.get(step.taskId);

          return (
            <li key={step.taskId} className="flex gap-3 px-4 py-3">
              <span
                className={cn(
                  'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full',
                  'bg-brand-100 text-xs font-semibold text-brand-700',
                  'dark:bg-brand-500/20 dark:text-brand-300',
                )}
              >
                {index + 1}
              </span>

              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'text-sm font-medium text-ink',
                    // Una tarea completada entre la propuesta y el momento de aplicar
                    // ya no forma parte del plan: se marca en vez de desaparecer, para
                    // que el usuario entienda por que el plan encoge.
                    task?.status === 'completed' && 'text-ink-soft line-through',
                  )}
                >
                  {task?.title ?? 'Tarea que ya no existe'}
                </p>

                <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">{step.porque}</p>
              </div>

              {step.minutos !== null && (
                <span className="mt-0.5 shrink-0 text-xs text-ink-soft tabular-nums">
                  {formatMinutes(step.minutos)}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {plan.ajustes.length > 0 && (
        <div className="space-y-1.5 border-t border-line bg-sunken/50 px-4 py-3">
          <p className="text-xs font-semibold text-ink-soft">Ademas propone cambiar:</p>

          {plan.ajustes.map((adjustment, index) => (
            <AdjustmentRow
              key={`${adjustment.taskId}-${String(index)}`}
              adjustment={adjustment}
              task={byId.get(adjustment.taskId)}
            />
          ))}
        </div>
      )}

      {plan.descartadas > 0 && (
        <p className="border-t border-line px-4 py-2 text-xs text-warning">
          Se descartaron {plan.descartadas} referencias a tareas que no existen.
        </p>
      )}

      {!isDecided && (
        <div className="flex gap-2 border-t border-line px-4 py-3">
          <Button variant="primary" size="sm" onClick={onApply} disabled={isApplying}>
            {isApplying ? <Spinner className="size-4" /> : <Check />}
            Aplicar
          </Button>

          <Button variant="ghost" size="sm" onClick={onDismiss} disabled={isApplying}>
            <X />
            Asi no
          </Button>
        </div>
      )}
    </div>
  );
};

const AdjustmentRow = ({
  adjustment,
  task,
}: {
  adjustment: PlanAdjustment;
  task: Task | undefined;
}) => {
  const title = task?.title ?? 'Tarea desconocida';

  const { icon, text } = describeAdjustment(adjustment);

  return (
    <p className="flex items-start gap-1.5 text-xs text-ink-soft">
      <span className="mt-0.5 text-brand-500">{icon}</span>
      <span>
        <span className="font-medium text-ink">{title}</span> — {text}
      </span>
    </p>
  );
};

const describeAdjustment = (
  adjustment: PlanAdjustment,
): { icon: React.ReactNode; text: string } => {
  switch (adjustment.kind) {
    case 'prioridad':
      return {
        icon:
          adjustment.prioridad === 'high' ? (
            <ArrowUp className="size-3.5" />
          ) : (
            <ArrowDown className="size-3.5" />
          ),
        text: `prioridad ${PRIORITY_LABEL[adjustment.prioridad].toLowerCase()}`,
      };

    case 'destacar':
      return {
        icon: <Star className="size-3.5" />,
        text: adjustment.destacada ? 'marcarla como destacada' : 'quitarle la marca de destacada',
      };

    case 'posponer':
      return {
        icon: <CalendarClock className="size-3.5" />,
        text: `posponerla para ${POSTPONE_TARGET_LABEL[adjustment.hasta]}`,
      };
  }
};

const formatMinutes = (minutes: number): string => {
  if (minutes < 60) return `${String(minutes)} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
};
