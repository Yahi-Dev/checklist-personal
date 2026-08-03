import type { FocusSessionId, TaskId, UserId } from '../shared/branded';
import type { IsoDateTime } from '../task/value-objects/iso-date-time';
import type { Result } from '../shared/result';
import { DomainErrors } from '../shared/domain-error';
import { err, ok } from '../shared/result';

/** Fases del ciclo Pomodoro. */
export const FOCUS_MODES = ['focus', 'short-break', 'long-break'] as const;

export type FocusMode = (typeof FOCUS_MODES)[number];

export const FOCUS_MODE_LABEL: Readonly<Record<FocusMode, string>> = {
  focus: 'Concentracion',
  'short-break': 'Descanso corto',
  'long-break': 'Descanso largo',
};

export interface FocusSettings {
  readonly focusMinutes: number;
  readonly shortBreakMinutes: number;
  readonly longBreakMinutes: number;
  /** Cada cuantos bloques de concentracion toca el descanso largo. */
  readonly cyclesBeforeLongBreak: number;
  readonly autoStartBreaks: boolean;
  readonly autoStartFocus: boolean;
  readonly playSound: boolean;
}

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  cyclesBeforeLongBreak: 4,
  autoStartBreaks: true,
  autoStartFocus: false,
  playSound: true,
};

export interface FocusSession {
  readonly id: FocusSessionId;
  readonly userId: UserId;
  /** La tarea trabajada. `null` para una sesion suelta. */
  readonly taskId: TaskId | null;
  readonly mode: FocusMode;
  readonly startedAt: IsoDateTime;
  readonly endedAt: IsoDateTime | null;
  /** Duracion planificada en segundos. */
  readonly plannedSeconds: number;
  /** Segundos realmente trabajados, descontando pausas. */
  readonly elapsedSeconds: number;
  /** `true` solo si llego al final sin abandonarse. */
  readonly wasCompleted: boolean;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface StartFocusSessionInput {
  readonly id: FocusSessionId;
  readonly userId: UserId;
  readonly taskId: TaskId | null;
  readonly mode: FocusMode;
  readonly settings: FocusSettings;
  readonly now: IsoDateTime;
}

export const startFocusSession = (input: StartFocusSessionInput): Result<FocusSession> => {
  const minutes = plannedMinutesFor(input.mode, input.settings);

  if (minutes <= 0 || minutes > 240) {
    return err(
      DomainErrors.validation('La duracion tiene que estar entre 1 y 240 minutos.', {
        field: 'focus.minutes',
      }),
    );
  }

  return ok({
    id: input.id,
    userId: input.userId,
    taskId: input.taskId,
    mode: input.mode,
    startedAt: input.now,
    endedAt: null,
    plannedSeconds: minutes * 60,
    elapsedSeconds: 0,
    wasCompleted: false,
    createdAt: input.now,
    updatedAt: input.now,
  });
};

export const finishFocusSession = (
  session: FocusSession,
  elapsedSeconds: number,
  now: IsoDateTime,
): FocusSession => ({
  ...session,
  endedAt: now,
  elapsedSeconds: Math.max(0, Math.round(elapsedSeconds)),
  // Se da por completa con el 95%: cerrar la app un segundo antes no debe invalidarla.
  wasCompleted: elapsedSeconds >= session.plannedSeconds * 0.95,
  updatedAt: now,
});

export const abandonFocusSession = (
  session: FocusSession,
  elapsedSeconds: number,
  now: IsoDateTime,
): FocusSession => ({
  ...session,
  endedAt: now,
  elapsedSeconds: Math.max(0, Math.round(elapsedSeconds)),
  wasCompleted: false,
  updatedAt: now,
});

export const plannedMinutesFor = (mode: FocusMode, settings: FocusSettings): number => {
  switch (mode) {
    case 'focus':
      return settings.focusMinutes;
    case 'short-break':
      return settings.shortBreakMinutes;
    case 'long-break':
      return settings.longBreakMinutes;
    default:
      return settings.focusMinutes;
  }
};

/**
 * Decide que toca despues.
 * `completedFocusCycles` cuenta los bloques de concentracion cerrados hoy.
 */
export const nextFocusMode = (
  current: FocusMode,
  completedFocusCycles: number,
  settings: FocusSettings,
): FocusMode => {
  if (current !== 'focus') return 'focus';
  const isLongBreakTurn = (completedFocusCycles + 1) % settings.cyclesBeforeLongBreak === 0;
  return isLongBreakTurn ? 'long-break' : 'short-break';
};

/** Formatea segundos como `MM:SS`, o `H:MM:SS` si pasa de la hora. */
export const formatDuration = (totalSeconds: number): string => {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};
