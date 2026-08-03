import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const resolvePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

const require = createRequire(import.meta.url);
const packageJson = require('./package.json') as { version: string };

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isElectron = env.VITE_TARGET === 'electron';

  return {
    /* La version se inyecta en compilacion: asi la interfaz puede mostrarla y el
       respaldo dejarla anotada, sin importar package.json desde el cliente (lo que
       arrastraria todo el archivo al bundle). */
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version),
    },

    /* Electron sirve desde file://, por lo que necesita rutas relativas.
       El build web respeta VITE_PUBLIC_BASE (GitHub Pages usa `/<repo>/`). */
    base: isElectron ? './' : (env.VITE_PUBLIC_BASE ?? '/'),

    resolve: {
      alias: {
        /* En Electron el modulo virtual de la PWA no existe porque el plugin esta
           desactivado. El empaquetador resuelve los imports antes de que corra ningun
           `try/catch`, asi que sin este alias la compilacion de escritorio falla. */
        ...(isElectron
          ? { 'virtual:pwa-register': resolvePath('./src/service-worker/pwa-register-stub.ts') }
          : {}),

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

    plugins: [
      react(),
      tailwindcss(),
      /* El service worker solo tiene sentido en la build web (la PWA del iPhone).
         Dentro de Electron estorba: intercepta file:// y no aporta nada. */
      ...(isElectron
        ? []
        : [
            VitePWA({
              registerType: 'prompt',
              injectRegister: null,
              strategies: 'injectManifest',
              srcDir: 'src/service-worker',
              filename: 'sw.ts',
              injectManifest: {
                globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
                maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
              },
              devOptions: {
                enabled: false,
                type: 'module',
              },
              manifest: {
                // Relativo, igual que `start_url` y `scope`. Con `'/'` absoluto la
                // identidad de la app apuntaria a la raiz del dominio, fuera de su
                // propio ambito en GitHub Pages, donde vive bajo /checklist-personal/.
                id: '.',
                name: 'Checklist Personal',
                short_name: 'Checklist',
                description:
                  'Tus tareas del dia a dia, sincronizadas entre el telefono y la computadora.',
                lang: 'es',
                dir: 'ltr',
                start_url: '.',
                scope: '.',
                display: 'standalone',
                display_override: ['window-controls-overlay', 'standalone'],
                orientation: 'portrait-primary',
                background_color: '#0b0f19',
                theme_color: '#0b0f19',
                categories: ['productivity', 'utilities'],
                icons: [
                  { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
                  { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
                  {
                    src: 'icons/icon-maskable-512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'maskable',
                  },
                ],
                shortcuts: [
                  {
                    name: 'Nueva tarea',
                    short_name: 'Nueva',
                    url: './#/hoy?nueva=1',
                    icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }],
                  },
                  {
                    name: 'Hoy',
                    short_name: 'Hoy',
                    url: './#/hoy',
                    icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }],
                  },
                ],
              },
            }),
          ]),
    ],

    build: {
      target: 'es2022',
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: mode !== 'production',
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          /* Separar los vendors pesados evita invalidar todo el cache en cada deploy:
             cambiar una linea de la app no deberia obligar al telefono a volver a
             descargar React entero.

             Se usa la forma de FUNCION porque Rollup 5 retiro la forma de objeto. */
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;

            if (/[\\/]node_modules[\\/](react|react-dom|react-router)/.test(id)) return 'react';
            if (id.includes('@supabase')) return 'supabase';
            if (id.includes('recharts') || id.includes('d3-')) return 'charts';
            if (id.includes('dexie')) return 'db';

            return undefined;
          },
        },
      },
    },

    server: {
      port: 5173,
      strictPort: true,
      host: true,
    },

    preview: {
      port: 4173,
      host: true,
    },
  };
});
