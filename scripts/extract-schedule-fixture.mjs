/**
 * Regenera `tests/support/unibe-schedule-fixture.ts` a partir de los PDFs reales.
 *
 * El fixture es la entrada exacta que recibe el parser -fragmentos de texto con
 * coordenadas-, asi que las pruebas ejercitan el codigo de verdad sin arrastrar pdfjs
 * ni un binario al repositorio. Cuando llegue el horario de un cuatrimestre nuevo,
 * basta con añadirlo a SOURCES y volver a ejecutar esto.
 *
 *   node scripts/extract-schedule-fixture.mjs
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const SOURCES = [
  [
    'HORARIO_2026_1',
    'C:/Users/yahin/Desktop/UNIBE/Horario/Primer cuatrimestre/Horario-26-1029.pdf',
  ],
  [
    'HORARIO_2026_2',
    'C:/Users/yahin/Desktop/UNIBE/Horario/Segundo cuatrimestre/Horario-26-1029 (1).pdf',
  ],
  [
    'HORARIO_2026_3',
    'C:/Users/yahin/Desktop/UNIBE/Horario/Tercer cuatrimestre/Horario-26-1029 (2).pdf',
  ],
  ['HORARIO_2027_1', 'C:/Users/yahin/Downloads/Horario-26-1029 (2) (1).pdf'],
];

const round = (n) => Math.round(n * 10) / 10;

async function extract(file) {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true })
    .promise;
  const rows = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      if (it.str.trim() === '') continue;
      const [, , , , x, y] = it.transform;
      rows.push([p, round(x), round(y), round(it.width), round(it.height), it.str]);
    }
  }
  return rows;
}

let out = '';
let total = 0;
for (const [name, file] of SOURCES) {
  const rows = await extract(file);
  total += rows.length;
  out += `\nexport const ${name}: readonly PdfTextItem[] = toItems([\n`;
  out += rows
    .map((r) => `  [${r[0]}, ${r[1]}, ${r[2]}, ${r[3]}, ${r[4]}, ${JSON.stringify(r[5])}],`)
    .join('\n');
  out += '\n]);\n';
  console.error(name, rows.length, 'items');
}
console.error('TOTAL', total);
writeFileSync('./tests/support/unibe-schedule-fixture.body.txt', out);
console.error('Escrito el cuerpo en tests/support/unibe-schedule-fixture.body.txt.');
console.error('Pegalo bajo la cabecera de tests/support/unibe-schedule-fixture.ts.');
