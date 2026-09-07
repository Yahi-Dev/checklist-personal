import { beforeEach, describe, expect, it } from 'vitest';

import type { ScheduleBlock } from '../../src/domain/schedule/schedule-block';
import type { Subject } from '../../src/domain/schedule/subject';
import type { TestHarness } from '../support/test-context';
import type { Weekday } from '../../src/domain/recurrence/recurrence-rule';

import { createTestHarness } from '../support/test-context';
import { isErr, unwrap } from '../../src/domain/shared/result';
import { MAX_BLOCKS_PER_SUBJECT } from '../../src/domain/schedule/schedule-block';
import {
  CreateScheduleBlockUseCase,
  CreateSubjectUseCase,
  DeleteScheduleBlockUseCase,
  DeleteSubjectUseCase,
  DeleteTermUseCase,
  UpdateScheduleBlockUseCase,
  UpdateSubjectUseCase,
} from '../../src/application/use-cases/schedule/schedule-commands';

/**
 * Los retoques a mano sobre el horario importado.
 *
 * Lo que se prueba aqui es sobre todo lo que NO se deja hacer: solapar dos clases,
 * repetir una asignatura y seccion, o dejar tramos vivos de una asignatura borrada. Son
 * las tres formas en que un horario editado a mano deja de cuadrar, y ninguna produce un
 * error visible por si sola.
 */

