import type { ProductivitySnapshot } from '../../../domain/stats/productivity-stats';
import type { Result } from '../../../domain/shared/result';
import type { UseCase, UseCaseContext } from '../use-case';

import { buildProductivitySnapshot } from '../../../domain/stats/productivity-stats';
import { isErr, ok } from '../../../domain/shared/result';

export interface ProductivityQuery {
  /** Ventana de analisis en dias. 30 por defecto. */
  readonly windowDays?: number;
}

/**
 * Reune tareas y sesiones y delega el calculo en el dominio.
 *
 * Todo se lee desde la copia LOCAL, no del servidor: las estadisticas tienen que salir
 * igual de completas en el avion que en casa, y ademas asi no hay una segunda
 * implementacion en SQL que pueda discrepar de la del dominio.
 */
export class GetProductivitySnapshotUseCase implements UseCase<
  ProductivityQuery,
  ProductivitySnapshot
> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(query: ProductivityQuery = {}): Promise<Result<ProductivitySnapshot>> {
    const windowDays = Math.min(Math.max(query.windowDays ?? 30, 7), 365);

    const [tasks, sessions] = await Promise.all([
      this.context.tasks.findAll({ includeDeleted: false }),
      this.context.focusSessions.findAll({
        since: new Date(this.context.clock.nowMs() - windowDays * 86_400_000).toISOString(),
      }),
    ]);

    if (isErr(tasks)) return tasks;
    if (isErr(sessions)) return sessions;

    return ok(
      buildProductivitySnapshot(tasks.value, sessions.value, this.context.clock.now(), windowDays),
    );
  }
}
