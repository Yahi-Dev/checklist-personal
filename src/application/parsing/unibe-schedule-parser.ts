import type { CalendarDate } from '../../domain/shared/clock';
import type { ClassModality } from '../../domain/schedule/value-objects/class-modality';
import type { PdfTextItem } from '../ports/services';
import type { TimeOfDay } from '../../domain/schedule/value-objects/time-of-day';
import type { Weekday } from '../../domain/recurrence/recurrence-rule';
import { isRemoteLabel } from '../../domain/schedule/schedule-block';

/**
 * Lee el PDF "HORARIO DE ESTUDIANTES" de UNIBE y devuelve el horario que describe.
 *
 * El documento es una TABLA sin tabla: en el PDF no hay celdas ni bordes, solo trozos
 * de texto sueltos con una coordenada. La rejilla hay que reconstruirla, y la clave es
 * que cada eje lleva una informacion distinta:
 *
 *   - la coordenada `y` dice A QUE ASIGNATURA pertenece un trozo (la fila),
 *   - la coordenada `x` dice DE QUE DIA es (la columna).
 *
 * Agrupar solo por `y`, que es lo que sale de leer el PDF como texto plano, mezcla el
 * lunes con el jueves y produce un horario que parece correcto y no lo es. Por eso el
 * puerto devuelve `PdfTextItem` con posicion y no cadenas.
 *
 * Las columnas NO se dan por fijas: se miden en la cabecera ("Lunes", "Martes"...) de la
 * primera pagina y se reutilizan en las siguientes, donde la universidad no la repite.
 * Asi el parser sigue funcionando si algun cuatrimestre cambia los margenes.
 *
 * Y sobre todo: ESTE PARSER NUNCA FALLA DEL TODO. Igual que el de captura rapida, lo
 * que no entiende se anota en `warnings` con su texto crudo y el resto sigue adelante.
 * Una celda rara de una asignatura no puede costar el horario completo, que es
 * justamente el momento en que el usuario menos ganas tiene de pelearse con la app.
 */

// ---------------------------------------------------------------------------
// Lo que devuelve
// ---------------------------------------------------------------------------

export interface ParsedScheduleBlock {
  readonly weekday: Weekday;
  readonly startsAt: TimeOfDay;
  readonly endsAt: TimeOfDay;
  readonly modality: ClassModality;
  readonly locationLabel: string;
  readonly isRemote: boolean;
  readonly startsOn: CalendarDate | null;
  readonly endsOn: CalendarDate | null;
  /** El texto de la modalidad tal y como venia, cuando no encajo en ninguna conocida. */
  readonly rawModality: string;
}

export interface ParsedSubject {
  readonly code: string;
  readonly name: string;
  readonly section: string;
  readonly credits: number | null;
  readonly teacherCode: string | null;
  readonly teacherName: string | null;
  readonly startsOn: CalendarDate | null;
  readonly endsOn: CalendarDate | null;
  readonly blocks: readonly ParsedScheduleBlock[];
}

export interface ParsedSchedule {
  /** Ej. `2027-1`. `null` si el documento no lleva la linea "Semestre:". */
  readonly termCode: string | null;
  readonly studentName: string | null;
  readonly program: string | null;
  readonly subjects: readonly ParsedSubject[];
  readonly warnings: readonly string[];
}

// ---------------------------------------------------------------------------
// Constantes del documento
// ---------------------------------------------------------------------------

/** En el orden en que los imprime la universidad. El indice es el `Weekday`. */
const DAY_HEADERS: readonly { readonly label: string; readonly weekday: Weekday }[] = [
  { label: 'Lunes', weekday: 1 },
  { label: 'Martes', weekday: 2 },
  { label: 'Miércoles', weekday: 3 },
  { label: 'Jueves', weekday: 4 },
  { label: 'Viernes', weekday: 5 },
  { label: 'Sábado', weekday: 6 },
];

/**
 * Media anchura de una columna de dia, en puntos.
 *
 * Las seis columnas caen cada ~70 puntos, asi que 34 cubre la columna entera sin llegar
 * a tocar la vecina. Se compara contra el CENTRO del trozo de texto porque el contenido
 * de las celdas va centrado, no alineado a la izquierda.
 */
const COLUMN_HALF_WIDTH = 34;

/** Todo lo que empieza a la izquierda de esta `x` es la columna de asignaturas. */
const SUBJECT_COLUMN_MAX_X = 30;