describe('comandos del horario', () => {
  let harness: TestHarness;

  const crearAsignatura = (overrides: Record<string, unknown> = {}) =>
    new CreateSubjectUseCase(harness.context).execute({
      code: 'TI3210',
      name: 'Logica Matematica',
      termCode: '2027-1',
      section: '01',
      ...overrides,
    });

  const crearClase = (subject: Subject, overrides: Record<string, unknown> = {}) =>
    new CreateScheduleBlockUseCase(harness.context).execute({
      subjectId: subject.id,
      weekday: 1,
      startsAt: '20:00',
      endsAt: '22:00',
      locationLabel: 'FR1-411',
      ...overrides,
    });

  beforeEach(() => {
    harness = createTestHarness();
  });

  describe('CreateSubjectUseCase', () => {
    it('crea la asignatura con el color derivado de su codigo', async () => {
      const subject = unwrap(await crearAsignatura());

      expect(subject.code).toBe('TI3210');
      expect(subject.color).toMatch(/^#[0-9a-f]{6}$/u);
      expect(harness.subjects.items.size).toBe(1);
    });

    it('exige sesion', async () => {
      const sinSesion = createTestHarness(new Date('2026-08-02T12:00:00.000Z'), null);

      const result = await new CreateSubjectUseCase(sinSesion.context).execute({
        code: 'TI3210',
        name: 'Logica',
        termCode: '2027-1',
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.code).toBe('UNAUTHENTICATED');
    });

    it('rechaza repetir codigo y seccion en el mismo cuatrimestre', async () => {
      await crearAsignatura();
      const result = await crearAsignatura();

      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.code).toBe('CONFLICT');
    });

    it('deja convivir dos secciones de la misma asignatura', async () => {
      // Es el caso de Fisica General II: la teoria y su laboratorio.
      await crearAsignatura({ code: 'EGC270', section: '01' });
      const laboratorio = await crearAsignatura({ code: 'EGC270', section: '01-01' });

      expect(isErr(laboratorio)).toBe(false);
      expect(harness.subjects.items.size).toBe(2);
    });

    it('deja repetir la misma asignatura en otro cuatrimestre', async () => {
      await crearAsignatura();
      const otra = await crearAsignatura({ termCode: '2027-2' });

      expect(isErr(otra)).toBe(false);
    });
  });

  describe('UpdateSubjectUseCase', () => {
    it('cambia el color sin tocar lo demas', async () => {
      const subject = unwrap(await crearAsignatura());

      const updated = unwrap(
        await new UpdateSubjectUseCase(harness.context).execute({
          subjectId: subject.id,
          color: '#22c55e',
        }),
      );

      expect(updated.color).toBe('#22c55e');
      expect(updated.name).toBe(subject.name);
      expect(updated.termCode).toBe(subject.termCode);
    });

    it('falla si la asignatura no existe', async () => {
      const result = await new UpdateSubjectUseCase(harness.context).execute({
        subjectId: '00000000-0000-4000-8000-999999999999' as never,
        color: '#22c55e',
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  describe('CreateScheduleBlockUseCase', () => {
    it('añade la clase a una asignatura existente', async () => {
      const subject = unwrap(await crearAsignatura());
      const block = unwrap(await crearClase(subject));

      expect(block.subjectId).toBe(subject.id);
      expect(block.isRemote).toBe(false);
      expect(harness.scheduleBlocks.items.size).toBe(1);
    });

    it('rechaza chocar con otra clase del mismo cuatrimestre', async () => {
      // El conflicto que le importa al usuario es "no puedo estar en dos sitios a la
      // vez", y ese cruza asignaturas: por eso se busca en todo el cuatrimestre y no
      // solo dentro de la misma materia.
      const logica = unwrap(await crearAsignatura({ code: 'TI3210' }));
      const calculo = unwrap(await crearAsignatura({ code: 'EGC252' }));

      await crearClase(logica, { weekday: 2, startsAt: '18:00', endsAt: '20:00' });
      const result = await crearClase(calculo, {
        weekday: 2,
        startsAt: '19:00',
        endsAt: '21:00',
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.code).toBe('CONFLICT');
    });

    it('deja encadenar dos clases que se tocan en el extremo', async () => {
      const logica = unwrap(await crearAsignatura({ code: 'TI3210' }));
      const calculo = unwrap(await crearAsignatura({ code: 'EGC252' }));

      await crearClase(logica, { weekday: 2, startsAt: '18:00', endsAt: '20:00' });
      const result = await crearClase(calculo, {
        weekday: 2,
        startsAt: '20:00',
        endsAt: '22:00',
      });

      expect(isErr(result)).toBe(false);
    });

    it('no choca con una clase de otro cuatrimestre', async () => {
      const actual = unwrap(await crearAsignatura({ code: 'TI3210' }));
      const vieja = unwrap(await crearAsignatura({ code: 'TI3110', termCode: '2026-2' }));

      await crearClase(vieja, { weekday: 3, startsAt: '18:00', endsAt: '20:00' });
      const result = await crearClase(actual, {
        weekday: 3,
        startsAt: '18:00',
        endsAt: '20:00',
      });

      expect(isErr(result)).toBe(false);
    });

    it('rechaza una hora de fin anterior a la de inicio', async () => {
      const subject = unwrap(await crearAsignatura());
      const result = await crearClase(subject, { startsAt: '20:00', endsAt: '18:00' });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.code).toBe('VALIDATION');
    });

    it('pone tope al numero de clases de una asignatura', async () => {
      const subject = unwrap(await crearAsignatura());

      // Todas en dias distintos para que el tope salte antes que el solape.
      for (let index = 0; index < MAX_BLOCKS_PER_SUBJECT; index += 1) {
        const hora = String(6 + index).padStart(2, '0');
        await crearClase(subject, {
          weekday: (index % 6) as Weekday,
          startsAt: `${hora}:00`,
          endsAt: `${hora}:30`,
        });
      }

      const result = await crearClase(subject, { weekday: 6, startsAt: '23:00', endsAt: '23:30' });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.code).toBe('INVARIANT');
    });

    it('falla si la asignatura no existe', async () => {
      const result = await new CreateScheduleBlockUseCase(harness.context).execute({
        subjectId: '00000000-0000-4000-8000-999999999999' as never,
        weekday: 1,
        startsAt: '20:00',
        endsAt: '22:00',
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  describe('UpdateScheduleBlockUseCase', () => {
    it('mueve la clase de aula', async () => {
      const subject = unwrap(await crearAsignatura());
      const block = unwrap(await crearClase(subject));

      const updated = unwrap(
        await new UpdateScheduleBlockUseCase(harness.context).execute({
          blockId: block.id,
          locationLabel: 'FR1-305',
        }),
      );

      expect(updated.locationLabel).toBe('FR1-305');
      expect(updated.id).toBe(block.id);
    });

    it('no la hace chocar consigo misma', async () => {
      // Sin excluir el propio id, cualquier edicion de una clase fallaria siempre con
      // "ya tienes otra clase a esa hora", señalandose a si misma.
      const subject = unwrap(await crearAsignatura());
      const block = unwrap(await crearClase(subject));

      const result = await new UpdateScheduleBlockUseCase(harness.context).execute({
        blockId: block.id,
        locationLabel: 'FR1-305',
      });

      expect(isErr(result)).toBe(false);
    });

    it('rechaza moverla encima de otra', async () => {
      const subject = unwrap(await crearAsignatura());
      const primera = unwrap(
        await crearClase(subject, { weekday: 2, startsAt: '18:00', endsAt: '20:00' }),
      );
      await crearClase(subject, { weekday: 2, startsAt: '20:00', endsAt: '22:00' });

      const result = await new UpdateScheduleBlockUseCase(harness.context).execute({
        blockId: primera.id,
        endsAt: '21:00',
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.code).toBe('CONFLICT');
    });
  });

  describe('borrado', () => {
    it('quitar una clase la borra en logico', async () => {
      // Nunca en fisico: el borrado tiene que viajar al otro dispositivo.
      const subject = unwrap(await crearAsignatura());
      const block = unwrap(await crearClase(subject));

      unwrap(await new DeleteScheduleBlockUseCase(harness.context).execute({ blockId: block.id }));

      const stored = harness.scheduleBlocks.items.get(block.id);
      expect(stored?.deletedAt).not.toBeNull();
    });

    it('quitar la asignatura se lleva tambien sus clases', async () => {
      // Dejarlas vivas no se notaria en pantalla, pero seguirian ocupando sitio,
      // viajando por la sincronizacion y reapareciendo si la asignatura se restaura.
      const subject = unwrap(await crearAsignatura());
      await crearClase(subject, { weekday: 1, startsAt: '20:00', endsAt: '22:00' });
      await crearClase(subject, { weekday: 3, startsAt: '20:00', endsAt: '22:00' });

      unwrap(await new DeleteSubjectUseCase(harness.context).execute({ subjectId: subject.id }));

      expect(harness.subjects.items.get(subject.id)?.deletedAt).not.toBeNull();

      const vivas = [...harness.scheduleBlocks.items.values()].filter(
        (block: ScheduleBlock) => block.deletedAt === null,
      );
      expect(vivas).toHaveLength(0);
    });

    it('borrar un cuatrimestre no toca los demas', async () => {
      const actual = unwrap(await crearAsignatura({ code: 'TI3210' }));
      const vieja = unwrap(await crearAsignatura({ code: 'TI3110', termCode: '2026-2' }));
      await crearClase(actual);

      const borradas = unwrap(
        await new DeleteTermUseCase(harness.context).execute({ termCode: '2027-1' }),
      );

      expect(borradas).toBe(1);
      expect(harness.subjects.items.get(actual.id)?.deletedAt).not.toBeNull();
      expect(harness.subjects.items.get(vieja.id)?.deletedAt).toBeNull();
    });
  });
});
