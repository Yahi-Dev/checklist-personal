import { describe, expect, it } from 'vitest';

import type { ScheduleBlock } from '../../src/domain/schedule/schedule-block';

import {
  classProgressAt,
  describeUpcoming,
  formatCountdown,
  describeLocation,
  formatClassCount,
  formatClassTime,
  formatGap,
  minutesOfDay,
} from '../../src/features/schedule/schedule-format';

/**
 * La presentacion del horario, sin DOM.
 *
 * Es el patron que ya usa `tests/features/celebration.test.ts`: lo que puede estar mal
 * de una pantalla no es su marcado sino sus DECISIONES, asi que estas viven en funciones
 * puras y se prueban aqui. Comprobar el HTML solo produciria pruebas que se rompen con
 * cada cambio de estilo sin detectar un solo fallo real.
 */

const block = (overrides: Partial<ScheduleBlock> = {}): ScheduleBlock =>
  ({
    startsAt: '20:00',
    endsAt: '22:00',
    locationLabel: 'FR1-305',
    isRemote: false,
    ...overrides,
  }) as ScheduleBlock;

describe('hora de una clase', () => {
  it('pasa de 24 a 12 horas como habla la universidad', () => {
    expect(formatClassTime('20:00')).toBe('8:00 pm');
    expect(formatClassTime('08:00')).toBe('8:00 am');
    expect(formatClassTime('14:30')).toBe('2:30 pm');
  });

  it('no confunde el mediodia con la medianoche', () => {
    // El fallo clasico de `hora % 12`: las 12:00 pm salen como 0:00.
    expect(formatClassTime('12:00')).toBe('12:00 pm');
    expect(formatClassTime('00:30')).toBe('12:30 am');
  });

  it('deja los minutos con dos cifras y la hora sin cero delante', () => {
    expect(formatClassTime('09:05')).toBe('9:05 am');
  });
});

describe('huecos entre clases', () => {
  it('los dice como los diria una persona', () => {
    expect(formatGap(240)).toBe('4h libre');
    expect(formatGap(90)).toBe('1h 30min libre');
    expect(formatGap(45)).toBe('45min libre');
  });

  it('no anuncia los huecos cortos', () => {
    // Diez minutos entre clases es el tiempo de cambiar de aula, no tiempo libre.
    // Anunciarlos llenaria la tarjeta de ruido entre clases seguidas.
    expect(formatGap(10)).toBeNull();
    expect(formatGap(29)).toBeNull();
    expect(formatGap(30)).toBe('30min libre');
  });
});

describe('aula en pantalla', () => {
  it('trocea el aula fisica en edificio y numero', () => {
    expect(describeLocation(block({ locationLabel: 'FR1-305' }))).toEqual({
      isRemote: false,
      building: 'Edif. FR1',
      room: 'Aula 305',
      note: null,
      fallback: null,
    });
  });

  it('conserva la aclaracion del laboratorio', () => {
    expect(describeLocation(block({ locationLabel: 'FR2-L06 [LAB. FÍSICA]' })).note).toBe(
      'LAB. FÍSICA',
    );
  });

  it('una clase remota no enseña aula, solo que es virtual', () => {
    // Es lo que evita que salga el "VIRTUAL [HIBRIDA SINCRONICO/ASINCRONO 100%]" que
    // imprime la universidad, que no le dice nada a nadie.
    const remota = describeLocation(
      block({ isRemote: true, locationLabel: 'VIRTUAL [ASINCRONICA 100%]' }),
    );

    expect(remota.isRemote).toBe(true);
    expect(remota.building).toBeNull();
    expect(remota.fallback).toBeNull();
  });

  it('enseña el texto crudo cuando no reconoce el formato', () => {
    // Un cuatrimestre con un formato de aula nuevo tiene que enseñar algo, no una linea
    // vacia donde el usuario esperaba saber a donde ir.
    expect(describeLocation(block({ locationLabel: 'PABELLON B / SALA 3' })).fallback).toBe(
      'PABELLON B / SALA 3',
    );
  });
});

describe('en que punto esta una clase', () => {
  const clase = block({ startsAt: '18:00', endsAt: '20:00' });

  it('la señala en curso mientras dura', () => {
    expect(classProgressAt(clase, 18 * 60)).toBe('now');
    expect(classProgressAt(clase, 19 * 60 + 30)).toBe('now');
  });

  it('la da por terminada justo al acabar', () => {
    // A las 20:00 en punto ya se acabo: si no, la clase seguiria marcada como "ahora"
    // mientras la siguiente tambien lo esta.
    expect(classProgressAt(clase, 20 * 60)).toBe('past');
  });

  it('la deja pendiente antes de empezar', () => {
    expect(classProgressAt(clase, 17 * 60 + 59)).toBe('upcoming');
  });
});

describe('contadores', () => {
  it('concuerda el singular y el plural', () => {
    expect(formatClassCount(0)).toBe('0 clases');
    expect(formatClassCount(1)).toBe('1 clase');
    expect(formatClassCount(3)).toBe('3 clases');
  });

  it('cuenta los minutos del dia en hora local', () => {
    expect(minutesOfDay(new Date(2026, 8, 7, 20, 30))).toBe(1230);
    expect(minutesOfDay(new Date(2026, 8, 7, 0, 0))).toBe(0);
  });
});

describe('la cuenta atras', () => {
  it('se dice corta y redonda', () => {
    // Nadie sale antes porque falten 47 minutos en vez de 45, y un numero que cambia cada
    // segundo en una tira que se mira de reojo es ruido.
    expect(formatCountdown(40)).toBe('40 min');
    expect(formatCountdown(70)).toBe('1 h 10 min');
    expect(formatCountdown(120)).toBe('2 h');
    expect(formatCountdown(0)).toBe('0 min');
  });

  it('nunca da un numero negativo', () => {
    expect(formatCountdown(-15)).toBe('0 min');
  });
});

describe('como se anuncia la proxima clase', () => {
  const base = {
    item: { block: { startsAt: '20:00' } },
    weekday: 4 as const,
  } as unknown as Parameters<typeof describeUpcoming>[0];

  it('la que esta en curso se anuncia por lo que QUEDA', () => {
    // Sentado en el aula, lo unico que quieres saber es cuanto falta para salir.
    const texto = describeUpcoming({
      ...base,
      daysAhead: 0,
      isNow: true,
      minutesUntilStart: -35,
      minutesUntilEnd: 25,
    });

    expect(texto).toBe('Ahora · termina en 25 min');
  });

  it('la de hoy, por lo que falta', () => {
    const texto = describeUpcoming({
      ...base,
      daysAhead: 0,
      isNow: false,
      minutesUntilStart: 40,
      minutesUntilEnd: 160,
    });

    expect(texto).toBe('En 40 min');
  });

  it('a partir de mañana se nombra el dia, no las horas', () => {
    // "En 19 h 40 min" es correcto y no le dice nada a nadie.
    expect(
      describeUpcoming({
        ...base,
        daysAhead: 1,
        isNow: false,
        minutesUntilStart: 1180,
        minutesUntilEnd: 1300,
      }),
    ).toBe('Mañana a las 8:00 pm');

    expect(
      describeUpcoming({
        ...base,
        daysAhead: 3,
        isNow: false,
        minutesUntilStart: 5000,
        minutesUntilEnd: 5120,
      }),
    ).toBe('El jueves a las 8:00 pm');
  });
});
