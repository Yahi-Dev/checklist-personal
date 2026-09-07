import { describe, expect, it } from 'vitest';

import type {
  ParsedSchedule,
  ParsedSubject,
} from '../../src/application/parsing/unibe-schedule-parser';
import type { PdfTextItem } from '../../src/application/ports/services';

import {
  HORARIO_2026_1,
  HORARIO_2026_2,
  HORARIO_2026_3,
  HORARIO_2027_1,
} from '../support/unibe-schedule-fixture';
import { parseUnibeSchedule } from '../../src/application/parsing/unibe-schedule-parser';

/**
 * El parser del horario de UNIBE, contra los cuatro documentos reales.
 *
 * Es la pieza mas fragil de todo el modulo y la unica que depende de un formato que no
 * controlamos. Probarla con un caso inventado no probaria nada: las trampas del PDF
 * -que la segunda pagina no repite la cabecera de dias, que un nombre largo baja hasta
 * la linea de los creditos, que la modalidad se parte por letras- solo aparecen en los
 * documentos de verdad.
 */

const subjectByCode = (parsed: ParsedSchedule, code: string, section?: string): ParsedSubject => {
  const found = parsed.subjects.find(
    (subject) => subject.code === code && (section === undefined || subject.section === section),
  );

  if (found === undefined) throw new Error(`No se encontro ${code} ${section ?? ''}`);
  return found;
};

