import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ScheduleBlock } from '../../src/domain/schedule/schedule-block';
import type { ScheduleBlockId, SubjectId, UserId } from '../../src/domain/shared/branded';
import type { Subject } from '../../src/domain/schedule/subject';
import type { Weekday } from '../../src/domain/recurrence/recurrence-rule';

import { AppDatabase } from '../../src/infrastructure/persistence/database';
import { brandId } from '../../src/domain/shared/branded';
import { createScheduleBlock } from '../../src/domain/schedule/schedule-block';
import { createSubject } from '../../src/domain/schedule/subject';
import {
  DexieScheduleBlockRepository,
  DexieSubjectRepository,
} from '../../src/infrastructure/persistence/dexie-schedule-repositories';
import { Outbox } from '../../src/infrastructure/persistence/outbox';
import { unwrap } from '../../src/domain/shared/result';

/**
 * Los repositorios del horario contra IndexedDB DE VERDAD (via fake-indexeddb).
 *
 * Aqui no se falsea Dexie a proposito, porque lo unico que puede fallar de estas clases
 * es exactamente lo que un doble en memoria no reproduce: que un indice compuesto este
 * mal declarado -y devuelva vacio sin error-, que el filtro de borrados no filtre, y que
 * la escritura y el encolado no compartan transaccion.
 */

const USER_ID = brandId<UserId>('00000000-0000-4000-8000-000000000001');
const NOW = '2026-08-02T12:00:00.000Z';

let counter = 0;
const nextSubjectId = () =>
  brandId<SubjectId>(`00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`);
const nextBlockId = () =>
  brandId<ScheduleBlockId>(`00000000-0000-4000-9000-${String(++counter).padStart(12, '0')}`);

const makeSubject = (overrides: Partial<Parameters<typeof createSubject>[0]> = {}): Subject =>
  unwrap(
    createSubject({
      id: nextSubjectId(),
      userId: USER_ID,
      code: 'TI3210',
      name: 'Logica Matematica',
      termCode: '2027-1',
      now: NOW,
      section: '01',
      ...overrides,
    }),
  );

const makeBlock = (
  subjectId: SubjectId,
  overrides: Partial<Parameters<typeof createScheduleBlock>[0]> = {},
): ScheduleBlock =>
  unwrap(
    createScheduleBlock({
      id: nextBlockId(),
      userId: USER_ID,
      subjectId,
      weekday: 1,
      startsAt: '20:00',
      endsAt: '22:00',
      now: NOW,
      locationLabel: 'FR1-411',
      ...overrides,
    }),
  );

