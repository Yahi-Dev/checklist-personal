import { describe, expect, it } from 'vitest';

import type { ScheduleBlock } from '../../src/domain/schedule/schedule-block';
import type { ScheduleBlockId, SubjectId, UserId } from '../../src/domain/shared/branded';
import type { Subject } from '../../src/domain/schedule/subject';
import type { Weekday } from '../../src/domain/recurrence/recurrence-rule';

import { brandId } from '../../src/domain/shared/branded';
import {
  activeTermCode,
  buildWeeklySchedule,
  currentClassAt,
  nextClassAt,
  termCodesOf,
} from '../../src/domain/schedule/weekly-schedule';
import {
  blocksOverlap,
  createScheduleBlock,
  describeRoom,
  findOverlap,
  scheduleBlockNaturalKey,
  softDeleteScheduleBlock,
  updateScheduleBlock,
} from '../../src/domain/schedule/schedule-block';
import {
  colorForSubjectCode,
  createSubject,
  isTermActive,
  softDeleteSubject,
  subjectKeyFor,
  subjectNaturalKey,
  updateSubject,
} from '../../src/domain/schedule/subject';
import { isErr, unwrap } from '../../src/domain/shared/result';
import {
  isValidTimeOfDay,
  minutesToTime,
  parseTimeOfDay,
  timeToMinutes,
} from '../../src/domain/schedule/value-objects/time-of-day';

