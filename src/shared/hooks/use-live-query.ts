import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';

import type { Category } from '../../domain/category/category';
import type { FocusSession } from '../../domain/focus/focus-session';
import type { ScheduleBlock } from '../../domain/schedule/schedule-block';
import type { Subject } from '../../domain/schedule/subject';
import type { Tag } from '../../domain/tag/tag';
import type { Task } from '../../domain/task/task';
import type { TaskId } from '../../domain/shared/branded';

import { db } from '../../infrastructure/persistence/database';
import { Outbox } from '../../infrastructure/persistence/outbox';
import { stripHints } from '../../infrastructure/persistence/records';

/**
 * Lecturas reactivas contra IndexedDB.
 *
 * ESTE ES EL LADO DE CONSULTA DE UN CQRS SENCILLO. Los casos de uso son el lado de
 * ESCRITURA y siempre pasan por repositorios; para LEER, la interfaz observa las
 * tablas directamente con `useLiveQuery`.
 *
 * Es una asimetria deliberada. `useLiveQuery` de Dexie se engancha a las transacciones
 * de IndexedDB, asi que cualquier escritura -venga de un click del usuario, del motor
 * de sincronizacion o de un evento de Realtime- repinta la lista sola. Hacer que las
 * lecturas pasaran por el repositorio significaria reimplementar esa invalidacion a
 * mano, con cache que se queda vieja y pantallas que no se enteran de que el telefono
 * completo una tarea hace un segundo.
 *
 * La regla que si se mantiene: aqui NUNCA se escribe. Solo se lee y se proyecta.
 */

export const useAllTasks = (): Task[] | undefined =>
  useLiveQuery(
    async () => {
      const records = await db.tasks.where('_deleted').equals(0).toArray();
      return records.map((record) => stripHints<Task>(record));
    },
    [],
    undefined,
  );

export const useTask = (taskId: TaskId | null): Task | null | undefined =>
  useLiveQuery(
    async () => {
      if (taskId === null) return null;
      const record = await db.tasks.get(taskId);
      return record === undefined ? null : stripHints<Task>(record);
    },
    [taskId],
    undefined,
  );

export const useCategories = (): Category[] | undefined =>
  useLiveQuery(
    async () => {
      const records = await db.categories.where('_deleted').equals(0).toArray();
      return records
        .map((record) => stripHints<Category>(record))
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'es'));
    },
    [],
    undefined,
  );

export const useTags = (): Tag[] | undefined =>
  useLiveQuery(
    async () => {
      const records = await db.tags.where('_deleted').equals(0).toArray();
      return records
        .map((record) => stripHints<Tag>(record))
        .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    },
    [],
    undefined,
  );

export const useFocusSessions = (sinceIso?: string): FocusSession[] | undefined =>
  useLiveQuery(
    async () => {
      const records =
        sinceIso === undefined
          ? await db.focusSessions.toArray()
          : await db.focusSessions.where('startedAt').aboveOrEqual(sinceIso).toArray();

      return records
        .map((record) => stripHints<FocusSession>(record))
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    },
    [sinceIso],
    undefined,
  );

export const useActiveFocusSession = (): FocusSession | null | undefined =>
  useLiveQuery(async () => {
    const records = await db.focusSessions.toArray();
    const open = records
      .map((record) => stripHints<FocusSession>(record))
      .filter((session) => session.endedAt === null)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));

    return open[0] ?? null;
  }, []);

export const useSubjects = (termCode?: string): Subject[] | undefined =>
  useLiveQuery(
    async () => {
      const records =
        termCode === undefined
          ? await db.subjects.where('_deleted').equals(0).toArray()
          : await db.subjects.where('[_deleted+termCode]').equals([0, termCode]).toArray();

      return records
        .map((record) => stripHints<Subject>(record))
        .sort(
          (a, b) =>
            b.termCode.localeCompare(a.termCode, 'es') ||
            a.position - b.position ||
            a.code.localeCompare(b.code, 'es'),
        );
    },
    [termCode],
    undefined,
  );

export const useScheduleBlocks = (weekday?: number): ScheduleBlock[] | undefined =>
  useLiveQuery(
    async () => {
      const records =
        weekday === undefined
          ? await db.scheduleBlocks.where('_deleted').equals(0).toArray()
          : await db.scheduleBlocks.where('[_deleted+weekday]').equals([0, weekday]).toArray();

      return records
        .map((record) => stripHints<ScheduleBlock>(record))
        .sort(
          (a, b) =>
            a.weekday - b.weekday ||
            a.startsAt.localeCompare(b.startsAt) ||
            a.id.localeCompare(b.id),
        );
    },
    [weekday],
    undefined,
  );

/**
 * Cuantos cambios siguen en camino a la nube.
 *
 * Cuenta solo los que aun se reintentan solos. Los que el servidor ya rechazo demasiadas
 * veces se cuentan aparte, en el estado de sincronizacion: mezclarlos aqui dejaba el
 * indicador clavado en "3 por subir" indefinidamente, y ademas hacia que el disparador de
 * "sincronizar poco despues de escribir" viera cola pendiente donde no habia nada que
 * ningun reintento fuera a resolver.
 */
export const usePendingOutboxCount = (): number =>
  useLiveQuery(() => new Outbox(db).pendingCount(), [], 0) ?? 0;

/** Indices por id: evita un `find()` dentro del bucle de renderizado de la lista. */
export const useCategoryIndex = (): Map<string, Category> => {
  const categories = useCategories();

  return useMemo(
    () => new Map((categories ?? []).map((category) => [category.id as string, category])),
    [categories],
  );
};

export const useTagIndex = (): Map<string, Tag> => {
  const tags = useTags();

  return useMemo(() => new Map((tags ?? []).map((tag) => [tag.id as string, tag])), [tags]);
};

export const useSubjectIndex = (termCode?: string): Map<string, Subject> => {
  const subjects = useSubjects(termCode);

  return useMemo(
    () => new Map((subjects ?? []).map((subject) => [subject.id as string, subject])),
    [subjects],
  );
};
