import type { AdvisorEvent, AdvisorMessage } from '../../ports/services';
import type {
  AdvisorPlan,
  PlanAdjustment,
  PostponeTarget,
} from '../../../domain/assistant/advisor-plan';
import type { IsoDateTime } from '../../../domain/task/value-objects/iso-date-time';
import type { PlanningBrief } from '../../../domain/assistant/planning-brief';
import type { Result } from '../../../domain/shared/result';
import type { SnoozePreset } from '../task/task-commands';
import type { Task } from '../../../domain/task/task';
import type { UseCase, UseCaseContext } from '../use-case';

import { buildPlanningBrief } from '../../../domain/assistant/planning-brief';
import { DomainErrors } from '../../../domain/shared/domain-error';
import { err, isErr, ok } from '../../../domain/shared/result';
import { positionsBeforeAll } from '../../../domain/shared/sortable-position';
import { resolvePreset, SnoozeTaskUseCase } from '../task/task-commands';
import { updateTask } from '../../../domain/task/task';

/**
 * Casos de uso del asistente.
 *
 * Son dos, y la separacion es intencionada: PREGUNTAR no escribe nada y APLICAR no
 * habla con ningun modelo. Entre uno y otro hay siempre una decision del usuario.
 * Fusionarlos en un solo caso de uso "el asistente reorganiza tu dia" seria mas corto
 * de escribir y bastante peor de usar: el usuario perderia el unico punto donde puede
 * mirar el plan antes de que le cambien las tareas.
 */

// ---------------------------------------------------------------------------
// Preguntar
// ---------------------------------------------------------------------------

export interface AskAdvisorCommand {
  /** La conversacion entera, con el mensaje nuevo del usuario ya al final. */
  readonly messages: readonly AdvisorMessage[];
  readonly signal?: AbortSignal;
}

export interface AdvisorStream {
  /** Lo que vio el asistente. La interfaz lo enseña para que el consejo sea auditable. */
  readonly brief: PlanningBrief;
  readonly events: AsyncIterable<AdvisorEvent>;
}

/**
 * Manda un turno de conversacion junto con el estado del dia.
 *
 * El resumen se construye AQUI y no en la interfaz. Asi la respuesta no depende de en
 * que pantalla estaba el usuario ni de que filtros tenia puestos: el asistente ve el
 * dia entero, siempre igual, se le pregunte desde donde se le pregunte.
 */
export class AskAdvisorUseCase implements UseCase<AskAdvisorCommand, AdvisorStream> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: AskAdvisorCommand): Promise<Result<AdvisorStream>> {
    if (!this.context.advisor.isAvailable) {
      return err(
        DomainErrors.infrastructure(
          'El asistente necesita la conexion con la nube. Configura Supabase y vuelve a intentarlo.',
        ),
      );
    }

    if (command.messages.length === 0) {
      return err(DomainErrors.validation('No hay nada que preguntar.'));
    }

    const [tasks, categories, tags] = await Promise.all([
      this.context.tasks.findAll(),
      this.context.categories.findAll(),
      this.context.tags.findAll(),
    ]);

    if (isErr(tasks)) return tasks;
    if (isErr(categories)) return categories;
    if (isErr(tags)) return tags;

    const brief = buildPlanningBrief({
      tasks: tasks.value,
      now: this.context.clock.now(),
      categories: categories.value,
      tags: tags.value,
    });

    if (brief.tareas.length === 0) {
      return err(
        DomainErrors.validation(
          'No tienes nada pendiente para hoy ni para los proximos dias. No hay nada que priorizar.',
        ),
      );
    }

    return ok({
      brief,
      events: this.context.advisor.ask({
        brief,
        messages: command.messages,
        signal: command.signal,
      }),
    });
  }
}

// ---------------------------------------------------------------------------
// Aplicar
// ---------------------------------------------------------------------------

export interface ApplyAdvisorPlanCommand {
  readonly plan: AdvisorPlan;
}

export interface AppliedPlanSummary {
  /** Cuantas tareas quedaron colocadas en el orden propuesto. */
  readonly reordenadas: number;
  readonly ajustadas: number;
  /** Referencias que ya no se pudieron aplicar (tarea borrada o completada entretanto). */
  readonly omitidas: number;
}

/**
 * Lleva el plan a las tareas.
 *
 * Dos detalles que no son evidentes:
 *
 * PRIMERO se aplican los ajustes y DESPUES el orden. Al reves, una tarea pospuesta a
 * mañana se quedaria colocada entre las de hoy, que es justo lo contrario de lo que
 * pidio el plan.
 *
 * El orden se escribe subiendo las tareas del plan por delante de todas las demas, en
 * vez de repartir posiciones nuevas por toda la lista. Reescribir la lista entera
 * generaria una operacion de sincronizacion por cada tarea existente; asi se tocan
 * como mucho doce filas.
 */