/** Donde empiezan el nombre de la asignatura, sus creditos y su seccion. */
const SUBJECT_TEXT_MIN_X = 46;
const SUBJECT_TEXT_MAX_X = 60;

/** Margen para dar por iguales dos `y` que el PDF escribe con decimas de diferencia. */
const BASELINE_TOLERANCE = 1.5;

const SUBJECT_CODE = /^[A-ZÁÉÍÓÚÑ]{2,4}\d{3,4}$/u;

const TIME_RANGE = /^(\d{1,2}):(\d{2})\s*(AM|PM)\s*\/\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/iu;

const TERM_LINE = /^Semestre:\s*(.+)$/iu;

const FROM_LINE = /^Del\s*:\s*(\d{2})\/(\d{2})\/(\d{4})$/iu;

const TO_LINE = /^Al\s*:\s*(\d{2})\/(\d{2})\/(\d{4})$/iu;

const MODALITY_LINE = /^MODALIDAD\s*:\s*/iu;

const TEACHER_LINE = /^(\d{4,8})\s*-\s*(.*)$/u;

const ROOM_START = /^[A-Z]{2,4}\d{0,2}-/u;

/**
 * Modalidades conocidas, con la forma que la universidad imprime.
 *
 * Se comparan tras quitar acentos, mayusculas y todo lo que no sea letra o numero,
 * porque el PDF parte la palabra donde le cabe: "MODALIDAD:SEMI"+"PRESENCIAL" y
 * "MODALIDAD:SEMIP"+"RESENCIAL" son el mismo cuatrimestre visto en dos paginas.
 */
const KNOWN_MODALITIES: readonly { readonly text: string; readonly modality: ClassModality }[] = [
  { text: 'PRESENCIAL', modality: 'presencial' },
  { text: 'SEMIPRESENCIAL', modality: 'semipresencial' },
  { text: 'VIRTUAL', modality: 'virtual' },
  { text: '100% VIRTUAL', modality: 'virtual' },
  { text: '100% VIRTUAL SINCRONICA', modality: 'virtual' },
  { text: '100% VIRTUAL ASINCRONICA', modality: 'virtual' },
  { text: '100% VIRTUAL HIBRIDA [SINCRONICA/ASINCRONICA]', modality: 'virtual' },
];

// ---------------------------------------------------------------------------
// Punto de entrada
// ---------------------------------------------------------------------------

export const parseUnibeSchedule = (items: readonly PdfTextItem[]): ParsedSchedule => {
  const warnings: string[] = [];
  const clean = items
    .map((item) => ({ ...item, text: item.text.trim() }))
    .filter((item) => item.text.length > 0);

  const pages = groupByPage(clean);
  const header = readDocumentHeader(clean);

  let columns: readonly DayColumn[] | null = null;
  const subjects: ParsedSubject[] = [];

  for (const page of pages) {
    const measured = measureColumns(page);
    if (measured !== null) columns = measured;

    if (columns === null) {
      /* Sin cabecera de dias no hay forma de saber a que dia pertenece cada celda, y
         adivinarlo por posiciones fijas produciria un horario plausible y falso. */
      continue;
    }

    subjects.push(...readPage(page, columns, warnings));
  }

  if (columns === null) {
    warnings.push(
      'No se encontro la fila de dias (Lunes, Martes...). ¿Seguro que es el horario de UNIBE?',
    );
  } else if (subjects.length === 0) {
    warnings.push('No se encontro ninguna asignatura en el documento.');
  }

  return {
    termCode: header.termCode,
    studentName: header.studentName,
    program: header.program,
    subjects,
    warnings,
  };
};

// ---------------------------------------------------------------------------
// Cabecera del documento
// ---------------------------------------------------------------------------

interface DocumentHeader {
  readonly termCode: string | null;
  readonly studentName: string | null;
  readonly program: string | null;
}

const readDocumentHeader = (items: readonly PdfTextItem[]): DocumentHeader => {
  let termCode: string | null = null;

  for (const item of items) {
    const match = TERM_LINE.exec(item.text);
    if (match !== null) {
      termCode = (match[1] ?? '').trim();
      break;
    }
  }

  return {
    termCode,
    studentName: valueBesideLabel(items, /^Estudiante:/iu),
    program: valueBesideLabel(items, /^Carrera:/iu),
  };
};

