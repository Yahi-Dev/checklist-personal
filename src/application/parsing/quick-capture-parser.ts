import type { IsoDateTime } from '../../domain/task/value-objects/iso-date-time';
import type { Priority } from '../../domain/task/value-objects/priority';
import type { RecurrenceRule, Weekday } from '../../domain/recurrence/recurrence-rule';

import { addDaysLocal, withTimeOf } from '../../domain/recurrence/date-arithmetic';
import { defaultRecurrenceRule } from '../../domain/recurrence/recurrence-rule';
import { toIso } from '../../domain/task/value-objects/iso-date-time';

/**
 * Analizador de lenguaje natural en español para la captura rapida.
 *
 * El requisito era "titulo y ya, sin friccion". Abrir un formulario con seis campos
 * para apuntar "sacar la basura mañana a las 8" es exactamente la friccion que hace
 * que una app de tareas se abandone a la semana. Aqui se escribe la frase entera y el
 * parser extrae fecha, hora, prioridad, categoria, etiquetas y repeticion.
 *
 * Ejemplos que entiende:
 *   "Comprar leche mañana a las 6pm #compras !alta"
 *   "Pagar la luz el 15 @finanzas"
 *   "Ir al gym cada lunes y miercoles a las 7am"
 *   "Llamar al doctor en 3 dias"
 *   "Backup del proyecto cada 2 semanas *"
 *
 * Todo lo que no reconoce se queda en el titulo, asi que nunca destruye informacion.
 */

export interface ParsedToken {
  readonly text: string;
  readonly kind: 'date' | 'time' | 'priority' | 'tag' | 'category' | 'recurrence' | 'important';
}

export interface ParsedQuickCapture {
  readonly title: string;
  readonly dueAt: IsoDateTime | null;
  readonly isAllDay: boolean;
  readonly priority: Priority | null;
  readonly isImportant: boolean;
  readonly tagNames: readonly string[];
  readonly categoryName: string | null;
  readonly recurrence: RecurrenceRule | null;
  readonly tokens: readonly ParsedToken[];
}

const WEEKDAY_NAMES: Readonly<Record<string, Weekday>> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

const MONTH_NAMES: Readonly<Record<string, number>> = {
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  setiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11,
};

/** Hora por defecto de una tarea "de mañana" sin hora explicita: 9:00. */
const DEFAULT_HOUR = 9;

/** Quita acentos para poder comparar "miércoles" con "miercoles". */
const deaccent = (value: string): string => value.normalize('NFD').replace(/\p{Diacritic}/gu, '');

interface Extraction {
  /** Fragmentos consumidos, para poder borrarlos del titulo. */
  readonly spans: readonly [number, number][];
}

export const parseQuickCapture = (
  input: string,
  reference: Date = new Date(),
): ParsedQuickCapture => {
  const original = input;
  const haystack = deaccent(input).toLowerCase();

  const consumed: [number, number][] = [];
  const tokens: ParsedToken[] = [];

  const consume = (extraction: Extraction, kind: ParsedToken['kind']): void => {
    for (const span of extraction.spans) {
      consumed.push(span);
      tokens.push({ text: original.slice(span[0], span[1]).trim(), kind });
    }
  };

  // El orden importa. "cada 3 dias" tiene que resolverse ANTES que "en 3 dias",
  // y la hora despues de la fecha, para poder aplicarla sobre el dia ya encontrado.
  const important = matchImportant(haystack);
  consume(important, 'important');

  const priority = matchPriority(haystack);
  consume(priority, 'priority');

  const tags = matchTags(original);
  consume(tags, 'tag');

  const category = matchCategory(original);
  consume(category, 'category');

  const recurrence = matchRecurrence(haystack);
  consume(recurrence, 'recurrence');

  const date = matchDate(haystack, reference);
  consume(date, 'date');

  const time = matchTime(haystack);
  consume(time, 'time');

  const title = stripSpans(original, consumed);

  const dueAt = buildDueDate({
    baseDate: date.date,
    dateCarriesTime: date.hasExplicitTime === true,
    time: time.time,
    recurrence: recurrence.rule,
    reference,
  });

  return {
    title: title.length > 0 ? title : original.trim(),
    dueAt,
    isAllDay: dueAt !== null && time.time === null && date.hasExplicitTime !== true,
    priority: priority.priority,
    isImportant: important.isImportant,
    tagNames: tags.names,
    categoryName: category.name,
    recurrence: recurrence.rule,
    tokens,
  };
};

