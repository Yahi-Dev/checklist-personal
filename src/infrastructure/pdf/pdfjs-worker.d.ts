/**
 * El worker de pdfjs no trae tipos y aqui solo se importa por su efecto: al cargarse
 * deja su manejador en `globalThis.pdfjsWorker`, que es lo que hace que pdfjs trabaje en
 * el hilo principal en vez de arrancar un `Worker`. Ver `pdfjs-text-extractor.ts`.
 */
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs';
