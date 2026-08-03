import { describe, expect, it } from 'vitest';

import { parseQuickCapture } from '../../src/application/parsing/quick-capture-parser';

/**
 * Referencia fija: domingo 2 de agosto de 2026, 10:00 hora local.
 * Un domingo va bien de ancla porque hace evidente cualquier error de indice al
 * calcular dias de la semana.
 */
const REFERENCE = new Date(2026, 7, 2, 10, 0, 0, 0);

const parse = (text: string) => parseQuickCapture(text, REFERENCE);

const dueDate = (text: string): Date | null => {
  const due = parse(text).dueAt;
  return due === null ? null : new Date(due);
};

describe('titulo', () => {
  it('deja intacto un texto sin marcadores', () => {
    const result = parse('Comprar pan');

    expect(result.title).toBe('Comprar pan');
    expect(result.dueAt).toBeNull();
    expect(result.priority).toBeNull();
  });

  it('quita del titulo todo lo que ha interpretado', () => {
    const result = parse('Llamar al banco mañana a las 3pm !alta #pendientes @finanzas');

    expect(result.title).toBe('Llamar al banco');
    expect(result.priority).toBe('high');
    expect(result.tagNames).toEqual(['pendientes']);
    expect(result.categoryName).toBe('finanzas');
  });

  it('nunca se queda sin titulo', () => {
    // Aunque el texto sea solo marcadores, algo tiene que quedar como titulo.
    const result = parse('mañana !alta');
    expect(result.title.length).toBeGreaterThan(0);
  });
});

describe('fechas relativas', () => {
  it('entiende "hoy"', () => {
    const due = dueDate('Pagar la luz hoy');
    expect(due?.getDate()).toBe(2);
    expect(due?.getMonth()).toBe(7);
  });

  it('entiende "mañana"', () => {
    expect(dueDate('Llamar mañana')?.getDate()).toBe(3);
  });

  it('entiende "pasado mañana"', () => {
    expect(dueDate('Revisar pasado mañana')?.getDate()).toBe(4);
  });

  it('entiende "en N dias"', () => {
    expect(dueDate('Recordar en 5 dias')?.getDate()).toBe(7);
  });

  it('entiende "en N horas" conservando la hora calculada', () => {
    // Son las 10:00, asi que "en 2 horas" son las 12:00. La hora por defecto (9:00)
    // no debe pisarla: seria mandar la tarea al pasado.
    const due = dueDate('Sacar el pan en 2 horas');

    expect(due?.getHours()).toBe(12);
    expect(parse('Sacar el pan en 2 horas').isAllDay).toBe(false);
  });

  it('entiende "en N minutos"', () => {
    const due = dueDate('Revisar el horno en 30 minutos');

    expect(due?.getHours()).toBe(10);
    expect(due?.getMinutes()).toBe(30);
  });

  it('entiende "en N semanas"', () => {
    const due = dueDate('Revision en 2 semanas');
    expect(due?.getDate()).toBe(16);
  });
});

describe('dias de la semana', () => {
  it('salta siempre hacia adelante', () => {
    // La referencia es domingo; "el lunes" es mañana, dia 3.
    const due = dueDate('Reunion el lunes');

    expect(due?.getDay()).toBe(1);
    expect(due?.getDate()).toBe(3);
  });

  it('el mismo dia de la semana significa la semana que viene', () => {
    // Dicho un domingo, "el domingo" no puede ser hoy.
    const due = dueDate('Descansar el domingo');

    expect(due?.getDay()).toBe(0);
    expect(due?.getDate()).toBe(9);
  });

  it('acepta acentos', () => {
    expect(dueDate('Clase el miércoles')?.getDay()).toBe(3);
  });
});

describe('fechas explicitas', () => {
  it('entiende el formato dia/mes', () => {
    const due = dueDate('Cita 15/9');

    expect(due?.getDate()).toBe(15);
    expect(due?.getMonth()).toBe(8);
  });

  it('asume el año siguiente si la fecha ya paso', () => {
    // La referencia es agosto de 2026, asi que "5/1" solo puede ser enero de 2027.
    const due = dueDate('Renovar 5/1');

    expect(due?.getMonth()).toBe(0);
    expect(due?.getFullYear()).toBe(2027);
  });

  it('entiende "N de mes"', () => {
    const due = dueDate('Pagar el 15 de septiembre');

    expect(due?.getDate()).toBe(15);
    expect(due?.getMonth()).toBe(8);
  });

  it('entiende "el N" como dia del mes en curso', () => {
    const due = dueDate('Pagar la renta el 15');

    expect(due?.getDate()).toBe(15);
    expect(due?.getMonth()).toBe(7);
  });
});

