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

/**
 * Las pruebas corren SIEMPRE en modo local, con independencia del `.env` de la maquina.
 *
 * Vite carga el `.env` del proyecto tambien al ejecutar Vitest, asi que en cuanto un
 * desarrollador configura Supabase de verdad, `appConfig.supabase.isConfigured` pasa a
 * ser cierto y la app arranca pidiendo sesion. La prueba de humo del arranque se queda
 * entonces mirando la pantalla de acceso y falla, mientras que en CI -donde no hay
 * `.env`- sigue en verde. Es el peor tipo de fallo: depende de quien ejecute la suite.
 *
 * Se vacian aqui y no en cada prueba porque ninguna prueba debe hablar con la nube:
 * las de infraestructura usan IndexedDB en memoria y las del asistente, un doble.
 */
vi.stubEnv('VITE_SUPABASE_URL', '');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');

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
