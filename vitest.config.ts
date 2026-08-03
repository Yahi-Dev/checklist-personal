import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolvePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

/**
 * Configuracion de pruebas.
 *
 * `jsdom` como entorno global aunque la mayoria de las pruebas sean del dominio puro:
 * las de infraestructura necesitan IndexedDB (via `fake-indexeddb`) y las de UI
 * necesitan DOM. Tener dos entornos separados obliga a recordar cual toca en cada
 * archivo, y equivocarse produce errores crípticos.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': resolvePath('./src'),
      '@domain': resolvePath('./src/domain'),
      '@application': resolvePath('./src/application'),
      '@infrastructure': resolvePath('./src/infrastructure'),
      '@features': resolvePath('./src/features'),
      '@widgets': resolvePath('./src/widgets'),
      '@pages': resolvePath('./src/pages'),
      '@shared': resolvePath('./src/shared'),
      '@app': resolvePath('./src/app'),
    },
  },

  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    css: false,

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/domain/**', 'src/application/**'],
      // Solo se exige cobertura donde vive la logica de negocio. Perseguir el 100% en
      // componentes de React produce pruebas que comprueban el marcado y se rompen con
      // cada cambio de estilo, sin detectar ni un bug real.
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
