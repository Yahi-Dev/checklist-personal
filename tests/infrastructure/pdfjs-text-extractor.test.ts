import { afterEach, describe, expect, it } from 'vitest';

import { isErr, unwrap } from '../../src/domain/shared/result';
import { PdfjsTextExtractor } from '../../src/infrastructure/pdf/pdfjs-text-extractor';

/**
 * El extractor de PDF, contra pdfjs DE VERDAD.
 *
 * Existe por un fallo concreto que llego al telefono y que ninguna otra prueba podia
 * ver: pdfjs usa `Promise.withResolvers` desde la primera linea y trae su propio relleno
 * dentro de la compilacion `legacy`, pero el empaquetador lo considera codigo muerto y lo
 * borra. En Chrome no se nota -lo tiene nativo desde hace tiempo-; en un iPhone con
 * Safari anterior al 17.4 la importacion del horario moria con un "No se pudo leer el
 * PDF" que no decia nada mas.
 *
 * De ahi la forma de estas pruebas: se BORRAN los metodos modernos de `Promise` antes de
 * llamar al extractor, que es la unica manera de reproducir aqui un navegador viejo.
 */

interface PromiseExtras {
  withResolvers?: unknown;
  try?: unknown;
}

const modern = Promise as PromiseConstructor & PromiseExtras;
const original = { withResolvers: modern.withResolvers, try: modern.try };

afterEach(() => {
  modern.withResolvers = original.withResolvers;
  modern.try = original.try;
});

/**
 * Un PDF minimo pero valido, con una linea de texto.
 *
 * Se construye aqui en vez de guardar un binario: son cuarenta lineas, no mete un
 * archivo opaco en el repositorio y deja a la vista exactamente que se esta leyendo.
 */
const buildPdf = (text: string): Uint8Array => {
  const content = `BT /F1 12 Tf 20 150 Td (${text}) Tj ET\n`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] ' +
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${String(content.length)} >>\nstream\n${content}endstream`,
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];

  for (const [index, object] of objects.entries()) {
    offsets.push(body.length);
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  }

  const xrefAt = body.length;
  let xref = `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }

  const trailer =
    `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\n` +
    `startxref\n${String(xrefAt)}\n%%EOF\n`;

  return new TextEncoder().encode(body + xref + trailer);
};

describe('PdfjsTextExtractor', () => {
  it('lee el texto y su posicion', async () => {
    const items = unwrap(await new PdfjsTextExtractor().extract(buildPdf('Lunes')));

    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.text).toBe('Lunes');
    expect(items[0]?.page).toBe(1);
    // Las coordenadas son lo que distingue el lunes del jueves: sin ellas no hay tabla.
    expect(items[0]?.x).toBeCloseTo(20, 0);
    expect(items[0]?.y).toBeCloseTo(150, 0);
  });

  it('funciona en un navegador sin Promise.withResolvers', async () => {
    // Safari < 17.4. Este es el caso que rompio la importacion en el iPhone.
    delete modern.withResolvers;

    const items = unwrap(await new PdfjsTextExtractor().extract(buildPdf('Martes')));

    expect(items[0]?.text).toBe('Martes');
  });

  it('funciona en un navegador sin Promise.try', async () => {
    // Safari < 18.2. Este relleno si sobrevivio al empaquetado, pero depender de la suerte
    // del arbol de dependencias no es una garantia.
    delete modern.try;

    const items = unwrap(await new PdfjsTextExtractor().extract(buildPdf('Miercoles')));

    expect(items[0]?.text).toBe('Miercoles');
  });

  it('funciona sin ninguno de los dos', async () => {
    delete modern.withResolvers;
    delete modern.try;

    const items = unwrap(await new PdfjsTextExtractor().extract(buildPdf('Jueves')));

    expect(items[0]?.text).toBe('Jueves');
  });

  it('rechaza un archivo vacio sin llamar a pdfjs', async () => {
    const result = await new PdfjsTextExtractor().extract(new Uint8Array());

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('VALIDATION');
  });

  it('dice QUE fallo cuando el archivo no es un PDF', async () => {
    // Un mensaje generico es indiagnosticable desde un telefono: fue justo lo que costo
    // encontrar el fallo de `Promise.withResolvers`.
    const result = await new PdfjsTextExtractor().extract(
      new TextEncoder().encode('esto no es un PDF'),
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toMatch(/^No se pudo leer el PDF: .+/u);
    }
  });
});