/** El texto que va a la derecha de una etiqueta, en su misma linea base. */
const valueBesideLabel = (items: readonly PdfTextItem[], label: RegExp): string | null => {
  const found = items.find((item) => label.test(item.text));
  if (found === undefined) return null;

  const value = items.find(
    (item) =>
      item.page === found.page &&
      item !== found &&
      Math.abs(item.y - found.y) < BASELINE_TOLERANCE &&
      item.x > found.x,
  );

  return value?.text ?? null;
};

// ---------------------------------------------------------------------------
// Rejilla: columnas de dia y filas de asignatura
// ---------------------------------------------------------------------------

interface DayColumn {
  readonly weekday: Weekday;
  /** Centro de la columna en puntos. */
  readonly center: number;
}

const groupByPage = (items: readonly PdfTextItem[]): readonly (readonly PdfTextItem[])[] => {
  const pages = new Map<number, PdfTextItem[]>();

  for (const item of items) {
    const bucket = pages.get(item.page) ?? [];
    bucket.push(item);
    pages.set(item.page, bucket);
  }

  return [...pages.entries()].sort((a, b) => a[0] - b[0]).map(([, bucket]) => bucket);
};

/** Minimo de dias que tienen que aparecer juntos para dar la cabecera por buena. */
const MIN_DAY_HEADERS = 3;

/**
 * Mide las columnas en la cabecera de la pagina, o `null` si esta no la lleva.
 *
 * La universidad solo imprime "Lunes Martes Miercoles..." en la primera pagina; la
 * segunda arranca directamente con las asignaturas. De ahi que el llamador conserve las
 * ultimas columnas medidas en vez de exigirlas pagina a pagina.
 *
 * Dos cautelas que no son teoricas:
 *
 * 1. Los nombres de dia se buscan TODOS EN LA MISMA LINEA BASE. Sin eso, una asignatura
 *    que se llamara "Taller de los Sabados" prestaria su palabra a la cabecera y la
 *    columna del sabado se mediria a la altura del nombre, mandando media tabla al dia
 *    equivocado. Se elige la linea donde coinciden mas dias.
 * 2. NO se exigen los seis. Un cuatrimestre sin clases en sabado podria dejar de
 *    imprimir esa columna, y devolver `null` por eso significaria no leer el documento
 *    entero. Con tres basta para saber que estamos ante la cabecera.
 */
const measureColumns = (page: readonly PdfTextItem[]): readonly DayColumn[] | null => {
  const candidates = page
    .map((item) => ({ item, day: DAY_HEADERS.find((entry) => entry.label === item.text) }))
    .filter(
      (found): found is { item: PdfTextItem; day: (typeof DAY_HEADERS)[number] } =>
        found.day !== undefined,
    );

  if (candidates.length === 0) return null;

  const byBaseline = new Map<number, typeof candidates>();

  for (const candidate of candidates) {
    /* La linea base se redondea porque el generador escribe los seis rotulos con
       decimas distintas: 597.7 y 597.71 son la misma fila. */
    const baseline = Math.round(candidate.item.y);
    const bucket = byBaseline.get(baseline) ?? [];
    bucket.push(candidate);
    byBaseline.set(baseline, bucket);
  }

  const best = [...byBaseline.values()].sort((a, b) => b.length - a.length)[0];
  if (best === undefined || best.length < MIN_DAY_HEADERS) return null;

  return best
    .map((found) => ({
      weekday: found.day.weekday,
      center: found.item.x + found.item.width / 2,
    }))
    .sort((a, b) => a.center - b.center);
};

interface SubjectRow {
  readonly code: string;
  readonly y: number;
}

const readSubjectRows = (page: readonly PdfTextItem[]): readonly SubjectRow[] =>
  page
    .filter((item) => item.x < SUBJECT_COLUMN_MAX_X && SUBJECT_CODE.test(item.text))
    .sort((a, b) => b.y - a.y)
    .map((item) => ({ code: item.text, y: item.y }));

