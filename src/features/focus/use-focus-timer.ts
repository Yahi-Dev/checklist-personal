import { useCallback, useEffect, useState } from 'react';

import type { FocusMode, FocusSettings } from '../../domain/focus/focus-session';
import type { TaskId } from '../../domain/shared/branded';

import {
  AbandonFocusSessionUseCase,
  FinishFocusSessionUseCase,
  StartFocusSessionUseCase,
} from '../../application/use-cases/focus/focus-commands';
import { getContainer } from '../../infrastructure/di/container';
import { isErr } from '../../domain/shared/result';
import { nextFocusMode, plannedMinutesFor } from '../../domain/focus/focus-session';
import { useActiveFocusSession, useFocusSessions } from '../../shared/hooks/use-live-query';
import { useNow } from '../../shared/hooks/use-now';

/**
 * Temporizador Pomodoro.
 *
 * DOS DECISIONES QUE DEFINEN ESTE HOOK
 * ------------------------------------
 *
 * 1. EL TIEMPO SE MIDE CON RELOJ DE PARED, NO CONTANDO TICS.
 *    La version ingenua hace `setInterval(1000)` y resta uno al contador en cada
 *    vuelta. Se desvia siempre: los temporizadores del navegador se estrangulan en
 *    pestañas de fondo -en el movil pueden pararse del todo- y veinticinco minutos
 *    reales acaban contados como dieciocho. Aqui el tiempo restante se CALCULA como
 *    `fin - ahora` en cada render, asi que perder tics no desvia nada: volver a la
 *    pestaña tras diez minutos muestra la cifra correcta.
 *
 * 2. LA SESION PERSISTIDA ES LA FUENTE DE VERDAD, NO EL ESTADO LOCAL.
 *    Todo lo que se muestra se DERIVA de la fila que ya esta en IndexedDB: modo,
 *    duracion, tiempo restante y estado. No hay ningun efecto que copie la sesion al
 *    estado de React, y por eso cerrar la app a mitad de un bloque y volver a abrirla
 *    recupera el temporizador exacto sin una sola linea de codigo de recuperacion.
 *    Lo unico que vive en estado local es la pausa, que es informacion de esta
 *    ventana y de nadie mas.
 */

/** Cada cuanto se recalcula la cuenta atras. Cuatro veces por segundo va sobrado. */
const TICK_MS = 250;

export type TimerStatus = 'idle' | 'running' | 'paused' | 'finished';

export interface FocusTimerState {
  readonly status: TimerStatus;
  readonly mode: FocusMode;
  readonly remainingSeconds: number;
  readonly totalSeconds: number;
  /** 0..1 */
  readonly progress: number;
  readonly taskId: TaskId | null;
  readonly completedCyclesToday: number;
}

export interface FocusTimerControls {
  start: (mode: FocusMode, taskId: TaskId | null) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<void>;
  skip: () => Promise<void>;
}