// ---------------------------------------------------------------------------
// Destacado:  "*" suelto al final, o la palabra "importante"
// ---------------------------------------------------------------------------

const matchImportant = (haystack: string): Extraction & { isImportant: boolean } => {
  const match = /(?:^|\s)(\*|!importante|importante!)(?=\s|$)/u.exec(haystack);
  if (match === null) return { spans: [], isImportant: false };

  const start = match.index + match[0].indexOf(match[1] ?? '');
  return { spans: [[start, start + (match[1]?.length ?? 0)]], isImportant: true };
};

// ---------------------------------------------------------------------------
// Prioridad:  !alta / !media / !baja  o  !!! / !! / !
// ---------------------------------------------------------------------------

const matchPriority = (haystack: string): Extraction & { priority: Priority | null } => {
  const named = /(?:^|\s)(![a-z]+)(?=\s|$)/u.exec(haystack);

  if (named !== null) {
    const word = (named[1] ?? '').slice(1);
    const priority = word.startsWith('alt')
      ? 'high'
      : word.startsWith('med')
        ? 'medium'
        : word.startsWith('baj')
          ? 'low'
          : null;

    if (priority !== null) {
      const start = named.index + named[0].indexOf('!');
      return { spans: [[start, start + (named[1]?.length ?? 0)]], priority };
    }
  }

  const bangs = /(?:^|\s)(!{1,3})(?=\s|$)/u.exec(haystack);
  if (bangs !== null) {
    const count = (bangs[1] ?? '').length;
    const start = bangs.index + bangs[0].indexOf('!');
    return {
      spans: [[start, start + count]],
      priority: count === 3 ? 'high' : count === 2 ? 'medium' : 'low',
    };
  }

  return { spans: [], priority: null };
};

// ---------------------------------------------------------------------------
// Etiquetas:  #compras  |  Categoria:  @finanzas
// ---------------------------------------------------------------------------

const matchTags = (original: string): Extraction & { names: string[] } => {
  const spans: [number, number][] = [];
  const names: string[] = [];
  const pattern = /(?:^|\s)#([\p{L}\p{N}_-]{1,40})/gu;

  let match = pattern.exec(original);
  while (match !== null) {
    const start = match.index + match[0].indexOf('#');
    spans.push([start, start + 1 + (match[1] ?? '').length]);
    names.push(match[1] ?? '');
    match = pattern.exec(original);
  }

  return { spans, names };
};

const matchCategory = (original: string): Extraction & { name: string | null } => {
  const match = /(?:^|\s)@([\p{L}\p{N}_-]{1,40})/u.exec(original);
  if (match === null) return { spans: [], name: null };

  const start = match.index + match[0].indexOf('@');
  return { spans: [[start, start + 1 + (match[1] ?? '').length]], name: match[1] ?? null };
};

// ---------------------------------------------------------------------------
// Repeticion
// ---------------------------------------------------------------------------

const matchRecurrence = (haystack: string): Extraction & { rule: RecurrenceRule | null } => {
  // "cada 3 dias" | "cada 2 semanas" | "cada mes" | "cada dia"
  const every =
    /(?:^|\s)(cada\s+(?:(\d{1,3})\s+)?(dias?|semanas?|meses|mes|anos?|anios?))(?=\s|$)/u.exec(
      haystack,
    );

  if (every !== null) {
    const interval = every[2] === undefined ? 1 : Number.parseInt(every[2], 10);
    const unit = every[3] ?? 'dia';
    const frequency = unit.startsWith('sem')
      ? 'weekly'
      : unit.startsWith('mes')
        ? 'monthly'
        : unit.startsWith('an')
          ? 'yearly'
          : 'daily';

    const start = every.index + every[0].indexOf('cada');
    return {
      spans: [[start, start + (every[1] ?? '').length]],
      rule: defaultRecurrenceRule({ frequency, interval }),
    };
  }

  // "todos los dias" | "todas las semanas"
  const all =
    /(?:^|\s)(todos\s+los\s+dias|todas\s+las\s+semanas|todos\s+los\s+meses)(?=\s|$)/u.exec(
      haystack,
    );

  if (all !== null) {
    const phrase = all[1] ?? '';
    const frequency = phrase.includes('semana')
      ? 'weekly'
      : phrase.includes('mes')
        ? 'monthly'
        : 'daily';
    const start = all.index + all[0].indexOf(phrase);
    return {
      spans: [[start, start + phrase.length]],
      rule: defaultRecurrenceRule({ frequency, interval: 1 }),
    };
  }

  // "cada lunes" | "cada lunes y miercoles" | "todos los lunes"
  const weekdayNames = Object.keys(WEEKDAY_NAMES).join('|');
  const weekly = new RegExp(
    `(?:^|\\s)((?:cada|todos\\s+los)\\s+(${weekdayNames})(?:\\s*(?:,|y)\\s*(?:${weekdayNames}))*)(?=\\s|$)`,
    'u',
  ).exec(haystack);

  if (weekly !== null) {
    const phrase = weekly[1] ?? '';
    const days = [...phrase.matchAll(new RegExp(`(${weekdayNames})`, 'gu'))]
      .map((entry) => WEEKDAY_NAMES[entry[1] ?? ''])
      .filter((day): day is Weekday => day !== undefined);

    const start = weekly.index + weekly[0].indexOf(phrase);
    return {
      spans: [[start, start + phrase.length]],
      rule: defaultRecurrenceRule({ frequency: 'weekly', interval: 1, weekdays: days }),
    };
  }

  return { spans: [], rule: null };
};