const readPage = (
  page: readonly PdfTextItem[],
  columns: readonly DayColumn[],
  warnings: string[],
): readonly ParsedSubject[] => {
  const rows = readSubjectRows(page);
  if (rows.length === 0) return [];

  const cellsByRow = new Map<number, ParsedCell[]>();

  for (const column of columns) {
    for (const cell of readColumnCells(page, column, rows)) {
      const bucket = cellsByRow.get(cell.rowIndex) ?? [];
      bucket.push(cell);
      cellsByRow.set(cell.rowIndex, bucket);
    }
  }

  return rows.map((row, index) => {
    const details = readSubjectDetails(page, rows, index);
    const cells = cellsByRow.get(index) ?? [];
    const blocks = cells.map((cell) => cell.block);

    for (const cell of cells) {
      warnings.push(...cell.warnings);
    }

    const teachers = new Set(cells.map((cell) => cell.teacherName).filter(isPresent));
    if (teachers.size > 1) {
      warnings.push(
        `${row.code}: el documento trae mas de un profesor (${[...teachers].join(' / ')}). Se guarda el primero.`,
      );
    }

    const first = cells[0];

    return {
      code: row.code,
      name: details.name,
      section: details.section,
      credits: details.credits,
      teacherCode: first?.teacherCode ?? null,
      teacherName: first?.teacherName ?? null,
      startsOn: earliest(blocks.map((block) => block.startsOn)),
      endsOn: latest(blocks.map((block) => block.endsOn)),
      blocks: [...blocks].sort(
        (a, b) => a.weekday - b.weekday || a.startsAt.localeCompare(b.startsAt),
      ),
    };
  });
};

// ---------------------------------------------------------------------------
// Columna de asignaturas: nombre, creditos y seccion
// ---------------------------------------------------------------------------

interface SubjectDetails {
  readonly name: string;
  readonly section: string;
  readonly credits: number | null;
}

/**
 * El nombre de una asignatura larga BAJA hasta la linea de "Creditos:".
 *
 * "INTRODUCCION A LA INGENIERIA Y TECNOLOGIAS COMPUTACIONALES" ocupa cuatro lineas, y
 * la cuarta cae a cuatro decimas de la etiqueta "Creditos:" -practicamente en la misma
 * linea base-. Filtrar el nombre por "lo que este por encima de Creditos" se comeria esa
 * cuarta linea, y buscar el numero de creditos "en la linea de la etiqueta" se traeria
 * la palabra COMPUTACIONALES en su lugar.
 *
 * De ahi las dos reglas de aqui: el valor de los creditos tiene que ser ademas un
 * numero, y el nombre llega hasta un pelo POR DEBAJO de la etiqueta.
 */
const readSubjectDetails = (
  page: readonly PdfTextItem[],
  rows: readonly SubjectRow[],
  index: number,
): SubjectDetails => {
  const row = rows[index];
  if (row === undefined) return { name: '', section: '', credits: null };

  const nextRow = rows[index + 1];
  const top = row.y + 6;
  const bottom = nextRow === undefined ? Number.NEGATIVE_INFINITY : nextRow.y + 6;

  const inRow = page.filter(
    (item) => item.y <= top && item.y > bottom && item.x < SUBJECT_TEXT_MAX_X + 80,
  );

  const creditsLabel = inRow.find(
    (item) => item.x < SUBJECT_COLUMN_MAX_X && /^Cr[eé]ditos:/iu.test(item.text),
  );
  const sectionLabel = inRow.find(
    (item) => item.x < SUBJECT_COLUMN_MAX_X && /^Secci[oó]n:/iu.test(item.text),
  );

  const creditsItem = inRow.find(
    (item) =>
      creditsLabel !== undefined &&
      Math.abs(item.y - creditsLabel.y) < BASELINE_TOLERANCE &&
      item.x > 50 &&
      /^\d+$/u.test(item.text),
  );

  const sectionItem = inRow.find(
    (item) =>
      sectionLabel !== undefined &&
      Math.abs(item.y - sectionLabel.y) < BASELINE_TOLERANCE &&
      item.x > 45 &&
      /^[0-9A-Z]{1,4}(?:-[0-9A-Z]{1,4})?$/u.test(item.text),
  );

  /* Por debajo de "Seccion:" la universidad repite a veces la modalidad recortada
     ("100% VIRTUAL", "[SINCRONICA/ASINCRONI"). El suelo del nombre es la etiqueta de
     creditos, no la de seccion, asi que ese texto queda fuera. */
  const floor = (creditsLabel?.y ?? row.y) - 1;

  const name = inRow
    .filter(
      (item) =>
        item.x > SUBJECT_TEXT_MIN_X &&
        item.x < SUBJECT_TEXT_MAX_X &&
        item.y >= floor &&
        item !== creditsItem &&
        item !== sectionItem,
    )
    .sort((a, b) => b.y - a.y)
    .map((item) => item.text)
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();

  return {
    name,
    section: sectionItem?.text ?? '',
    credits: creditsItem === undefined ? null : Number.parseInt(creditsItem.text, 10),
  };
};