/**
 * El dominio del horario.
 *
 * El ancla temporal del proyecto es el domingo 2 de agosto de 2026, elegido en su dia
 * porque un domingo hace evidente cualquier error de indice al contar dias de la semana.
 * Aqui viene de perlas: `Weekday` usa 0 para el domingo y el horario se lee empezando
 * por el lunes, que son dos convenciones distintas conviviendo.
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
  subject: Subject,
  overrides: Partial<Parameters<typeof createScheduleBlock>[0]> = {},
): ScheduleBlock =>
  unwrap(
    createScheduleBlock({
      id: nextBlockId(),
      userId: USER_ID,
      subjectId: subject.id,
      weekday: 1,
      startsAt: '20:00',
      endsAt: '22:00',
      now: NOW,
      locationLabel: 'FR1-411',
      ...overrides,
    }),
  );

describe('hora del dia', () => {
  it('acepta las horas validas y rechaza las imposibles', () => {
    expect(isValidTimeOfDay('07:00')).toBe(true);
    expect(isValidTimeOfDay('23:59')).toBe(true);
    expect(isValidTimeOfDay('24:00')).toBe(false);
    expect(isValidTimeOfDay('7:05')).toBe(false);
    expect(isValidTimeOfDay('20:60')).toBe(false);
  });

  it('ordena lexicograficamente igual que cronologicamente', () => {
    // Es la premisa de la que dependen el indice de Dexie, el `order by` de Postgres y
    // todos los `.sort()` de la pantalla. Sin el cero a la izquierda, "9:00" iria
    // despues de "10:00" y el horario saldria desordenado sin que nada fallara.
    const horas = ['20:00', '08:00', '14:30', '09:15'];

    expect([...horas].sort()).toEqual(['08:00', '09:15', '14:30', '20:00']);
  });

  it('convierte a minutos y vuelve sin perder nada', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('20:30')).toBe(1230);
    expect(minutesToTime(1230)).toBe('20:30');
    // Pasarse del dia envuelve en vez de producir un "24:30" imposible.
    expect(minutesToTime(1470)).toBe('00:30');
  });

  it('devuelve un error de validacion con el campo señalado', () => {
    const result = parseTimeOfDay('mediodia', 'endsAt');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('VALIDATION');
      expect(result.error.field).toBe('endsAt');
    }
  });
});

describe('crear una asignatura', () => {
  it('normaliza el codigo a mayusculas y colapsa los espacios del nombre', () => {
    const subject = makeSubject({ code: ' ti3210 ', name: 'Logica   Matematica ' });

    expect(subject.code).toBe('TI3210');
    expect(subject.name).toBe('Logica Matematica');
  });

  it('rechaza un color que no sea hexadecimal', () => {
    const result = createSubject({
      id: nextSubjectId(),
      userId: USER_ID,
      code: 'TI3210',
      name: 'Logica',
      termCode: '2027-1',
      now: NOW,
      color: 'azul',
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.field).toBe('color');
  });

  it('acepta cero creditos y rechaza los negativos', () => {
    // Ingles I figura con 0 creditos en un horario real: no es "sin dato".
    expect(makeSubject({ credits: 0 }).credits).toBe(0);

    const result = createSubject({
      id: nextSubjectId(),
      userId: USER_ID,
      code: 'X100',
      name: 'X',
      termCode: '2027-1',
      now: NOW,
      credits: -1,
    });

    expect(isErr(result)).toBe(true);
  });

  it('rechaza un cuatrimestre que termina antes de empezar', () => {
    const result = createSubject({
      id: nextSubjectId(),
      userId: USER_ID,
      code: 'X100',
      name: 'X',
      termCode: '2027-1',
      now: NOW,
      startsOn: '2026-12-19',
      endsOn: '2026-09-07',
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.field).toBe('endsOn');
  });

  it('da el mismo color al mismo codigo, siempre', () => {
    // De aqui depende que reimportar no cambie los colores y que el telefono y la
    // computadora enseñen la misma asignatura del mismo color sin sincronizar nada.
    expect(colorForSubjectCode('TI3210')).toBe(colorForSubjectCode('ti3210'));
    expect(colorForSubjectCode('TI3210')).not.toBe(colorForSubjectCode('EGC252'));
  });

  it('distingue dos secciones de la misma asignatura por su clave natural', () => {
    const teoria = makeSubject({ code: 'EGC270', section: '01' });
    const laboratorio = makeSubject({ code: 'EGC270', section: '01-01' });

    expect(subjectNaturalKey(teoria)).not.toBe(subjectNaturalKey(laboratorio));
    expect(subjectNaturalKey(teoria)).toBe('2027-1|EGC270|01');
  });

  it('normaliza las tres partes de la clave natural', () => {
    // Quien importa compara la clave de lo que trae el PDF -texto crudo- contra la de lo
    // ya guardado, que paso por la fabrica. Si las dos no normalizan igual, la misma
    // asignatura sale con dos claves distintas y el segundo import la duplica sin dar
    // ningun error.
    const subject = makeSubject({ code: ' ti3210 ', section: ' 01 ', termCode: '2027-1' });

    expect(subjectKeyFor(' 2027-1 ', ' ti3210 ', ' 01 ')).toBe(subjectNaturalKey(subject));
    expect(subjectNaturalKey(subject)).toBe('2027-1|TI3210|01');
  });

  it('conserva la fecha de creacion al editar', () => {
    const subject = makeSubject();
    const updated = unwrap(
      updateSubject(subject, { color: '#22c55e' }, '2026-09-01T10:00:00.000Z'),
    );

    expect(updated.createdAt).toBe(NOW);
    expect(updated.updatedAt).toBe('2026-09-01T10:00:00.000Z');
    expect(updated.color).toBe('#22c55e');
  });

  it('softDeleteSubject devuelve la entidad, no un Result', () => {
    // No puede fallar, asi que envolverla en `Result` obligaria a desenvolverla en cada
    // llamada sin que hubiera nunca un error que tratar.
    const deleted = softDeleteSubject(makeSubject(), NOW);

    expect(deleted.deletedAt).toBe(NOW);
  });
});

describe('vigencia del cuatrimestre', () => {
  const subject = makeSubject({ startsOn: '2026-09-07', endsOn: '2026-12-19' });

  it('esta vigente dentro del rango, incluidos los extremos', () => {
    expect(isTermActive(subject, '2026-09-07')).toBe(true);
    expect(isTermActive(subject, '2026-11-01')).toBe(true);
    expect(isTermActive(subject, '2026-12-19')).toBe(true);
  });

  it('no lo esta fuera', () => {
    expect(isTermActive(subject, '2026-09-06')).toBe(false);
    expect(isTermActive(subject, '2026-12-20')).toBe(false);
  });

  it('se asume vigente cuando no hay fechas', () => {
    // Una asignatura sin horario impreso no trae rango. Ocultarla dejaria matriculas
    // invisibles.
    expect(isTermActive(makeSubject(), '2030-01-01')).toBe(true);
  });
});

describe('crear un tramo de clase', () => {
  it('rechaza que la hora de fin sea anterior o igual a la de inicio', () => {
    const subject = makeSubject();

    for (const endsAt of ['19:00', '20:00']) {
      const result = createScheduleBlock({
        id: nextBlockId(),
        userId: USER_ID,
        subjectId: subject.id,
        weekday: 1,
        startsAt: '20:00',
        endsAt,
        now: NOW,
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.code).toBe('VALIDATION');
    }
  });

  it('deduce que es remota por la etiqueta del aula', () => {
    const subject = makeSubject();

    expect(makeBlock(subject, { locationLabel: 'VIRTUAL [ASINCRONICA 100%]' }).isRemote).toBe(true);
    expect(makeBlock(subject, { locationLabel: 'FR1-305' }).isRemote).toBe(false);
  });

  it('deja de ser remota al mudarla a un aula fisica', () => {
    // El fallo que evita: cambiar el aula de "VIRTUAL" a "FR1-305" y que la clase
    // siguiera enseñando el icono del globo terraqueo para siempre.
    const subject = makeSubject();
    const remota = makeBlock(subject, { locationLabel: 'VIRTUAL' });

    const mudada = unwrap(updateScheduleBlock(remota, { locationLabel: 'FR1-305' }, NOW));

    expect(mudada.isRemote).toBe(false);
  });
});

describe('solapes', () => {
  const subject = makeSubject();

  it('dos clases del mismo dia que se pisan chocan', () => {
    const a = makeBlock(subject, { weekday: 2, startsAt: '18:00', endsAt: '20:00' });
    const b = makeBlock(subject, { weekday: 2, startsAt: '19:00', endsAt: '21:00' });

    expect(blocksOverlap(a, b)).toBe(true);
  });

  it('tocarse en el extremo no es pisarse', () => {
    // Salir a las 20:00 y entrar a las 20:00 es lo normal en una tarde de clases.
    const a = makeBlock(subject, { weekday: 2, startsAt: '18:00', endsAt: '20:00' });
    const b = makeBlock(subject, { weekday: 2, startsAt: '20:00', endsAt: '22:00' });

    expect(blocksOverlap(a, b)).toBe(false);
  });

  it('la misma hora en dias distintos no choca', () => {
    // El error de indice clasico: comparar solo las horas y olvidarse del dia.
    const a = makeBlock(subject, { weekday: 1, startsAt: '20:00', endsAt: '22:00' });
    const b = makeBlock(subject, { weekday: 3, startsAt: '20:00', endsAt: '22:00' });

    expect(blocksOverlap(a, b)).toBe(false);
  });

  it('un tramo no choca consigo mismo al editarlo', () => {
    // Sin excluir por id, cambiar el aula de una clase la haria chocar con su propia
    // version guardada y el guardado fallaria siempre.
    const block = makeBlock(subject, { weekday: 4, startsAt: '18:00', endsAt: '20:00' });
    const editado = unwrap(updateScheduleBlock(block, { locationLabel: 'FR1-999' }, NOW));

    expect(findOverlap([block], editado)).toBeNull();
  });

  it('ignora los tramos borrados', () => {
    const viejo = softDeleteScheduleBlock(
      makeBlock(subject, { weekday: 5, startsAt: '18:00', endsAt: '20:00' }),
      NOW,
    );
    const nuevo = makeBlock(subject, { weekday: 5, startsAt: '18:00', endsAt: '20:00' });

    expect(findOverlap([viejo], nuevo)).toBeNull();
  });
});

describe('aula', () => {
  it('trocea el formato de la universidad', () => {
    expect(describeRoom('FR1-305')).toEqual({ building: 'FR1', room: '305', note: null });
    expect(describeRoom('FR2-L06 [LAB. FÍSICA]')).toEqual({
      building: 'FR2',
      room: 'L06',
      note: 'LAB. FÍSICA',
    });
    expect(describeRoom('ING-005 [AULA]')).toEqual({
      building: 'ING',
      room: '005',
      note: 'AULA',
    });
  });

  it('no adivina cuando no encaja', () => {
    // Preferimos enseñar el texto crudo a inventar un edificio que no existe.
    expect(describeRoom('VIRTUAL [ASINCRONICA 100%]')).toEqual({
      building: null,
      room: null,
      note: null,
    });
  });
});

describe('la semana', () => {
  const logica = makeSubject({ code: 'TI3210', name: 'Logica Matematica' });
  const calculo = makeSubject({ code: 'EGC252', name: 'Calculo Vectorial' });

  const blocks = [
    makeBlock(logica, { weekday: 1, startsAt: '20:00', endsAt: '22:00' }),
    makeBlock(calculo, { weekday: 1, startsAt: '12:00', endsAt: '14:00' }),
    makeBlock(calculo, { weekday: 4, startsAt: '19:00', endsAt: '22:00' }),
  ];

  it('agrupa por dia y ordena por hora de entrada', () => {
    const days = buildWeeklySchedule([logica, calculo], blocks);

    expect(days.map((day) => day.weekday)).toEqual([1, 4]);
    expect(days[0]?.classes.map((item) => item.block.startsAt)).toEqual(['12:00', '20:00']);
  });

  it('calcula el hueco entre dos clases seguidas', () => {
    const days = buildWeeklySchedule([logica, calculo], blocks);

    // De las 14:00 a las 20:00 son seis horas muertas.
    expect(days[0]?.classes[0]?.gapAfterMinutes).toBe(360);
    // La ultima del dia no tiene hueco detras: el dia siguiente es otra tarjeta.
    expect(days[0]?.classes[1]?.gapAfterMinutes).toBeNull();
  });

  it('no inventa hueco entre clases pegadas', () => {
    const pegadas = [
      makeBlock(logica, { weekday: 2, startsAt: '18:00', endsAt: '20:00' }),
      makeBlock(calculo, { weekday: 2, startsAt: '20:00', endsAt: '22:00' }),
    ];

    const days = buildWeeklySchedule([logica, calculo], pegadas);

    expect(days[0]?.classes[0]?.gapAfterMinutes).toBeNull();
  });

  it('devuelve solo los dias con clase, empezando por el lunes', () => {
    const domingo = makeBlock(logica, { weekday: 0, startsAt: '09:00', endsAt: '11:00' });
    const days = buildWeeklySchedule([logica, calculo], [...blocks, domingo]);

    // El domingo existe pero va al final: `Weekday` empieza en el, la semana no.
    expect(days.map((day) => day.weekday)).toEqual([1, 4, 0]);
  });

  it('descarta los tramos cuya asignatura no esta', () => {
    // Pasa de verdad entre dispositivos: el borrado de la asignatura y el de sus tramos
    // no llegan a la vez, y durante unos segundos hay tramos huerfanos.
    const days = buildWeeklySchedule([logica], blocks);

    expect(days).toHaveLength(1);
    expect(days[0]?.classes).toHaveLength(1);
  });

  it('filtra por cuatrimestre', () => {
    const anterior = makeSubject({ code: 'TI3110', termCode: '2026-2' });
    const suyo = makeBlock(anterior, { weekday: 3, startsAt: '17:00', endsAt: '20:00' });

    const days = buildWeeklySchedule([logica, calculo, anterior], [...blocks, suyo], {
      termCode: '2027-1',
    });

    expect(days.map((day) => day.weekday)).toEqual([1, 4]);
  });

  it('señala la clase en curso y la siguiente', () => {
    const days = buildWeeklySchedule([logica, calculo], blocks);
    const lunes = days[0];
    if (lunes === undefined) throw new Error('falta el lunes');

    // 12:30 -> dentro de la primera; la siguiente es la de las 20:00.
    expect(currentClassAt(lunes, 12 * 60 + 30)?.subject.code).toBe('EGC252');
    expect(nextClassAt(lunes, 12 * 60 + 30)?.subject.code).toBe('TI3210');

    // 16:00 -> ninguna en curso, pero aun queda una.
    expect(currentClassAt(lunes, 16 * 60)).toBeNull();
    expect(nextClassAt(lunes, 16 * 60)?.subject.code).toBe('TI3210');

    // 23:00 -> se acabo el dia.
    expect(nextClassAt(lunes, 23 * 60)).toBeNull();
  });
});

describe('cuatrimestre activo', () => {
  const actual = makeSubject({ termCode: '2027-1', startsOn: '2026-09-07', endsOn: '2026-12-19' });
  const anterior = makeSubject({
    termCode: '2026-3',
    startsOn: '2026-05-05',
    endsOn: '2026-08-15',
  });

  it('lista los cuatrimestres del mas nuevo al mas viejo', () => {
    expect(termCodesOf([anterior, actual])).toEqual(['2027-1', '2026-3']);
  });

  it('elige el que contiene el dia de hoy', () => {
    expect(activeTermCode([anterior, actual], '2026-10-01')).toBe('2027-1');
    expect(activeTermCode([anterior, actual], '2026-06-01')).toBe('2026-3');
  });

  it('entre cuatrimestres se queda con el mas nuevo en vez de no enseñar nada', () => {
    // Es la semana en que el usuario entra aqui precisamente a importar el siguiente:
    // dejarle la pantalla vacia seria lo peor que podria pasar en ese momento.
    expect(activeTermCode([anterior, actual], '2026-08-25')).toBe('2027-1');
  });

  it('devuelve null cuando no hay nada', () => {
    expect(activeTermCode([], '2026-10-01')).toBeNull();
  });
});

describe('clave natural de un tramo', () => {
  it('no incluye el aula', () => {
    // Cambiar de aula entre importaciones tiene que leerse como una ACTUALIZACION del
    // mismo tramo, no como borrar uno y crear otro: si no, cada cambio de aula perderia
    // el id y con el cualquier ajuste que el usuario hubiera hecho.
    const subject = makeSubject();
    const antes = makeBlock(subject, { locationLabel: 'FR1-411' });
    const despues = makeBlock(subject, { locationLabel: 'FR1-305' });

    expect(scheduleBlockNaturalKey(antes)).toBe(scheduleBlockNaturalKey(despues));
  });

  it('distingue el dia y la hora', () => {
    const subject = makeSubject();
    const lunes = makeBlock(subject, { weekday: 1 as Weekday });
    const miercoles = makeBlock(subject, { weekday: 3 as Weekday });

    expect(scheduleBlockNaturalKey(lunes)).not.toBe(scheduleBlockNaturalKey(miercoles));
  });
});
