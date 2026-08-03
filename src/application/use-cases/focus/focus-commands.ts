import type { FocusMode, FocusSession, FocusSettings } from '../../../domain/focus/focus-session';
import type { FocusSessionId, TaskId } from '../../../domain/shared/branded';
import type { Result } from '../../../domain/shared/result';
import type { UseCase, UseCaseContext } from '../use-case';

import { DomainErrors } from '../../../domain/shared/domain-error';
import {
  abandonFocusSession,
  finishFocusSession,
  startFocusSession,
} from '../../../domain/focus/focus-session';
import { err, isErr, ok } from '../../../domain/shared/result';
import { recordPomodoro } from '../../../domain/task/task';

export interface StartFocusCommand {
  readonly taskId: TaskId | null;
  readonly mode: FocusMode;
  readonly settings: FocusSettings;
}

/**
 * Arranca un bloque de concentracion.
 *
 * Si habia otro abierto, se cierra como abandonado antes de empezar el nuevo. La
 * alternativa -rechazar el arranque- deja al usuario atascado tras un cierre
 * inesperado de la app, con una sesion zombi que no puede cerrar desde ningun sitio.
 */
export class StartFocusSessionUseCase implements UseCase<StartFocusCommand, FocusSession> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: StartFocusCommand): Promise<Result<FocusSession>> {
    const user = this.context.currentUser();
    if (user === null) {
      return err(DomainErrors.unauthenticated('Necesitas iniciar sesion para hacer esto.'));
    }

    const now = this.context.clock.now().toISOString();

    const active = await this.context.focusSessions.findActive();
    if (isErr(active)) return active;

    if (active.value !== null) {
      const elapsed = (Date.parse(now) - Date.parse(active.value.startedAt)) / 1000;
      const closed = abandonFocusSession(active.value, elapsed, now);
      const saved = await this.context.focusSessions.save(closed);
      if (isErr(saved)) return saved;
    }

    const session = startFocusSession({
      id: this.context.ids.next<FocusSessionId>(),
      userId: user.id,
      taskId: command.taskId,
      mode: command.mode,
      settings: command.settings,
      now,
    });

    if (isErr(session)) return session;
    return this.context.focusSessions.save(session.value);
  }
}

export interface FinishFocusCommand {
  readonly sessionId: FocusSessionId;
  readonly elapsedSeconds: number;
}

/** Cierra el bloque y, si era de concentracion y se completo, suma un pomodoro a la tarea. */
export class FinishFocusSessionUseCase implements UseCase<FinishFocusCommand, FocusSession> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: FinishFocusCommand): Promise<Result<FocusSession>> {
    const found = await this.context.focusSessions.findById(command.sessionId);
    if (isErr(found)) return found;
    if (found.value === null) return err(DomainErrors.notFound('No encontramos esa sesion.'));

    const now = this.context.clock.now().toISOString();
    const finished = finishFocusSession(found.value, command.elapsedSeconds, now);

    const saved = await this.context.focusSessions.save(finished);
    if (isErr(saved)) return saved;

    if (finished.mode === 'focus' && finished.wasCompleted && finished.taskId !== null) {
      const task = await this.context.tasks.findById(finished.taskId);
      if (!isErr(task) && task.value !== null) {
        await this.context.tasks.save(recordPomodoro(task.value, now));
      }
    }

    return ok(finished);
  }
}

export class AbandonFocusSessionUseCase implements UseCase<FinishFocusCommand, FocusSession> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: FinishFocusCommand): Promise<Result<FocusSession>> {
    const found = await this.context.focusSessions.findById(command.sessionId);
    if (isErr(found)) return found;
    if (found.value === null) return err(DomainErrors.notFound('No encontramos esa sesion.'));

    const abandoned = abandonFocusSession(
      found.value,
      command.elapsedSeconds,
      this.context.clock.now().toISOString(),
    );

    return this.context.focusSessions.save(abandoned);
  }
}
