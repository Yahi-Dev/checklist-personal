import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Preparacion comun de las pruebas.
 *
 * `fake-indexeddb/auto` instala una implementacion en memoria de IndexedDB, que es lo
 * que permite ejercitar los repositorios de Dexie de verdad -con transacciones y con
 * indices- en vez de sustituirlos por dobles. Una prueba contra un repositorio falso
 * no habria detectado nunca un indice compuesto mal declarado.
 */

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// jsdom no implementa matchMedia y el proveedor de tema lo usa en el primer render.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

// Tampoco implementa ResizeObserver, que usan Radix y Recharts.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// jsdom no trae `crypto.randomUUID` en todas las versiones.
if (globalThis.crypto?.randomUUID === undefined) {
  Object.defineProperty(globalThis.crypto ?? {}, 'randomUUID', {
    value: () =>
      `00000000-0000-4000-8000-${Math.floor(Math.random() * 1e12)
        .toString()
        .padStart(12, '0')}`,
  });
}