describe('repositorios del horario', () => {
  let database: AppDatabase;
  let outbox: Outbox;
  let subjects: DexieSubjectRepository;
  let blocks: DexieScheduleBlockRepository;

  beforeEach(async () => {
    // Base con nombre unico por prueba: evita que el estado se filtre entre casos.
    database = new AppDatabase(`test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`);
    await database.open();

    outbox = new Outbox(database);
    subjects = new DexieSubjectRepository(database, outbox);
    blocks = new DexieScheduleBlockRepository(database, outbox);
  });

  afterEach(async () => {
    await database.delete();
  });

  describe('DexieSubjectRepository', () => {
    it('guarda y recupera sin perder ningun campo', async () => {
      const subject = makeSubject({
        credits: 3,
        teacherName: 'LEDESMA UREÑA, JORGE LUIS',
        teacherCode: '775837',
        startsOn: '2026-09-07',
        endsOn: '2026-12-19',
      });

      await subjects.save(subject);
      const found = unwrap(await subjects.findById(subject.id));

      expect(found).toEqual(subject);
      // Los campos auxiliares de indexado no deben llegar al dominio.
      expect(found).not.toHaveProperty('_deleted');
      expect(found).not.toHaveProperty('_dirty');
    });

    it('encola la escritura en la misma operacion que la guarda', async () => {
      await subjects.save(makeSubject());

      expect(await outbox.count()).toBe(1);
      const pending = await outbox.pending();
      expect(pending[0]?.entity).toBe('subject');
    });

    it('colapsa las escrituras repetidas de la misma asignatura', async () => {
      // Retocar el color seis veces sin conexion tiene que producir UNA subida, no seis.
      const subject = makeSubject();

      await subjects.save(subject);
      await subjects.save({ ...subject, color: '#22c55e', updatedAt: '2026-08-02T12:01:00.000Z' });
      await subjects.save({ ...subject, color: '#ef4444', updatedAt: '2026-08-02T12:02:00.000Z' });

      expect(await outbox.count()).toBe(1);
      const pending = await outbox.pending();
      expect((pending[0]?.payload as Subject).color).toBe('#ef4444');
    });

    it('filtra por cuatrimestre con el indice compuesto', async () => {
      // Es lo que prueba de verdad `[_deleted+termCode]`: con el indice mal declarado
      // esto devuelve vacio, y contra un doble en memoria pasaria igual.
      await subjects.saveMany([
        makeSubject({ code: 'TI3210', termCode: '2027-1' }),
        makeSubject({ code: 'EGC252', termCode: '2027-1' }),
        makeSubject({ code: 'TI3110', termCode: '2026-2' }),
      ]);

      const actual = unwrap(await subjects.findAll({ termCode: '2027-1' }));

      expect(actual.map((item) => item.code).sort()).toEqual(['EGC252', 'TI3210']);
    });

    it('no devuelve las borradas salvo que se pidan', async () => {
      const viva = makeSubject({ code: 'TI3210' });
      const baja = makeSubject({ code: 'EGC252' });

      await subjects.saveMany([viva, { ...baja, deletedAt: NOW }]);

      expect(unwrap(await subjects.findAll())).toHaveLength(1);
      expect(unwrap(await subjects.findAll({ includeDeleted: true }))).toHaveLength(2);
      expect(unwrap(await subjects.findAll({ termCode: '2027-1' }))).toHaveLength(1);
      expect(
        unwrap(await subjects.findAll({ termCode: '2027-1', includeDeleted: true })),
      ).toHaveLength(2);
    });

    it('saveMany con lista vacia no encola nada', async () => {
      await subjects.saveMany([]);

      expect(await outbox.count()).toBe(0);
    });
  });

  describe('DexieScheduleBlockRepository', () => {
    it('devuelve los tramos de un dia en orden de comienzo', async () => {
      const subject = makeSubject();
      await subjects.save(subject);

      await blocks.saveMany([
        makeBlock(subject.id, { weekday: 1, startsAt: '20:00', endsAt: '22:00' }),
        makeBlock(subject.id, { weekday: 1, startsAt: '12:00', endsAt: '14:00' }),
        makeBlock(subject.id, { weekday: 4, startsAt: '19:00', endsAt: '22:00' }),
      ]);

      const lunes = unwrap(await blocks.findAll({ weekday: 1 }));

      expect(lunes.map((block) => block.startsAt)).toEqual(['12:00', '20:00']);
    });

    it('filtra por asignatura con su indice', async () => {
      const logica = makeSubject({ code: 'TI3210' });
      const calculo = makeSubject({ code: 'EGC252' });
      await subjects.saveMany([logica, calculo]);

      await blocks.saveMany([
        makeBlock(logica.id, { weekday: 1 }),
        makeBlock(logica.id, { weekday: 3 as Weekday }),
        makeBlock(calculo.id, { weekday: 2 as Weekday }),
      ]);

      expect(unwrap(await blocks.findAll({ subjectId: logica.id }))).toHaveLength(2);
      expect(unwrap(await blocks.findAll({ subjectId: calculo.id }))).toHaveLength(1);
    });

    it('excluye los borrados de las dos consultas indexadas', async () => {
      const subject = makeSubject();
      await subjects.save(subject);

      const viva = makeBlock(subject.id, { weekday: 1, startsAt: '20:00' });
      const baja = makeBlock(subject.id, { weekday: 1, startsAt: '12:00' });

      await blocks.saveMany([viva, { ...baja, deletedAt: NOW }]);

      expect(unwrap(await blocks.findAll({ weekday: 1 }))).toHaveLength(1);
      expect(unwrap(await blocks.findAll({ subjectId: subject.id }))).toHaveLength(1);
      expect(
        unwrap(await blocks.findAll({ subjectId: subject.id, includeDeleted: true })),
      ).toHaveLength(2);
    });

    it('encola cada tramo por separado', async () => {
      // Uno por fila y no uno por lote: en el servidor cada tramo es su propia fila, y
      // agruparlos haria que un rechazo se llevara por delante a sus compañeros.
      const subject = makeSubject();
      await subjects.save(subject);

      await blocks.saveMany([
        makeBlock(subject.id, { weekday: 1, startsAt: '20:00' }),
        makeBlock(subject.id, { weekday: 3 as Weekday, startsAt: '20:00' }),
      ]);

      const pending = await outbox.pending();
      const delHorario = pending.filter((entry) => entry.entity === 'scheduleBlock');

      expect(delHorario).toHaveLength(2);
    });
  });

  describe('wipe', () => {
    it('vacia tambien las dos tablas del horario', async () => {
      // Es el olvido que el compilador no caza: sin las tablas nuevas en `wipe()`, al
      // cerrar sesion el horario del usuario anterior sobrevive en el dispositivo y RLS
      // lo rechaza para siempre con la cuenta nueva.
      const subject = makeSubject();
      await subjects.save(subject);
      await blocks.save(makeBlock(subject.id));

      await database.wipe();

      expect(await database.subjects.count()).toBe(0);
      expect(await database.scheduleBlocks.count()).toBe(0);
      expect(await database.outbox.count()).toBe(0);
    });
  });
});