describe('horas', () => {
  it('entiende "a las N"', () => {
    const due = dueDate('Reunion mañana a las 15');
    expect(due?.getHours()).toBe(15);
  });

  it('entiende el formato de 12 horas', () => {
    expect(dueDate('Cena mañana 8pm')?.getHours()).toBe(20);
    expect(dueDate('Gym mañana 6am')?.getHours()).toBe(6);
  });

  it('entiende horas con minutos', () => {
    const due = dueDate('Vuelo mañana a las 17:45');

    expect(due?.getHours()).toBe(17);
    expect(due?.getMinutes()).toBe(45);
  });

  it('entiende momentos vagos del dia', () => {
    expect(dueDate('Cenar esta noche')?.getHours()).toBe(20);
    expect(dueDate('Llamar al mediodia')?.getHours()).toBe(12);
  });

  it('no se come el texto cuando fecha y hora reclaman el mismo fragmento', () => {
    // "esta noche" la reclaman el detector de fecha (hoy) y el de hora (20:00).
    // Si los tramos consumidos no se fusionaran, el titulo perderia " con Ana".
    const result = parse('Cenar esta noche con Ana');

    expect(result.title).toBe('Cenar con Ana');
    expect(new Date(result.dueAt as string).getHours()).toBe(20);
  });

  it('no confunde un numero suelto del titulo con una hora', () => {
    // "5" aqui es parte del titulo, no una hora: sin "a las" ni am/pm se ignora.
    const result = parse('Comprar 5 manzanas');

    expect(result.title).toBe('Comprar 5 manzanas');
    expect(result.dueAt).toBeNull();
  });

  it('una hora ya pasada sin fecha se entiende como mañana', () => {
    // Son las 10:00; "a las 8" solo puede referirse a mañana.
    const due = dueDate('Correr a las 8am');

    expect(due?.getDate()).toBe(3);
    expect(due?.getHours()).toBe(8);
  });
});

describe('prioridad y destacado', () => {
  it('entiende las prioridades con nombre', () => {
    expect(parse('Algo !alta').priority).toBe('high');
    expect(parse('Algo !media').priority).toBe('medium');
    expect(parse('Algo !baja').priority).toBe('low');
  });

  it('entiende las prioridades con signos de exclamacion', () => {
    expect(parse('Algo !!!').priority).toBe('high');
    expect(parse('Algo !!').priority).toBe('medium');
    expect(parse('Algo !').priority).toBe('low');
  });

  it('entiende el asterisco como destacado', () => {
    const result = parse('Presentacion *');

    expect(result.isImportant).toBe(true);
    expect(result.title).toBe('Presentacion');
  });
});

describe('etiquetas y categoria', () => {
  it('recoge varias etiquetas', () => {
    const result = parse('Comprar #casa #urgente');

    expect(result.tagNames).toEqual(['casa', 'urgente']);
    expect(result.title).toBe('Comprar');
  });

  it('recoge la categoria', () => {
    expect(parse('Informe @trabajo').categoryName).toBe('trabajo');
  });

  it('acepta acentos y guiones', () => {
    expect(parse('Algo #salud-mental').tagNames).toEqual(['salud-mental']);
  });
});

describe('repeticion', () => {
  it('entiende "cada dia"', () => {
    const result = parse('Meditar cada dia');

    expect(result.recurrence?.frequency).toBe('daily');
    expect(result.recurrence?.interval).toBe(1);
    expect(result.title).toBe('Meditar');
  });

  it('entiende "cada N dias"', () => {
    const result = parse('Regar las plantas cada 3 dias');

    expect(result.recurrence?.frequency).toBe('daily');
    expect(result.recurrence?.interval).toBe(3);
  });

  it('entiende "cada semana" y "cada mes"', () => {
    expect(parse('Limpiar cada semana').recurrence?.frequency).toBe('weekly');
    expect(parse('Pagar cada mes').recurrence?.frequency).toBe('monthly');
  });

  it('entiende "todos los dias"', () => {
    expect(parse('Leer todos los dias').recurrence?.frequency).toBe('daily');
  });

  it('entiende dias concretos de la semana', () => {
    const result = parse('Gym cada lunes y miercoles');

    expect(result.recurrence?.frequency).toBe('weekly');
    expect(result.recurrence?.weekdays).toEqual([1, 3]);
    expect(result.title).toBe('Gym');
  });

  it('no confunde "cada 3 dias" con "en 3 dias"', () => {
    const repeating = parse('Regar cada 3 dias');
    const once = parse('Llamar en 3 dias');

    expect(repeating.recurrence).not.toBeNull();
    expect(once.recurrence).toBeNull();
    expect(new Date(once.dueAt as string).getDate()).toBe(5);
  });

  it('una repeticion sin fecha se ancla a hoy', () => {
    // "cada lunes" necesita una fecha de partida para poder generar la serie.
    const result = parse('Gym cada lunes');
    expect(result.dueAt).not.toBeNull();
  });
});

describe('frases completas', () => {
  it('combina fecha, hora, prioridad, etiqueta y categoria', () => {
    const result = parse('Enviar el informe mañana a las 9am !alta #trabajo @proyectos');
    const due = new Date(result.dueAt as string);

    expect(result.title).toBe('Enviar el informe');
    expect(due.getDate()).toBe(3);
    expect(due.getHours()).toBe(9);
    expect(result.priority).toBe('high');
    expect(result.tagNames).toEqual(['trabajo']);
    expect(result.categoryName).toBe('proyectos');
    expect(result.isAllDay).toBe(false);
  });

  it('marca como "todo el dia" cuando no hay hora', () => {
    const result = parse('Cumpleaños de mama el 15 de septiembre');
    expect(result.isAllDay).toBe(true);
  });

  it('deja constancia de cada fragmento interpretado', () => {
    const result = parse('Algo mañana !alta #casa');
    const kinds = result.tokens.map((token) => token.kind);

    expect(kinds).toContain('date');
    expect(kinds).toContain('priority');
    expect(kinds).toContain('tag');
  });
});