export const useFocusTimer = (
  settings: FocusSettings,
  onSessionComplete?: (mode: FocusMode) => void,
): FocusTimerState & FocusTimerControls => {
  const container = getContainer();
  const activeSession = useActiveFocusSession() ?? null;
  const now = useNow(TICK_MS);

  /* Se calcula una sola vez al montar y no se recalcula: el hook no necesita
     enterarse de que cambio el dia, y volver a leerlo en cada render invalidaria la
     consulta de sesiones sin motivo. */
  const [todayStart] = useState(() => new Date(new Date().setHours(0, 0, 0, 0)).toISOString());
  const sessionsToday = useFocusSessions(todayStart);

  /**
   * Lo unico que NO se deriva de la sesion persistida.
   * `pausedAt` congela el reloj de referencia; `pausedOffsetMs` acumula lo que ya se
   * estuvo en pausa, para que al reanudar el final se corra ese mismo rato.
   */
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [pausedOffsetMs, setPausedOffsetMs] = useState(0);

  /** Modo propuesto cuando no hay sesion abierta (lo que tocaria empezar ahora). */
  const [idleMode, setIdleMode] = useState<FocusMode>('focus');

  const completedCyclesToday = (sessionsToday ?? []).filter(
    (session) => session.mode === 'focus' && session.wasCompleted,
  ).length;

  // --- Estado derivado -----------------------------------------------------

  const mode: FocusMode = activeSession?.mode ?? idleMode;
  const totalSeconds = activeSession?.plannedSeconds ?? plannedMinutesFor(mode, settings) * 60;

  const endsAt =
    activeSession === null
      ? null
      : Date.parse(activeSession.startedAt) + activeSession.plannedSeconds * 1000 + pausedOffsetMs;

  // En pausa, el reloj de referencia se queda clavado en el instante en que se pauso.
  const reference = pausedAt ?? now;

  const remainingSeconds =
    endsAt === null ? totalSeconds : Math.max(0, Math.round((endsAt - reference) / 1000));

  const status: TimerStatus =
    activeSession === null
      ? 'idle'
      : pausedAt !== null
        ? 'paused'
        : remainingSeconds > 0
          ? 'running'
          : 'finished';

  // --- Acciones ------------------------------------------------------------

  const startSession = useCallback(
    async (nextMode: FocusMode, taskId: TaskId | null) => {
      setPausedAt(null);
      setPausedOffsetMs(0);
      setIdleMode(nextMode);

      const result = await new StartFocusSessionUseCase(container.context).execute({
        taskId,
        mode: nextMode,
        settings,
      });

      if (isErr(result)) return;
      // No hace falta guardar nada mas: `useActiveFocusSession` ve la fila nueva y
      // todo lo demas se recalcula solo.
    },
    [container, settings],
  );

  const stop = useCallback(async () => {
    if (activeSession !== null) {
      const elapsed = (Date.now() - Date.parse(activeSession.startedAt) - pausedOffsetMs) / 1000;
      await new AbandonFocusSessionUseCase(container.context).execute({
        sessionId: activeSession.id,
        elapsedSeconds: Math.max(0, elapsed),
      });
    }

    setPausedAt(null);
    setPausedOffsetMs(0);
    setIdleMode('focus');
  }, [activeSession, container, pausedOffsetMs]);

  const pause = useCallback(() => {
    if (activeSession === null || pausedAt !== null) return;
    setPausedAt(Date.now());
  }, [activeSession, pausedAt]);

  const resume = useCallback(() => {
    if (pausedAt === null) return;
    // Al reanudar, el final se corre exactamente lo que duro la pausa.
    setPausedOffsetMs((offset) => offset + (Date.now() - pausedAt));
    setPausedAt(null);
  }, [pausedAt]);

  /** Saltar cuenta como abandono: no debe inflar las estadisticas. */
  const skip = useCallback(async () => {
    await stop();
  }, [stop]);

  // --- Cierre automatico al llegar a cero ----------------------------------

  useEffect(() => {
    if (status !== 'finished' || activeSession === null) return;

    let cancelled = false;

    void (async () => {
      const result = await new FinishFocusSessionUseCase(container.context).execute({
        sessionId: activeSession.id,
        elapsedSeconds: activeSession.plannedSeconds,
      });

      if (cancelled || isErr(result)) return;

      onSessionComplete?.(activeSession.mode);

      setPausedAt(null);
      setPausedOffsetMs(0);

      const upcoming = nextFocusMode(activeSession.mode, completedCyclesToday, settings);
      setIdleMode(upcoming);

      const shouldAutoStart =
        (activeSession.mode === 'focus' && settings.autoStartBreaks) ||
        (activeSession.mode !== 'focus' && settings.autoStartFocus);

      if (shouldAutoStart) {
        await startSession(upcoming, activeSession.taskId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    status,
    activeSession,
    container,
    settings,
    completedCyclesToday,
    onSessionComplete,
    startSession,
  ]);

  return {
    status,
    mode,
    remainingSeconds,
    totalSeconds,
    progress: totalSeconds === 0 ? 0 : 1 - remainingSeconds / totalSeconds,
    taskId: activeSession?.taskId ?? null,
    completedCyclesToday,
    start: startSession,
    pause,
    resume,
    stop,
    skip,
  };
};