export class ApplyAdvisorPlanUseCase implements UseCase<
  ApplyAdvisorPlanCommand,
  AppliedPlanSummary
> {
  constructor(private readonly context: UseCaseContext) {}

  async execute({ plan }: ApplyAdvisorPlanCommand): Promise<Result<AppliedPlanSummary>> {
    const pending = await this.context.tasks.findAll({ statuses: ['pending'] });
    if (isErr(pending)) return pending;

    const byId = new Map(pending.value.map((task) => [task.id as string, task]));
    let skipped = 0;

    const adjusted = await this.applyAdjustments(plan.ajustes, byId);
    if (isErr(adjusted)) return adjusted;
    skipped += adjusted.value.skipped;

    // Se relee el estado: los ajustes pueden haber movido fechas, y posponer una tarea
    // la saca de la lista de hoy aunque el plan la nombrara en un paso.
    const afterAdjustments = await this.context.tasks.findAll({ statuses: ['pending'] });
    if (isErr(afterAdjustments)) return afterAdjustments;

    const postponed = new Set(
      plan.ajustes.filter((a) => a.kind === 'posponer').map((a) => a.taskId as string),
    );

    const live = new Map(afterAdjustments.value.map((task) => [task.id as string, task]));
    const ordered: Task[] = [];

    for (const step of plan.pasos) {
      const task = live.get(step.taskId);
      if (task === undefined || postponed.has(step.taskId)) {
        skipped += 1;
        continue;
      }
      ordered.push(task);
    }

    if (ordered.length === 0) {
      return ok({ reordenadas: 0, ajustadas: adjusted.value.applied, omitidas: skipped });
    }

    const plannedIds = new Set(ordered.map((task) => task.id as string));
    const others = afterAdjustments.value
      .filter((task) => !plannedIds.has(task.id))
      .map((task) => task.position);

    const positions = positionsBeforeAll(ordered.length, others);
    const now = this.context.clock.now().toISOString();

    const moved = ordered.map((task, index) => ({
      ...task,
      position: positions[index] ?? task.position,
      updatedAt: now,
    }));

    const saved = await this.context.tasks.saveMany(moved);
    if (isErr(saved)) return saved;

    return ok({
      reordenadas: moved.length,
      ajustadas: adjusted.value.applied,
      omitidas: skipped,
    });
  }

  private async applyAdjustments(
    adjustments: readonly PlanAdjustment[],
    byId: ReadonlyMap<string, Task>,
  ): Promise<Result<{ applied: number; skipped: number }>> {
    const snooze = new SnoozeTaskUseCase(this.context);
    const now = this.context.clock.now().toISOString();

    let applied = 0;
    let skipped = 0;

    for (const adjustment of adjustments) {
      const task = byId.get(adjustment.taskId);
      if (task === undefined) {
        skipped += 1;
        continue;
      }

      if (adjustment.kind === 'posponer') {
        const result = await snooze.execute({
          taskId: adjustment.taskId,
          preset: SNOOZE_BY_TARGET[adjustment.hasta],
        });

        // Un ajuste que falla no aborta el resto del plan: el usuario prefiere que se
        // aplique lo que se pueda y se le diga cuanto quedo fuera.
        if (isErr(result)) skipped += 1;
        else applied += 1;
        continue;
      }

      const patch =
        adjustment.kind === 'prioridad'
          ? { priority: adjustment.prioridad }
          : { isImportant: adjustment.destacada };

      const updated = updateTask(task, patch, now);
      if (isErr(updated)) {
        skipped += 1;
        continue;
      }

      const saved = await this.context.tasks.save(updated.value);
      if (isErr(saved)) skipped += 1;
      else applied += 1;
    }

    return ok({ applied, skipped });
  }
}

/**
 * Traduccion entre el vocabulario del asistente y los atajos de posponer.
 *
 * Es un mapa explicito a proposito, aunque los nombres se parezcan: el dominio no
 * puede importar `SnoozePreset` (vive en esta capa), y hacer coincidir las cadenas por
 * casualidad convertiria un renombrado inocente en un fallo silencioso.
 */
const SNOOZE_BY_TARGET: Readonly<Record<PostponeTarget, SnoozePreset>> = {
  'esta-noche': 'tonight',
  manana: 'tomorrow',
  'fin-de-semana': 'weekend',
  'semana-que-viene': 'next-week',
};

/** Expuesto para las pruebas: comprueba que el atajo cae donde se espera. */
export const resolvePostponeTarget = (target: PostponeTarget, now: Date): IsoDateTime =>
  resolvePreset(SNOOZE_BY_TARGET[target], now);
