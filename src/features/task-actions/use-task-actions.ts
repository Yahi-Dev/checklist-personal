import { toast } from 'sonner';
import { useCallback, useMemo } from 'react';

import type { AttachmentId, SubtaskId, TaskId } from '../../domain/shared/branded';
import type {
  CreateTaskCommand,
  SnoozePreset,
  UpdateTaskCommand,
} from '../../application/use-cases/task/task-commands';
import type { DomainError } from '../../domain/shared/domain-error';
import type { Task } from '../../domain/task/task';

import {
  AddFileAttachmentUseCase,
  AddLinkAttachmentUseCase,
  RemoveAttachmentUseCase,
} from '../../application/use-cases/task/attachment-commands';
import {
  AddSubtaskUseCase,
  RemoveSubtaskUseCase,
  RenameSubtaskUseCase,
  ReorderSubtaskUseCase,
  ToggleSubtaskUseCase,
} from '../../application/use-cases/task/subtask-commands';
import {
  ArchiveTaskUseCase,
  CompleteTaskUseCase,
  CreateTaskUseCase,
  DeleteTaskUseCase,
  ReorderTaskUseCase,
  RestoreTaskUseCase,
  SnoozeTaskUseCase,
  SNOOZE_PRESET_LABEL,
  ToggleImportantUseCase,
  UncompleteTaskUseCase,
  UpdateTaskUseCase,
} from '../../application/use-cases/task/task-commands';
import { formatDueDate } from '../../shared/lib/date-format';
import { getContainer } from '../../infrastructure/di/container';
import { isErr } from '../../domain/shared/result';
import { QuickCaptureTaskUseCase } from '../../application/use-cases/task/quick-capture-task';

/**
 * El puente entre los componentes y los casos de uso.
 *
 * Concentra tres cosas que si no acabarian copiadas en cada componente:
 *   1. Construir los casos de uso con el contenedor.
 *   2. Traducir un `Result` fallido en un aviso legible.
 *   3. Ofrecer DESHACER en toda accion destructiva.
 *
 * Ese tercer punto es una decision de producto sostenida en codigo: la app no pregunta
 * "¿seguro que quieres borrarla?" antes de cada cosa. Ejecuta al instante y deja
 * revertir durante unos segundos. Confirmar cuesta un toque cada vez; deshacer cuesta
 * un toque solo cuando te equivocas, que es mucho mas raro.
 */

const showError = (error: DomainError): void => {
  toast.error(error.message);
};

export interface TaskActions {
  create: (command: CreateTaskCommand) => Promise<Task | null>;
  quickCapture: (text: string) => Promise<Task | null>;
  update: (command: UpdateTaskCommand) => Promise<Task | null>;
  complete: (task: Task) => Promise<void>;
  uncomplete: (taskId: TaskId) => Promise<void>;
  snooze: (task: Task, preset: SnoozePreset) => Promise<void>;
  snoozeUntil: (taskId: TaskId, isoDate: string) => Promise<void>;
  remove: (task: Task) => Promise<void>;
  archive: (taskId: TaskId) => Promise<void>;
  restore: (taskId: TaskId) => Promise<void>;
  toggleImportant: (taskId: TaskId) => Promise<void>;
  reorder: (taskId: TaskId, previousId: TaskId | null, nextId: TaskId | null) => Promise<void>;

  addSubtask: (taskId: TaskId, title: string) => Promise<void>;
  toggleSubtask: (taskId: TaskId, subtaskId: SubtaskId) => Promise<void>;
  renameSubtask: (taskId: TaskId, subtaskId: SubtaskId, title: string) => Promise<void>;
  removeSubtask: (taskId: TaskId, subtaskId: SubtaskId) => Promise<void>;
  reorderSubtask: (
    taskId: TaskId,
    subtaskId: SubtaskId,
    previousId: SubtaskId | null,
    nextId: SubtaskId | null,
  ) => Promise<void>;

  addLink: (taskId: TaskId, url: string, name?: string) => Promise<void>;
  addFile: (taskId: TaskId, file: File) => Promise<void>;
  removeAttachment: (taskId: TaskId, attachmentId: AttachmentId) => Promise<void>;
}