// ---------------------------------------------------------------------------
// Fecha
// ---------------------------------------------------------------------------

interface DateMatch extends Extraction {
  readonly date: Date | null;
  /**
   * `true` cuando la propia expresion ya fija la HORA, no solo el dia.
   * "en 2 horas" son las 12:00 si son las 10:00; sobrescribirla con la hora por
   * defecto la convertiria en las 9:00, que es justo lo contrario de lo pedido.
   */
  readonly hasExplicitTime?: boolean;
}

const matchDate = (haystack: string, reference: Date): DateMatch => {
  const relative = matchRelativeDay(haystack, reference);
  if (relative.date !== null) return relative;

  const inN = matchInNUnits(haystack, reference);
  if (inN.date !== null) return inN;

  const weekday = matchNextWeekday(haystack, reference);
  if (weekday.date !== null) return weekday;

  const numeric = matchNumericDate(haystack, reference);
  if (numeric.date !== null) return numeric;

  const spelled = matchSpelledDate(haystack, reference);
  if (spelled.date !== null) return spelled;

  return { spans: [], date: null };
};

const matchRelativeDay = (haystack: string, reference: Date): DateMatch => {
  const table: readonly [RegExp, number][] = [
    [/(?:^|\s)(pasado\s+manana)(?=\s|$)/u, 2],
    [/(?:^|\s)(manana)(?=\s|$)/u, 1],
    [/(?:^|\s)(hoy|esta\s+noche|esta\s+tarde)(?=\s|$)/u, 0],
    [/(?:^|\s)(ayer)(?=\s|$)/u, -1],
  ];

  for (const [pattern, offset] of table) {
    const match = pattern.exec(haystack);
    if (match === null) continue;

    const phrase = match[1] ?? '';
    const start = match.index + match[0].indexOf(phrase);
    return { spans: [[start, start + phrase.length]], date: addDaysLocal(reference, offset) };
  }

  return { spans: [], date: null };
};

const matchInNUnits = (haystack: string, reference: Date): DateMatch => {
  const match =
    /(?:^|\s)(en\s+(\d{1,3})\s+(minutos?|horas?|dias?|semanas?|meses|mes))(?=\s|$)/u.exec(haystack);
  if (match === null) return { spans: [], date: null };

  const amount = Number.parseInt(match[2] ?? '1', 10);
  const unit = match[3] ?? 'dias';
  const date = new Date(reference);

  // Minutos y horas desplazan el INSTANTE, asi que la hora resultante es significativa.
  // Dias, semanas y meses desplazan el DIA y dejan la hora al criterio por defecto.
  const carriesTime = unit.startsWith('minuto') || unit.startsWith('hora');

  if (unit.startsWith('minuto')) date.setMinutes(date.getMinutes() + amount);
  else if (unit.startsWith('hora')) date.setHours(date.getHours() + amount);
  else if (unit.startsWith('dia')) date.setDate(date.getDate() + amount);
  else if (unit.startsWith('semana')) date.setDate(date.getDate() + amount * 7);
  else date.setMonth(date.getMonth() + amount);

  const phrase = match[1] ?? '';
  const start = match.index + match[0].indexOf(phrase);

  return { spans: [[start, start + phrase.length]], date, hasExplicitTime: carriesTime };
};