// ---------------------------------------------------------------------------
// Celdas: un tramo de clase por celda
// ---------------------------------------------------------------------------

interface ParsedCell {
  readonly rowIndex: number;
  readonly block: ParsedScheduleBlock;
  readonly teacherCode: string | null;
  readonly teacherName: string | null;
  readonly warnings: readonly string[];
}

const readColumnCells = (
  page: readonly PdfTextItem[],
  column: DayColumn,
  rows: readonly SubjectRow[],
): readonly ParsedCell[] => {
  const firstRow = rows[0];
  if (firstRow === undefined) return [];

  const inColumn = page
    .filter(
      (item) =>
        /* El techo descarta de una vez el titulo, el semestre y la cabecera de dias,
           que caen en la misma banda de `x` que alguna columna. */
        item.y < firstRow.y + 10 &&
        Math.abs(item.x + item.width / 2 - column.center) < COLUMN_HALF_WIDTH,
    )
    .sort((a, b) => b.y - a.y);

  const cells: ParsedCell[] = [];
  let current: { top: number; lines: string[] } | null = null;

  const flush = (pending: { top: number; lines: string[] } | null) => {
    if (pending === null) return;

    const owner = ownerRowIndex(rows, pending.top);
    if (owner === -1) return;

    cells.push(readCell(pending.lines, column.weekday, owner, rows[owner]?.code ?? ''));
  };

  for (const item of inColumn) {
    if (TIME_RANGE.test(item.text)) {
      flush(current);
      current = { top: item.y, lines: [item.text] };
      continue;
    }

    current?.lines.push(item.text);
  }

  flush(current);

  return cells;
};

/**
 * A que asignatura pertenece una celda.
 *
 * La celda arranca unas decimas POR ENCIMA del codigo de su propia asignatura -el PDF
 * las alinea por el borde superior de la fila, no por la linea base-, asi que la dueña
 * es la ultima asignatura cuyo codigo queda a esa altura o por debajo.
 */
const ownerRowIndex = (rows: readonly SubjectRow[], cellTop: number): number => {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row !== undefined && row.y <= cellTop) return index;
  }

  return -1;
};

const readCell = (
  lines: readonly string[],
  weekday: Weekday,
  rowIndex: number,
  code: string,
): ParsedCell => {
  const warnings: string[] = [];
  const first = lines[0] ?? '';
  const time = TIME_RANGE.exec(first);

  const modalityIndex = lines.findIndex((line) => MODALITY_LINE.test(line));
  const fromIndex = lines.findIndex((line) => FROM_LINE.test(line));
  const toIndex = lines.findIndex((line) => TO_LINE.test(line));

  const teacherEnd =
    modalityIndex === -1 ? (fromIndex === -1 ? lines.length : fromIndex) : modalityIndex;
  const teacher = readTeacher(lines.slice(1, Math.max(teacherEnd, 1)));

  const bodyEnd = fromIndex === -1 ? lines.length : fromIndex;
  const body =
    modalityIndex === -1
      ? []
      : [
          lines[modalityIndex]?.replace(MODALITY_LINE, '') ?? '',
          ...lines.slice(modalityIndex + 1, bodyEnd),
        ];

  const split = splitModalityAndLocation(body);
  if (split.modality === null && body.length > 0) {
    warnings.push(
      `${code}: no se reconocio la modalidad "${split.rawModality}". Se guarda como presencial.`,
    );
  }

  return {
    rowIndex,
    teacherCode: teacher.code,
    teacherName: teacher.name,
    warnings,
    block: {
      weekday,
      startsAt: toTimeOfDay(time?.[1], time?.[2], time?.[3]),
      endsAt: toTimeOfDay(time?.[4], time?.[5], time?.[6]),
      modality: split.modality ?? 'presencial',
      locationLabel: split.location,
      isRemote: isRemoteLabel(split.location),
      startsOn: toCalendarDate(lines[fromIndex] ?? '', FROM_LINE),
      endsOn: toCalendarDate(lines[toIndex] ?? '', TO_LINE),
      rawModality: split.rawModality,
    },
  };
};

const readTeacher = (lines: readonly string[]): { code: string | null; name: string | null } => {
  /* El nombre se parte SIEMPRE por palabras -los apellidos caben en una linea-, al
     reves que la modalidad, que se parte por letras. De ahi que aqui se una con espacio
     y alli no. El espacio antes de la coma lo trae el propio documento. */
  const joined = lines.join(' ').replace(/\s+,/gu, ',').replace(/\s+/gu, ' ').trim();
  if (joined.length === 0) return { code: null, name: null };

  const match = TEACHER_LINE.exec(joined);
  if (match === null) return { code: null, name: joined };

  const name = (match[2] ?? '').trim();

  return { code: match[1] ?? null, name: name.length === 0 ? null : name };
};