export const useTaskActions = (): TaskActions => {
  const container = getContainer();

  const useCases = useMemo(
    () => ({
      create: new CreateTaskUseCase(container.context),
      quickCapture: new QuickCaptureTaskUseCase(container.context),
      update: new UpdateTaskUseCase(container.context),
      complete: new CompleteTaskUseCase(container.context),
      uncomplete: new UncompleteTaskUseCase(container.context),
      snooze: new SnoozeTaskUseCase(container.context),
      remove: new DeleteTaskUseCase(container.context),
      restore: new RestoreTaskUseCase(container.context),
      archive: new ArchiveTaskUseCase(container.context),
      toggleImportant: new ToggleImportantUseCase(container.context),
      reorder: new ReorderTaskUseCase(container.context),
      addSubtask: new AddSubtaskUseCase(container.context),
      toggleSubtask: new ToggleSubtaskUseCase(container.context),
      renameSubtask: new RenameSubtaskUseCase(container.context),
      removeSubtask: new RemoveSubtaskUseCase(container.context),
      reorderSubtask: new ReorderSubtaskUseCase(container.context),
      addLink: new AddLinkAttachmentUseCase(container.context),
      addFile: new AddFileAttachmentUseCase(container.context),
      removeAttachment: new RemoveAttachmentUseCase(container.context),
    }),
    [container],
  );

  const create = useCallback(
    async (command: CreateTaskCommand) => {
      const result = await useCases.create.execute(command);
      if (isErr(result)) {
        showError(result.error);
        return null;
      }
      return result.value;
    },
    [useCases],
  );

  const quickCapture = useCallback(
    async (text: string) => {
      const result = await useCases.quickCapture.execute({ text });

      if (isErr(result)) {
        showError(result.error);
        return null;
      }

      const { task, parsed, createdCategory, createdTags } = result.value;

      // Se confirma lo que el parser entendio. Si adivino mal la fecha, el usuario se
      // entera aqui y no tres dias despues cuando la tarea no aparecio en Hoy.
      const details: string[] = [];
      if (task.dueAt !== null) {
        details.push(formatDueDate(task.dueAt, { isAllDay: task.isAllDay }));
      }
      if (parsed.recurrence !== null) details.push('se repite');
      if (createdCategory) details.push(`categoria nueva: ${parsed.categoryName ?? ''}`);
      if (createdTags.length > 0) details.push(`etiquetas nuevas: ${createdTags.join(', ')}`);

      toast.success(task.title, {
        description: details.length > 0 ? details.join(' · ') : undefined,
      });

      return task;
    },
    [useCases],
  );

  const update = useCallback(
    async (command: UpdateTaskCommand) => {
      const result = await useCases.update.execute(command);
      if (isErr(result)) {
        showError(result.error);
        return null;
      }
      return result.value;
    },
    [useCases],
  );

  const complete = useCallback(
    async (task: Task) => {
      const result = await useCases.complete.execute({ taskId: task.id });

      if (isErr(result)) {
        showError(result.error);
        return;
      }

      const { next } = result.value;
      const nextDueAt = next?.dueAt ?? null;

      toast.success('Hecho', {
        description:
          next === null || nextDueAt === null
            ? task.title
            : `${task.title} · Siguiente: ${formatDueDate(nextDueAt, { isAllDay: next.isAllDay })}`,
        action: {
          label: 'Deshacer',
          onClick: () => {
            void useCases.uncomplete.execute({ taskId: task.id });
          },
        },
      });
    },
    [useCases],
  );

  const uncomplete = useCallback(
    async (taskId: TaskId) => {
      const result = await useCases.uncomplete.execute({ taskId });
      if (isErr(result)) showError(result.error);
    },
    [useCases],
  );

  const snooze = useCallback(
    async (task: Task, preset: SnoozePreset) => {
      const previousDueAt = task.dueAt;
      const result = await useCases.snooze.execute({ taskId: task.id, preset });

      if (isErr(result)) {
        showError(result.error);
        return;
      }

      toast(`Pospuesta: ${SNOOZE_PRESET_LABEL[preset].toLowerCase()}`, {
        description: task.title,
        action: {
          label: 'Deshacer',
          onClick: () => {
            // Se devuelve la fecha original por el caso de uso de actualizar y no por
            // el de posponer, que sumaria otro punto al contador de aplazamientos.
            void useCases.update.execute({ taskId: task.id, dueAt: previousDueAt });
          },
        },
      });
    },
    [useCases],
  );

  const snoozeUntil = useCallback(
    async (taskId: TaskId, isoDate: string) => {
      const result = await useCases.snooze.execute({ taskId, until: isoDate });
      if (isErr(result)) showError(result.error);
    },
    [useCases],
  );

  const remove = useCallback(
    async (task: Task) => {
      const result = await useCases.remove.execute({ taskId: task.id });

      if (isErr(result)) {
        showError(result.error);
        return;
      }

      toast('Tarea borrada', {
        description: task.title,
        action: {
          label: 'Deshacer',
          onClick: () => {
            void useCases.restore.execute({ taskId: task.id });
          },
        },
      });
    },
    [useCases],
  );

  const archive = useCallback(
    async (taskId: TaskId) => {
      const result = await useCases.archive.execute({ taskId });
      if (isErr(result)) showError(result.error);
      else toast('Tarea archivada', { description: 'La encuentras en Buscar, al final.' });
    },
    [useCases],
  );

  /**
   * Saca la tarea del archivo y la devuelve a pendiente.
   *
   * El caso de uso ya existia, pero solo se usaba para deshacer un borrado: no habia
   * ninguna forma de desarchivar desde la interfaz. Archivar era, en la practica, un
   * borrado sin papelera.
   */
  const restore = useCallback(
    async (taskId: TaskId) => {
      const result = await useCases.restore.execute({ taskId });
      if (isErr(result)) showError(result.error);
      else toast('Tarea recuperada');
    },
    [useCases],
  );

  const toggleImportant = useCallback(
    async (taskId: TaskId) => {
      const result = await useCases.toggleImportant.execute({ taskId });
      if (isErr(result)) showError(result.error);
    },
    [useCases],
  );

  const reorder = useCallback(
    async (taskId: TaskId, previousTaskId: TaskId | null, nextTaskId: TaskId | null) => {
      const result = await useCases.reorder.execute({ taskId, previousTaskId, nextTaskId });
      if (isErr(result)) showError(result.error);
    },
    [useCases],
  );

  const addSubtask = useCallback(
    async (taskId: TaskId, title: string) => {
      const result = await useCases.addSubtask.execute({ taskId, title });
      if (isErr(result)) showError(result.error);
    },
    [useCases],
  );

  const toggleSubtask = useCallback(
    async (taskId: TaskId, subtaskId: SubtaskId) => {
      const result = await useCases.toggleSubtask.execute({ taskId, subtaskId });
      if (isErr(result)) showError(result.error);
    },
    [useCases],
  );

  const renameSubtask = useCallback(
    async (taskId: TaskId, subtaskId: SubtaskId, title: string) => {
      const result = await useCases.renameSubtask.execute({ taskId, subtaskId, title });
      if (isErr(result)) showError(result.error);
    },
    [useCases],
  );

  const removeSubtask = useCallback(
    async (taskId: TaskId, subtaskId: SubtaskId) => {
      const result = await useCases.removeSubtask.execute({ taskId, subtaskId });
      if (isErr(result)) showError(result.error);
    },
    [useCases],
  );

  const reorderSubtask = useCallback(
    async (
      taskId: TaskId,
      subtaskId: SubtaskId,
      previousSubtaskId: SubtaskId | null,
      nextSubtaskId: SubtaskId | null,
    ) => {
      const result = await useCases.reorderSubtask.execute({
        taskId,
        subtaskId,
        previousSubtaskId,
        nextSubtaskId,
      });
      if (isErr(result)) showError(result.error);
    },
    [useCases],
  );

  const addLink = useCallback(
    async (taskId: TaskId, url: string, name?: string) => {
      const result = await useCases.addLink.execute({
        taskId,
        url,
        ...(name === undefined ? {} : { name }),
      });
      if (isErr(result)) showError(result.error);
      else toast.success('Enlace añadido');
    },
    [useCases],
  );

  const addFile = useCallback(
    async (taskId: TaskId, file: File) => {
      const pending = toast.loading(`Subiendo ${file.name}...`);
      const result = await useCases.addFile.execute({ taskId, file });

      toast.dismiss(pending);
      if (isErr(result)) showError(result.error);
      else toast.success('Archivo adjuntado');
    },
    [useCases],
  );

  const removeAttachment = useCallback(
    async (taskId: TaskId, attachmentId: AttachmentId) => {
      const result = await useCases.removeAttachment.execute({ taskId, attachmentId });
      if (isErr(result)) showError(result.error);
    },
    [useCases],
  );

  return {
    create,
    quickCapture,
    update,
    complete,
    uncomplete,
    snooze,
    snoozeUntil,
    remove,
    archive,
    restore,
    toggleImportant,
    reorder,
    addSubtask,
    toggleSubtask,
    renameSubtask,
    removeSubtask,
    reorderSubtask,
    addLink,
    addFile,
    removeAttachment,
  };
};
