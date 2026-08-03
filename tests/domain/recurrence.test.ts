import { describe, expect, it } from 'vitest';

import type { Weekday } from '../../src/domain/recurrence/recurrence-rule';

import {
  createRecurrenceRule,
  defaultRecurrenceRule,
  describeRecurrence,
} from '../../src/domain/recurrence/recurrence-rule';
import { isErr, unwrap } from '../../src/domain/shared/result';
import {
  nextOccurrence,
  upcomingOccurrences,
} from '../../src/domain/recurrence/recurrence-calculator';
import {
  addMonthsLocal,
  daysInMonth,
  nthWeekdayOfMonth,
} from '../../src/domain/recurrence/date-arithmetic';

/** Fecha local a ISO, para que las pruebas no dependan de la zona del que las corre. */
const local = (year: number, month: number, day: number, hour = 9, minute = 0): string =>
  new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();

const weekdayOf = (iso: string): number => new Date(iso).getDay();

describe('aritmetica de calendario', () => {
  it('recorta el dia al sumar meses en vez de desbordar al mes siguiente', () => {
    // 31 de enero + 1 mes tiene que dar 28 de febrero, no el 2 o 3 de marzo.
    const result = addMonthsLocal(new Date(2026, 0, 31, 9, 0), 1);

    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(28);
  });

  it('respeta el 29 de febrero en los años bisiestos', () => {
    expect(daysInMonth(2028, 1)).toBe(29);
    expect(daysInMonth(2026, 1)).toBe(28);

    const fromLeapDay = addMonthsLocal(new Date(2028, 1, 29, 9, 0), 12);
    expect(fromLeapDay.getMonth()).toBe(1);
    expect(fromLeapDay.getDate()).toBe(28);
  });

  it('conserva la hora al sumar dias y meses', () => {
    const result = addMonthsLocal(new Date(2026, 0, 15, 14, 37, 12), 3);

    expect(result.getHours()).toBe(14);
    expect(result.getMinutes()).toBe(37);
    expect(result.getSeconds()).toBe(12);
  });

  it('encuentra el n-esimo dia de la semana del mes', () => {
    // El 3.er martes de agosto de 2026: el 1 es sabado, asi que los martes caen
    // en 4, 11, 18 y 25.
    const third = nthWeekdayOfMonth(2026, 7, 2, 3, new Date(2026, 7, 1, 9, 0));

    expect(third?.getDate()).toBe(18);
    expect(third?.getDay()).toBe(2);
  });

  it('devuelve null cuando la n-esima aparicion no existe en ese mes', () => {
    // Febrero de 2026 (28 dias) no tiene un 5.o lunes.
    const fifth = nthWeekdayOfMonth(2026, 1, 1, 5, new Date(2026, 1, 1, 9, 0));
    expect(fifth).toBeNull();
  });
});

describe('validacion de la regla', () => {
  it('rechaza intervalos fuera de rango', () => {
    expect(isErr(createRecurrenceRule({ frequency: 'daily', interval: 0 }))).toBe(true);
    expect(isErr(createRecurrenceRule({ frequency: 'daily', interval: 400 }))).toBe(true);
    expect(isErr(createRecurrenceRule({ frequency: 'daily', interval: 1.5 }))).toBe(true);
  });

  it('normaliza los dias de la semana: los ordena y quita duplicados', () => {
    const rule = unwrap(
      createRecurrenceRule({
        frequency: 'weekly',
        weekdays: [5, 1, 1, 3] as Weekday[],
      }),
    );

    expect(rule.weekdays).toEqual([1, 3, 5]);
  });

  it('limpia los campos que no aplican a la frecuencia elegida', () => {
    // Los dias de la semana no significan nada en una regla diaria: se descartan para
    // que dos reglas equivalentes se guarden exactamente igual.
    const rule = unwrap(
      createRecurrenceRule({ frequency: 'daily', weekdays: [1, 2] as Weekday[], dayOfMonth: 15 }),
    );

    expect(rule.weekdays).toEqual([]);
    expect(rule.dayOfMonth).toBeNull();
  });
});