interface ModalitySplit {
  readonly modality: ClassModality | null;
  readonly location: string;
  readonly rawModality: string;
}

/**
 * Separa la modalidad del aula dentro del bloque que sigue a "MODALIDAD:".
 *
 * No hay separador entre las dos: son lineas seguidas, cada una cortada por donde cabia.
 * La unica frontera fiable es semantica, asi que se van acumulando lineas hasta que lo
 * acumulado coincide con una modalidad conocida; lo que sobra es el aula.
 *
 * Cuando ninguna encaja -un cuatrimestre estrena una redaccion nueva- se busca el aula
 * al reves, desde abajo, por su forma (`FR1-305`, `ING-005 [AULA]`, `VIRTUAL ...`), y
 * el resto se guarda como modalidad cruda para que el aviso pueda enseñarla.
 */
const splitModalityAndLocation = (body: readonly string[]): ModalitySplit => {
  for (let take = 1; take <= body.length; take += 1) {
    const accumulated = squash(body.slice(0, take).join(''));
    const known = KNOWN_MODALITIES.find((entry) => squash(entry.text) === accumulated);

    if (known !== undefined) {
      return {
        modality: known.modality,
        location: joinWrapped(body.slice(take)),
        rawModality: known.text,
      };
    }
  }

  let start = body.length;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    const line = body[index] ?? '';
    if (ROOM_START.test(line) || isRemoteLabel(line)) {
      start = index;
      break;
    }
  }

  return {
    modality: null,
    location: joinWrapped(body.slice(start)),
    rawModality: joinWrapped(body.slice(0, start)),
  };
};

/**
 * Vuelve a pegar lineas que el PDF corto por donde le cabia.
 *
 * El corte puede caer en medio de una palabra ("[LAB." + "FISICA]") o justo en un
 * espacio, que entonces desaparece. No hay forma geometrica de distinguirlo, asi que se
 * decide por los caracteres del borde: tras un signo, o antes de un corchete, o al pasar
 * de letra a numero, habia un espacio; en cualquier otro caso la palabra sigue.
 */
const joinWrapped = (lines: readonly string[]): string => {
  const parts = lines.map((line) => line.trim()).filter((line) => line.length > 0);
  const first = parts[0];
  if (first === undefined) return '';

  let out = first;

  for (let index = 1; index < parts.length; index += 1) {
    const next = parts[index] ?? '';
    const previousChar = out.slice(-1);
    const nextChar = next.slice(0, 1);

    const needsSpace =
      /[[(]/u.test(nextChar) ||
      /[%.,:;\])/-]/u.test(previousChar) ||
      (/\p{L}/u.test(previousChar) && /\d/u.test(nextChar));

    out += (needsSpace ? ' ' : '') + next;
  }

  return out.replace(/\s+/gu, ' ').trim();
};

// ---------------------------------------------------------------------------
// Auxiliares privados
// ---------------------------------------------------------------------------

const squash = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, '');

const toTimeOfDay = (
  hour: string | undefined,
  minute: string | undefined,
  meridiem: string | undefined,
): TimeOfDay => {
  const rawHour = Number.parseInt(hour ?? '0', 10) % 12;
  const isAfternoon = (meridiem ?? '').toUpperCase() === 'PM';
  const hours = isAfternoon ? rawHour + 12 : rawHour;

  return `${String(hours).padStart(2, '0')}:${(minute ?? '00').padStart(2, '0')}`;
};

/** `Del : 07/09/2026` -> `2026-09-07`. */
const toCalendarDate = (line: string, pattern: RegExp): CalendarDate | null => {
  const match = pattern.exec(line);
  if (match === null) return null;

  return `${match[3] ?? ''}-${match[2] ?? ''}-${match[1] ?? ''}`;
};

const isPresent = (value: string | null): value is string => value !== null;

const earliest = (dates: readonly (CalendarDate | null)[]): CalendarDate | null =>
  dates.filter(isPresent).sort()[0] ?? null;

const latest = (dates: readonly (CalendarDate | null)[]): CalendarDate | null =>
  dates.filter(isPresent).sort().at(-1) ?? null;