const matchNextWeekday = (haystack: string, reference: Date): DateMatch => {
  const names = Object.keys(WEEKDAY_NAMES).join('|');
  const match = new RegExp(
    `(?:^|\\s)((?:el\\s+|este\\s+|proximo\\s+|el\\s+proximo\\s+)?(${names}))(?=\\s|$)`,
    'u',
  ).exec(haystack);

  if (match === null) return { spans: [], date: null };

  const targetWeekday = WEEKDAY_NAMES[match[2] ?? ''];
  if (targetWeekday === undefined) return { spans: [], date: null };

  // Siempre hacia adelante: "el lunes" dicho un lunes significa el lunes que viene.
  const delta = (targetWeekday - reference.getDay() + 7) % 7 || 7;
  const phrase = match[1] ?? '';
  const start = match.index + match[0].indexOf(phrase);

  return { spans: [[start, start + phrase.length]], date: addDaysLocal(reference, delta) };
};

const matchNumericDate = (haystack: string, reference: Date): DateMatch => {
  // "15/8", "15/08/2026", "15-8"
  const match = /(?:^|\s)((\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?)(?=\s|$)/u.exec(haystack);
  if (match === null) return { spans: [], date: null };

  const day = Number.parseInt(match[2] ?? '1', 10);
  const month = Number.parseInt(match[3] ?? '1', 10) - 1;
  const rawYear = match[4];
  const year =
    rawYear === undefined
      ? reference.getFullYear()
      : rawYear.length === 2
        ? 2000 + Number.parseInt(rawYear, 10)
        : Number.parseInt(rawYear, 10);

  if (day < 1 || day > 31 || month < 0 || month > 11) return { spans: [], date: null };

  const date = new Date(year, month, day, DEFAULT_HOUR, 0, 0, 0);
  // Sin año explicito y con la fecha ya pasada, se asume el año que viene.
  if (rawYear === undefined && date.getTime() < reference.getTime()) {
    date.setFullYear(date.getFullYear() + 1);
  }

  const phrase = match[1] ?? '';
  const start = match.index + match[0].indexOf(phrase);
  return { spans: [[start, start + phrase.length]], date };
};

const matchSpelledDate = (haystack: string, reference: Date): DateMatch => {
  const months = Object.keys(MONTH_NAMES).join('|');

  // "15 de agosto" | "el 15 de agosto de 2026"
  const full = new RegExp(
    `(?:^|\\s)((?:el\\s+)?(\\d{1,2})\\s+de\\s+(${months})(?:\\s+de\\s+(\\d{4}))?)(?=\\s|$)`,
    'u',
  ).exec(haystack);

  if (full !== null) {
    const day = Number.parseInt(full[2] ?? '1', 10);
    const month = MONTH_NAMES[full[3] ?? ''] ?? 0;
    const year = full[4] === undefined ? reference.getFullYear() : Number.parseInt(full[4], 10);

    const date = new Date(year, month, day, DEFAULT_HOUR, 0, 0, 0);
    if (full[4] === undefined && date.getTime() < reference.getTime()) {
      date.setFullYear(date.getFullYear() + 1);
    }

    const phrase = full[1] ?? '';
    const start = full.index + full[0].indexOf(phrase);
    return { spans: [[start, start + phrase.length]], date };
  }

  // "el 15" -> el dia 15 de este mes o del siguiente si ya paso.
  const dayOnly = /(?:^|\s)(el\s+(\d{1,2}))(?=\s|$)/u.exec(haystack);
  if (dayOnly !== null) {
    const day = Number.parseInt(dayOnly[2] ?? '1', 10);
    if (day >= 1 && day <= 31) {
      const date = new Date(
        reference.getFullYear(),
        reference.getMonth(),
        day,
        DEFAULT_HOUR,
        0,
        0,
        0,
      );
      if (date.getTime() < reference.getTime()) date.setMonth(date.getMonth() + 1);

      const phrase = dayOnly[1] ?? '';
      const start = dayOnly.index + dayOnly[0].indexOf(phrase);
      return { spans: [[start, start + phrase.length]], date };
    }
  }

  return { spans: [], date: null };
};

// ---------------------------------------------------------------------------
// Hora
// ---------------------------------------------------------------------------

interface TimeMatch extends Extraction {
  readonly time: { hours: number; minutes: number } | null;
}

const matchTime = (haystack: string): TimeMatch => {
  // "a las 5", "a las 17:30", "5pm", "5:30 pm", "17h"
  const explicit = /(?:^|\s)((?:a\s+las?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|h)?)(?=\s|$)/gu;

  let match = explicit.exec(haystack);
  while (match !== null) {
    const hasAnchor = (match[1] ?? '').startsWith('a la');
    const meridiem = match[4];

    // Un numero suelto sin "a las" ni am/pm no es una hora: es parte del titulo.
    if (!hasAnchor && meridiem === undefined) {
      match = explicit.exec(haystack);
      continue;
    }

    let hours = Number.parseInt(match[2] ?? '0', 10);
    const minutes = match[3] === undefined ? 0 : Number.parseInt(match[3], 10);

    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;

    if (hours > 23 || minutes > 59) {
      match = explicit.exec(haystack);
      continue;
    }

    const phrase = match[1] ?? '';
    const start = match.index + match[0].indexOf(phrase);
    return { spans: [[start, start + phrase.length]], time: { hours, minutes } };
  }

  // "esta noche" / "por la tarde" / "en la mañana"
  const vague: readonly [RegExp, number][] = [
    [/(?:^|\s)(esta\s+noche|por\s+la\s+noche|en\s+la\s+noche)(?=\s|$)/u, 20],
    [/(?:^|\s)(esta\s+tarde|por\s+la\s+tarde|en\s+la\s+tarde)(?=\s|$)/u, 15],
    [/(?:^|\s)(en\s+la\s+manana|por\s+la\s+manana)(?=\s|$)/u, 9],
    [/(?:^|\s)(al\s+mediodia)(?=\s|$)/u, 12],
  ];

  for (const [pattern, hours] of vague) {
    const found = pattern.exec(haystack);
    if (found === null) continue;

    const phrase = found[1] ?? '';
    const start = found.index + found[0].indexOf(phrase);
    return { spans: [[start, start + phrase.length]], time: { hours, minutes: 0 } };
  }

  return { spans: [], time: null };
};

// ---------------------------------------------------------------------------
// Ensamblado
// ---------------------------------------------------------------------------

const buildDueDate = (params: {
  baseDate: Date | null;
  dateCarriesTime: boolean;
  time: { hours: number; minutes: number } | null;
  recurrence: RecurrenceRule | null;
  reference: Date;
}): IsoDateTime | null => {
  const { baseDate, dateCarriesTime, time, recurrence, reference } = params;

  // Una repeticion sin fecha arranca hoy: es lo que espera quien escribe "cada lunes".
  if (baseDate === null && time === null && recurrence === null) return null;

  let date = baseDate ?? new Date(reference);

  if (time !== null) {
    // La hora explicita siempre manda sobre la que traiga la fecha.
    date = withTimeOf(date, new Date(2000, 0, 1, time.hours, time.minutes, 0, 0));

    // "a las 8" cuando ya son las 21:00 solo puede referirse a mañana.
    if (baseDate === null && date.getTime() <= reference.getTime()) {
      date = addDaysLocal(date, 1);
    }
  } else if (dateCarriesTime) {
    // "en 2 horas" ya calculo la hora exacta: tocarla la destruiria.
    return toIso(date);
  } else if (baseDate !== null) {
    date = withTimeOf(date, new Date(2000, 0, 1, DEFAULT_HOUR, 0, 0, 0));
  } else {
    // Solo hay repeticion: se ancla a hoy a la hora por defecto.
    date = withTimeOf(reference, new Date(2000, 0, 1, DEFAULT_HOUR, 0, 0, 0));
  }

  return toIso(date);
};

/**
 * Borra del texto original los fragmentos consumidos.
 *
 * Los tramos se FUSIONAN antes de recortar. Es imprescindible porque varios
 * detectores pueden reclamar el mismo texto: "esta noche" la reconoce el detector de
 * fecha (hoy) y tambien el de hora (20:00), y cortar dos veces el mismo tramo se
 * llevaria por delante el texto que viene detras. En "Cenar esta noche con Ana", sin
 * fusionar, el titulo quedaria en "Cenar".
 */
const stripSpans = (original: string, spans: readonly [number, number][]): string => {
  if (spans.length === 0) return original.trim();

  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];

  for (const span of sorted) {
    const last = merged[merged.length - 1];

    if (last !== undefined && span[0] <= last[1]) {
      last[1] = Math.max(last[1], span[1]);
    } else {
      merged.push([span[0], span[1]]);
    }
  }

  let result = original;
  for (const [start, end] of merged.reverse()) {
    result = result.slice(0, start) + result.slice(end);
  }

  return result
    .replace(/\s+/gu, ' ')
    .replace(/\s+([,.;:])/gu, '$1')
    .trim();
};