describe('siguiente ocurrencia', () => {
  it('diaria con intervalo', () => {
    const rule = defaultRecurrenceRule({ frequency: 'daily', interval: 3 });
    const anchor = local(2026, 8, 2);

    expect(nextOccurrence(rule, { anchor, from: anchor })).toBe(local(2026, 8, 5));
  });

  it('semanal en dias concretos, dentro de la misma semana', () => {
    // Lunes y jueves. Partiendo de un lunes, la siguiente es el jueves.
    const rule = defaultRecurrenceRule({
      frequency: 'weekly',
      interval: 1,
      weekdays: [1, 4] as Weekday[],
    });
    const monday = local(2026, 8, 3);

    const next = nextOccurrence(rule, { anchor: monday, from: monday });

    expect(next).not.toBeNull();
    expect(weekdayOf(next as string)).toBe(4);
    expect(next).toBe(local(2026, 8, 6));
  });

  it('semanal en dias concretos, saltando a la semana siguiente', () => {
    const rule = defaultRecurrenceRule({
      frequency: 'weekly',
      interval: 1,
      weekdays: [1, 4] as Weekday[],
    });
    const thursday = local(2026, 8, 6);

    // Desde el jueves ya no quedan dias marcados esta semana: toca el lunes siguiente.
    expect(nextOccurrence(rule, { anchor: local(2026, 8, 3), from: thursday })).toBe(
      local(2026, 8, 10),
    );
  });

  it('semanal cada 2 semanas respeta la fase del ancla', () => {
    const rule = defaultRecurrenceRule({
      frequency: 'weekly',
      interval: 2,
      weekdays: [1] as Weekday[],
    });
    const anchor = local(2026, 8, 3);

    // Se salta el lunes 10 (semana impar) y cae en el 17.
    expect(nextOccurrence(rule, { anchor, from: anchor })).toBe(local(2026, 8, 17));
  });

  it('mensual el dia 31 se recorta en los meses cortos', () => {
    const rule = defaultRecurrenceRule({ frequency: 'monthly', interval: 1, dayOfMonth: 31 });
    const anchor = local(2026, 1, 31);

    const february = nextOccurrence(rule, { anchor, from: anchor });
    expect(february).toBe(local(2026, 2, 28));

    // Y el mes siguiente vuelve al 31: el recorte no debe arrastrarse.
    const march = nextOccurrence(rule, { anchor, from: february as string });
    expect(march).toBe(local(2026, 3, 31));
  });

  it('mensual por dia de la semana', () => {
    // Ancla: domingo 2 de agosto de 2026, que es el primer domingo del mes.
    const rule = defaultRecurrenceRule({
      frequency: 'monthly',
      interval: 1,
      monthlyMode: 'day-of-week',
      weekOfMonth: 1,
    });
    const anchor = local(2026, 8, 2);

    const next = nextOccurrence(rule, { anchor, from: anchor });

    expect(next).not.toBeNull();
    expect(weekdayOf(next as string)).toBe(0);
    expect(new Date(next as string).getMonth()).toBe(8); // septiembre
  });

  it('anual', () => {
    const rule = defaultRecurrenceRule({ frequency: 'yearly', interval: 1 });
    const anchor = local(2026, 8, 2);

    expect(nextOccurrence(rule, { anchor, from: anchor })).toBe(local(2027, 8, 2));
  });
});

describe('condiciones de fin', () => {
  it('deja de generar al llegar al numero de repeticiones', () => {
    const rule = defaultRecurrenceRule({
      frequency: 'daily',
      ends: { kind: 'after', occurrences: 3 },
      occurrenceCount: 3,
    });
    const anchor = local(2026, 8, 2);

    expect(nextOccurrence(rule, { anchor, from: anchor })).toBeNull();
  });

  it('deja de generar despues de la fecha de fin', () => {
    const rule = defaultRecurrenceRule({
      frequency: 'daily',
      ends: { kind: 'on', date: local(2026, 8, 3) },
    });
    const anchor = local(2026, 8, 2);

    // El 3 todavia entra...
    expect(nextOccurrence(rule, { anchor, from: anchor })).toBe(local(2026, 8, 3));
    // ...pero el 4 ya no.
    expect(nextOccurrence(rule, { anchor, from: local(2026, 8, 3) })).toBeNull();
  });

  it('la serie de ocurrencias futuras respeta el limite', () => {
    const rule = defaultRecurrenceRule({
      frequency: 'daily',
      ends: { kind: 'after', occurrences: 3 },
    });
    const anchor = local(2026, 8, 2);

    const occurrences = upcomingOccurrences(rule, { anchor, from: anchor }, { limit: 10 });

    expect(occurrences).toHaveLength(3);
    expect(occurrences[0]).toBe(local(2026, 8, 3));
    expect(occurrences[2]).toBe(local(2026, 8, 5));
  });
});

describe('descripcion legible', () => {
  it('describe una regla semanal con varios dias', () => {
    const rule = defaultRecurrenceRule({
      frequency: 'weekly',
      interval: 2,
      weekdays: [1, 3, 5] as Weekday[],
    });

    expect(describeRecurrence(rule)).toBe('Cada 2 semanas los Lunes, Miercoles y Viernes');
  });

  it('menciona que se cuenta desde el completado', () => {
    const rule = defaultRecurrenceRule({ frequency: 'daily', interval: 3, fromCompletion: true });

    expect(describeRecurrence(rule)).toContain('desde que la completo');
  });
});