describe('parser del horario de UNIBE', () => {
  it('lee la cabecera del documento', () => {
    const parsed = parseUnibeSchedule(HORARIO_2027_1);

    expect(parsed.termCode).toBe('2027-1');
    expect(parsed.studentName).toBe('26-1029 - TORRES VÁSQUEZ, YAHINNIEL ALEJANDRO');
    expect(parsed.program).toBe('INGENIERÍA EN TECNOLOGÍAS COMPUTACIONALES');
    expect(parsed.warnings).toEqual([]);
  });

  it('encuentra las cinco asignaturas del cuatrimestre en curso', () => {
    const parsed = parseUnibeSchedule(HORARIO_2027_1);

    expect(parsed.subjects.map((subject) => subject.code)).toEqual([
      'EGC252',
      'EGC270',
      'EGC270',
      'TI3210',
      'TI3321',
      'UNB306',
    ]);
  });

  it('separa dos secciones de la misma asignatura', () => {
    // EGC270 aparece dos veces: la teoria (01) y su laboratorio (01-01), con profesor,
    // dia y aula distintos. Deduplicar por nombre o por codigo se comeria una de las dos.
    const parsed = parseUnibeSchedule(HORARIO_2027_1);

    const teoria = subjectByCode(parsed, 'EGC270', '01');
    const laboratorio = subjectByCode(parsed, 'EGC270', '01-01');

    expect(teoria.name).toBe('FÍSICA GENERAL II');
    expect(laboratorio.name).toBe('FÍSICA GENERAL II');
    expect(teoria.blocks[0]?.weekday).toBe(2);
    expect(laboratorio.blocks[0]?.weekday).toBe(4);
    expect(laboratorio.blocks[0]?.locationLabel).toBe('FR2-L06 [LAB. FÍSICA]');
  });

  it('asigna cada celda a su dia por la coordenada x', () => {
    // Es el bug que lo rompe todo en silencio: leyendo el PDF como texto plano, los dos
    // tramos de Logica Matematica -lunes y miercoles, en aulas distintas- se mezclan.
    const parsed = parseUnibeSchedule(HORARIO_2027_1);
    const logica = subjectByCode(parsed, 'TI3210');

    expect(logica.blocks).toHaveLength(2);
    expect(logica.blocks[0]).toMatchObject({
      weekday: 1,
      startsAt: '20:00',
      endsAt: '22:00',
      locationLabel: 'FR1-411',
    });
    expect(logica.blocks[1]).toMatchObject({
      weekday: 3,
      startsAt: '20:00',
      endsAt: '22:00',
      locationLabel: 'FR1-305',
    });
  });

  it('convierte la hora de 12 horas a HH:mm', () => {
    const parsed = parseUnibeSchedule(HORARIO_2027_1);

    // 12:00 PM es mediodia, no medianoche: el modulo 12 sin corregir lo pondria en 00:00.
    expect(subjectByCode(parsed, 'TI3321').blocks[1]).toMatchObject({
      weekday: 6,
      startsAt: '12:00',
      endsAt: '14:00',
    });
    expect(subjectByCode(parsed, 'EGC252').blocks[1]).toMatchObject({
      weekday: 4,
      startsAt: '19:00',
      endsAt: '22:00',
    });
  });

  it('lee creditos, seccion y profesor', () => {
    const parsed = parseUnibeSchedule(HORARIO_2027_1);
    const calculo = subjectByCode(parsed, 'EGC252');

    expect(calculo).toMatchObject({
      name: 'CÁLCULO VECTORIAL',
      section: '02',
      credits: 4,
      teacherCode: '776590',
      teacherName: 'LEZAMA TIMAURE, NEHOMAR GREGORI',
    });
  });

  it('extrae el rango de fechas del cuatrimestre', () => {
    const parsed = parseUnibeSchedule(HORARIO_2027_1);
    const calculo = subjectByCode(parsed, 'EGC252');

    expect(calculo.startsOn).toBe('2026-09-07');
    expect(calculo.endsOn).toBe('2026-12-19');
    expect(calculo.blocks[0]?.startsOn).toBe('2026-09-07');
  });

  it('acepta una asignatura sin ningun tramo', () => {
    // Educacion Constitucional esta matriculada pero no tiene horario impreso. Antes de
    // soportarlo, una fila sin celdas se llevaba por delante la fila siguiente.
    const parsed = parseUnibeSchedule(HORARIO_2027_1);

    expect(subjectByCode(parsed, 'UNB306')).toMatchObject({
      name: 'EDUCACIÓN CONSTITUCIONAL',
      credits: 3,
      blocks: [],
    });
  });

  it('reconoce las modalidades aunque el PDF las parta por la mitad', () => {
    const actual = parseUnibeSchedule(HORARIO_2027_1);
    const anterior = parseUnibeSchedule(HORARIO_2026_1);

    // "MODALIDAD:PRES" + "ENCIAL" y "MODALIDAD:SEMIP" + "RESENCIAL".
    expect(subjectByCode(actual, 'TI3210').blocks[0]?.modality).toBe('presencial');
    expect(subjectByCode(actual, 'TI3321').blocks[0]?.modality).toBe('semipresencial');
    // "MODALIDAD:100%" + "VIRTUAL HIBRIDA" + "[SINCRONICA/ASI" + "NCRONICA]".
    expect(subjectByCode(anterior, 'UNB200').blocks[0]?.modality).toBe('virtual');
    expect(anterior.warnings).toEqual([]);
  });

  it('marca como remota el aula virtual de una asignatura semipresencial', () => {
    // La modalidad de la asignatura y el aula de UN tramo concreto son cosas distintas:
    // Comunicacion II es semipresencial y el sabado se da en linea.
    const parsed = parseUnibeSchedule(HORARIO_2026_3);
    const comunicacion = subjectByCode(parsed, 'EGL121');

    expect(comunicacion.blocks[0]).toMatchObject({
      weekday: 2,
      modality: 'semipresencial',
      locationLabel: 'ING-001 [AULA]',
      isRemote: false,
    });
    expect(comunicacion.blocks[1]).toMatchObject({
      weekday: 6,
      modality: 'semipresencial',
      isRemote: true,
    });
    expect(comunicacion.blocks[1]?.locationLabel).toMatch(/^VIRTUAL/u);
  });

  it('lee la segunda pagina, que no repite la cabecera de dias', () => {
    // La universidad solo imprime "Lunes Martes..." una vez. Sin conservar las columnas
    // medidas en la primera pagina, todo lo de la segunda se pierde sin aviso.
    const parsed = parseUnibeSchedule(HORARIO_2026_1);
    const metodologia = subjectByCode(parsed, 'UNB200');

    expect(metodologia.name).toBe('METODOLOGÍA DE LA INVESTIGACIÓN');
    expect(metodologia.blocks.map((block) => block.weekday)).toEqual([1, 3]);
    expect(metodologia.blocks[0]).toMatchObject({ startsAt: '08:00', endsAt: '10:00' });
  });

  it('no confunde la ultima linea de un nombre largo con los creditos', () => {
    // "COMPUTACIONALES" cae a cuatro decimas de la etiqueta "Creditos:". Antes, el
    // nombre se cortaba en "...Y TECNOLOGIAS" y los creditos salian "COMPUTACIONALES".
    const parsed = parseUnibeSchedule(HORARIO_2026_1);

    expect(subjectByCode(parsed, 'TI3120')).toMatchObject({
      name: 'INTRODUCCIÓN A LA INGENIERÍA Y TECNOLOGÍAS COMPUTACIONALES',
      credits: 2,
      section: '02',
    });

    expect(subjectByCode(parseUnibeSchedule(HORARIO_2026_3), 'UNB303')).toMatchObject({
      name: 'EMPRENDIMIENTO PARA LA CREACIÓN DE NUEVOS NEGOCIOS (ELECTIVA PROF.)',
      credits: 3,
    });
  });

  it('acepta cero creditos sin confundirlo con "sin creditos"', () => {
    const parsed = parseUnibeSchedule(HORARIO_2026_1);

    expect(subjectByCode(parsed, 'EGL301').credits).toBe(0);
  });

  it('quita el espacio que el documento deja antes de la coma del profesor', () => {
    const parsed = parseUnibeSchedule(HORARIO_2026_2);

    expect(subjectByCode(parsed, 'TI3121').teacherName).toBe('FERNANDEZ, LINARDO DE JESUS');
  });

  it('lee los cuatro cuatrimestres sin un solo aviso', () => {
    for (const fixture of [HORARIO_2026_1, HORARIO_2026_2, HORARIO_2026_3, HORARIO_2027_1]) {
      const parsed = parseUnibeSchedule(fixture);

      expect(parsed.warnings).toEqual([]);
      expect(parsed.termCode).toMatch(/^\d{4}-\d$/u);
      expect(parsed.subjects.length).toBeGreaterThan(0);

      for (const subject of parsed.subjects) {
        expect(subject.name.length).toBeGreaterThan(0);
        for (const block of subject.blocks) {
          expect(block.startsAt < block.endsAt).toBe(true);
          expect(block.locationLabel.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('avisa en vez de romperse con un PDF que no es un horario', () => {
    const otro: readonly PdfTextItem[] = [
      { text: 'FACTURA', page: 1, x: 100, y: 700, width: 40, height: 10 },
      { text: 'Total: 1200', page: 1, x: 100, y: 680, width: 60, height: 10 },
    ];

    const parsed = parseUnibeSchedule(otro);

    expect(parsed.subjects).toEqual([]);
    expect(parsed.warnings.join(' ')).toMatch(/Lunes/u);
  });

  it('sigue leyendo aunque falte la columna de un dia', () => {
    // Un cuatrimestre sin clases en sabado podria no imprimir esa columna. Antes se
    // exigian los seis dias y la ausencia de uno dejaba el documento entero sin leer.
    const sinSabado = HORARIO_2027_1.filter((item) => !(item.text === 'Sábado' && item.y > 590));

    const parsed = parseUnibeSchedule(sinSabado);

    expect(parsed.subjects).toHaveLength(6);
    expect(parsed.termCode).toBe('2027-1');
    // La unica clase del sabado se pierde con su columna; el resto sigue entero.
    const total = parsed.subjects.reduce((count, subject) => count + subject.blocks.length, 0);
    expect(total).toBe(7);
  });

  it('no confunde un nombre de asignatura con la cabecera de dias', () => {
    // Si una asignatura se llamara "Taller de los Sabados", su palabra prestaria la
    // posicion a la columna del sabado y media tabla acabaria en el dia equivocado.
    // La cabecera se mide exigiendo que los rotulos compartan LINEA BASE.
    const conTrampa: readonly PdfTextItem[] = [
      ...HORARIO_2027_1,
      { text: 'Sábado', page: 1, x: 50.4, y: 300.0, width: 27.9, height: 6.3 },
      { text: 'Lunes', page: 1, x: 50.4, y: 250.0, width: 22.1, height: 6.3 },
    ];

    const conTrampaParsed = parseUnibeSchedule(conTrampa);
    const limpio = parseUnibeSchedule(HORARIO_2027_1);

    expect(conTrampaParsed.subjects.map((s) => s.blocks.map((b) => b.weekday))).toEqual(
      limpio.subjects.map((s) => s.blocks.map((b) => b.weekday)),
    );
  });

  it('no se traga la cabecera de la pagina como si fuera una clase', () => {
    // "HORARIO DE ESTUDIANTES" y "Semestre: 2027-1" caen justo en la banda de x de una
    // columna de dia. Sin el techo por encima de la primera asignatura, entrarian.
    const parsed = parseUnibeSchedule(HORARIO_2027_1);
    const total = parsed.subjects.reduce((count, subject) => count + subject.blocks.length, 0);

    expect(total).toBe(8);
  });
});
