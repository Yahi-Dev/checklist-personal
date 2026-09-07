import type * as Pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PdfTextExtractor, PdfTextItem } from '../../application/ports/services';
import type { Result } from '../../domain/shared/result';
import { DomainErrors } from '../../domain/shared/domain-error';
import { err, fromPromise } from '../../domain/shared/result';
import { toDomainError } from '../../domain/shared/domain-error';

/**
 * Extractor de texto posicionado con pdfjs.
 *
 * Dos decisiones que no son obvias y que sostienen todo lo demas:
 *
 * 1. **pdfjs se carga con `import()` dinamico, nunca arriba.** Son mas de un megabyte
 *    de codigo para una funcion que se usa una vez por cuatrimestre. Con el import
 *    estatico, Rollup lo mete en el arranque y la app tarda mas en abrir SIEMPRE, para
 *    todo el mundo, incluido quien no importe un horario jamas. Con el dinamico queda
 *    en su propio trozo y no se descarga hasta que hace falta.
 *
 * 2. **Se importa tambien el worker, y eso es lo que hace que NO haya worker.** Al
 *    cargar `pdf.worker.mjs` en el hilo principal, el modulo deja su manejador en
 *    `globalThis.pdfjsWorker`, y pdfjs detecta que ya lo tiene y trabaja ahi mismo en
 *    vez de arrancar un `Worker`. Parece un rodeo, pero evita tres problemas de golpe:
 *
 *      - En Electron la app se sirve por `file://`, cuyo origen es opaco, y Chromium
 *        rechaza construir un `Worker` desde ahi.
 *      - En GitHub Pages el sitio vive bajo `/checklist-personal/`, asi que cualquier
 *        `workerSrc` absoluto apuntaria fuera del sitio.
 *      - El archivo del worker se distribuye como `.mjs`, extension que el precache del
 *        service worker no recoge, de modo que en la PWA sin conexion no estaria.
 *
 *    El precio es que el PDF se analiza en el hilo de la interfaz. Para un documento de
 *    una o dos paginas son unas decenas de milisegundos: ni se ve. Si algun dia hubiera
 *    que leer documentos grandes, aqui es donde entraria un worker de verdad.
 */

/** Tope de tamaño. Un horario de UNIBE pesa unos 30 KB; 10 MB es un PDF equivocado. */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

let pdfjsPromise: Promise<typeof Pdfjs> | null = null;

const loadPdfjs = async (): Promise<typeof Pdfjs> => {
  pdfjsPromise ??= (async () => {
    const [library] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      // Solo por su efecto: define `globalThis.pdfjsWorker`. Ver la cabecera.
      import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ]);

    return library;
  })();

  return pdfjsPromise;
};

export class PdfjsTextExtractor implements PdfTextExtractor {
  async extract(bytes: Uint8Array): Promise<Result<readonly PdfTextItem[]>> {
    if (bytes.byteLength === 0) {
      return err(DomainErrors.validation('El archivo esta vacio.', { field: 'file' }));
    }

    if (bytes.byteLength > MAX_PDF_BYTES) {
      return err(
        DomainErrors.validation('El archivo pesa demasiado para ser un horario.', {
          field: 'file',
          details: { bytes: bytes.byteLength, max: MAX_PDF_BYTES },
        }),
      );
    }

    return fromPromise(readItems(bytes), (cause) =>
      toDomainError(cause, 'No se pudo leer el PDF. Comprueba que no este protegido con clave.'),
    );
  }
}

const readItems = async (bytes: Uint8Array): Promise<readonly PdfTextItem[]> => {
  const pdfjs = await loadPdfjs();

  /* Se pasa una COPIA: pdfjs se queda con el buffer y lo deja inservible, y quien nos
     llamo puede querer reintentar con los mismos bytes tras un error. */
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    /* No se van a dibujar paginas, solo a leer texto: ni fuentes del sistema ni lienzo
       fuera de pantalla. Cargar las fuentes es la parte cara de abrir un PDF y aqui no
       aporta nada. */
    useSystemFonts: false,
    isOffscreenCanvasSupported: false,
  });

  const document = await task.promise;

  try {
    const items: PdfTextItem[] = [];

    for (let page = 1; page <= document.numPages; page += 1) {
      const rendered = await document.getPage(page);
      const content = await rendered.getTextContent();

      for (const item of content.items) {
        if (!('str' in item)) continue;
        if (item.str.trim().length === 0) continue;

        /* `transform` es la matriz de la posicion: [a, b, c, d, e, f], donde `e` y `f`
           son el desplazamiento, o sea la esquina del fragmento en la pagina. pdfjs la
           declara sin tipar el contenido, de ahi el estrechamiento explicito. */
        const transform = item.transform as readonly unknown[];
        const x = transform[4];
        const y = transform[5];
        if (typeof x !== 'number' || typeof y !== 'number') continue;

        items.push({
          text: item.str,
          page,
          x,
          y,
          width: item.width,
          height: item.height,
        });
      }

      rendered.cleanup();
    }

    return items;
  } finally {
    // Es la TAREA la que se destruye, no el documento: el proxy del documento no
    // expone `destroy`, y sin esto el analizador se queda vivo tras cada importacion.
    await task.destroy();
  }
};
