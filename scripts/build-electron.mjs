#!/usr/bin/env node
/**
 * Compila los procesos principal y de precarga de Electron.
 *
 * Se usa esbuild directamente en vez de un plugin de Vite a proposito: la build web
 * (la PWA del iPhone) y la de escritorio tienen objetivos muy distintos -una va a un
 * navegador, la otra a Node 22- y mezclarlas en una sola configuracion acaba siempre
 * en condicionales por todas partes.
 *
 * Salida en formato CJS aunque package.json diga `"type": "module"`: el proceso
 * principal de Electron carga el preload con `require`, y un preload en ESM
 * sencillamente no se carga.
 *
 *   node scripts/build-electron.mjs           compila una vez
 *   node scripts/build-electron.mjs --watch    recompila al guardar
 */
import { build, context } from 'esbuild';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { dependencies = {}, version } = require('../package.json');

const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  platform: 'node',
  // Electron 38 trae Node 22: se puede compilar a algo moderno sin transpilar de mas.
  target: 'node22',
  format: 'cjs',
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  sourcemap: isWatch ? 'inline' : false,
  minify: !isWatch,
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': JSON.stringify(isWatch ? 'development' : 'production'),
    'process.env.npm_package_version': JSON.stringify(version),
  },
  // `electron` lo aporta el runtime; las dependencias del renderer no pintan nada aqui.
  external: ['electron', ...Object.keys(dependencies)],
};

const targets = [
  { ...shared, entryPoints: ['electron/main.ts'] },
  { ...shared, entryPoints: ['electron/preload.ts'] },
];

if (isWatch) {
  const contexts = await Promise.all(targets.map((options) => context(options)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log('[electron] vigilando cambios en electron/...');
} else {
  await Promise.all(targets.map((options) => build(options)));
  console.log('[electron] compilado en dist-electron/');
}
