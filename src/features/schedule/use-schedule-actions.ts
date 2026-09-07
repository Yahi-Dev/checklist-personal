import { toast } from 'sonner';
import { useCallback, useMemo } from 'react';

import type { DomainError } from '../../domain/shared/domain-error';
import type { ImportScheduleSummary } from '../../application/use-cases/schedule/import-schedule-pdf';
import type { ScheduleBlock } from '../../domain/schedule/schedule-block';
import type { ScheduleBlockId, SubjectId } from '../../domain/shared/branded';
import type { Subject } from '../../domain/schedule/subject';
import type {
  CreateScheduleBlockCommand,
  CreateSubjectCommand,
  UpdateScheduleBlockCommand,
  UpdateSubjectCommand,
} from '../../application/use-cases/schedule/schedule-commands';

import { getContainer } from '../../infrastructure/di/container';
import { ImportSchedulePdfUseCase } from '../../application/use-cases/schedule/import-schedule-pdf';
import { isErr } from '../../domain/shared/result';
import {
  CreateScheduleBlockUseCase,
  CreateSubjectUseCase,
  DeleteScheduleBlockUseCase,
  DeleteSubjectUseCase,
  DeleteTermUseCase,
  UpdateScheduleBlockUseCase,
  UpdateSubjectUseCase,
} from '../../application/use-cases/schedule/schedule-commands';

/**
 * Las acciones del horario, listas para colgar de un boton.
 *
 * Mismo reparto que en el resto de la app: el caso de uso decide y persiste, y este
 * gancho solo traduce el `Result` a un aviso en pantalla. Los avisos viven aqui y no
 * dentro del caso de uso porque un caso de uso no puede depender de que exista una
 * interfaz: los mismos comandos tienen que poder correr desde una prueba.
 */

const showError = (error: DomainError): void => {
  toast.error(error.message);
};

export interface ScheduleActions {
  /** Analiza el PDF y devuelve el resumen SIN escribir nada. */
  previewImport: (bytes: Uint8Array) => Promise<ImportScheduleSummary | null>;
  importPdf: (bytes: Uint8Array) => Promise<ImportScheduleSummary | null>;
  createSubject: (command: CreateSubjectCommand) => Promise<Subject | null>;
  updateSubject: (command: UpdateSubjectCommand) => Promise<Subject | null>;
  deleteSubject: (subjectId: SubjectId) => Promise<void>;
  createBlock: (command: CreateScheduleBlockCommand) => Promise<ScheduleBlock | null>;
  updateBlock: (command: UpdateScheduleBlockCommand) => Promise<ScheduleBlock | null>;
  deleteBlock: (blockId: ScheduleBlockId) => Promise<void>;
  deleteTerm: (termCode: string) => Promise<void>;
}

export const useScheduleActions = (): ScheduleActions => {
  const container = getContainer();

  const useCases = useMemo(
    () => ({
      importPdf: new ImportSchedulePdfUseCase(container.context),
      createSubject: new CreateSubjectUseCase(container.context),
      updateSubject: new UpdateSubjectUseCase(container.context),
      deleteSubject: new DeleteSubjectUseCase(container.context),
      createBlock: new CreateScheduleBlockUseCase(container.context),
      updateBlock: new UpdateScheduleBlockUseCase(container.context),
      deleteBlock: new DeleteScheduleBlockUseCase(container.context),
      deleteTerm: new DeleteTermUseCase(container.context),
    }),
    [container],
  );

  const previewImport = useCallback(
    async (bytes: Uint8Array) => {
      const result = await useCases.importPdf.execute({ bytes, dryRun: true });
      if (isErr(result)) {
        showError(result.error);
        return null;
      }
      return result.value;
    },
    [useCases],
  );

  const importPdf = useCallback(
    async (bytes: Uint8Array) => {
      const result = await useCases.importPdf.execute({ bytes });
      if (isErr(result)) {
        showError(result.error);
        return null;
      }

      const summary = result.value;

      /* Se cuenta lo que ha pasado en vez de decir "listo": importar borra en logico lo
         que ya no viene en el documento, y eso el usuario tiene derecho a verlo. */
      const details = [
        summary.createdSubjects > 0 ? `${String(summary.createdSubjects)} nuevas` : null,
        summary.updatedSubjects > 0 ? `${String(summary.updatedSubjects)} actualizadas` : null,
        summary.removedSubjects > 0 ? `${String(summary.removedSubjects)} dadas de baja` : null,
      ].filter((item): item is string => item !== null);

      toast.success(`Horario de ${summary.termCode} listo`, {
        description: details.length > 0 ? details.join(' · ') : 'Sin cambios',
      });

      for (const warning of summary.warnings) {
        toast.warning(warning);
      }

      return summary;
    },
    [useCases],
  );

  const createSubject = useCallback(
    async (command: CreateSubjectCommand) => {
      const result = await useCases.createSubject.execute(command);
      if (isErr(result)) {
        showError(result.error);
        return null;
      }
      return result.value;
    },
    [useCases],
  );

  const updateSubject = useCallback(
    async (command: UpdateSubjectCommand) => {
      const result = await useCases.updateSubject.execute(command);
      if (isErr(result)) {
        showError(result.error);
        return null;
      }
      return result.value;
    },
    [useCases],
  );

  const deleteSubject = useCallback(
    async (subjectId: SubjectId) => {
      const result = await useCases.deleteSubject.execute({ subjectId });
      if (isErr(result)) showError(result.error);
      else toast('Asignatura quitada del horario');
    },
    [useCases],
  );

  const createBlock = useCallback(
    async (command: CreateScheduleBlockCommand) => {
      const result = await useCases.createBlock.execute(command);
      if (isErr(result)) {
        showError(result.error);
        return null;
      }
      return result.value;
    },
    [useCases],
  );

  const updateBlock = useCallback(
    async (command: UpdateScheduleBlockCommand) => {
      const result = await useCases.updateBlock.execute(command);
      if (isErr(result)) {
        showError(result.error);
        return null;
      }
      return result.value;
    },
    [useCases],
  );

  const deleteBlock = useCallback(
    async (blockId: ScheduleBlockId) => {
      const result = await useCases.deleteBlock.execute({ blockId });
      if (isErr(result)) showError(result.error);
      else toast('Clase quitada');
    },
    [useCases],
  );

  const deleteTerm = useCallback(
    async (termCode: string) => {
      const result = await useCases.deleteTerm.execute({ termCode });
      if (isErr(result)) showError(result.error);
      else toast(`Cuatrimestre ${termCode} borrado`);
    },
    [useCases],
  );

  return {
    previewImport,
    importPdf,
    createSubject,
    updateSubject,
    deleteSubject,
    createBlock,
    updateBlock,
    deleteBlock,
    deleteTerm,
  };
};
