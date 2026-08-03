import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/**
 * Configuracion de ESLint.
 *
 * La parte que de verdad importa es `eslint-plugin-boundaries`: convierte la
 * arquitectura por capas en una regla que el linter puede comprobar.
 *
 * Sin ella, "el dominio no importa infraestructura" es una buena intencion escrita en
 * un README, y basta un autoimport distraido del editor para que un dia el dominio
 * dependa de Supabase. Con ella, ese import falla en el build y en el CI.
 *
 * La direccion permitida es siempre hacia dentro:
 *
 *   app -> pages -> widgets -> features -> application -> domain
 *                                   \
 *                                    -> infrastructure -> application -> domain
 */
export default tseslint.config(
  { ignores: ['dist', 'dist-electron', 'release', 'coverage', 'node_modules', 'supabase/functions'] },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  /* Las reglas con informacion de tipos necesitan que el archivo pertenezca a un
     proyecto de TypeScript. Los .js y .mjs (esta misma configuracion, los scripts de
     build) no lo estan, asi que hay que apagarlas ahi o ESLint no arranca. */
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.es2023 },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },

    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      boundaries,
    },

    settings: {
      /**
       * Sin esto, la comprobacion de arquitectura NO FUNCIONA y ademas lo hace en
       * silencio.
       *
       * `boundaries` resuelve cada import a un archivo real para saber a que capa
       * pertenece. El resolutor por defecto solo entiende `.js`, asi que
       * `../../infrastructure/persistence/database` no resuelve a ningun archivo, el
       * destino queda como "elemento desconocido" y ninguna politica llega a
       * evaluarse: el linter pasa en verde con el dominio importando Supabase.
       */
      'import/resolver': {
        typescript: { project: './tsconfig.app.json' },
      },

      'boundaries/include': ['src/**/*'],
      // `main.tsx` es el arranque: por definicion toca todas las capas para montar la
      // app. Analizarlo solo produciria ruido sin detectar nada util.
      'boundaries/ignore': ['src/main.tsx', 'src/vite-env.d.ts'],
      // El patron nombra la CARPETA que es la capa; todo lo que cuelga de ella
      // pertenece a esa capa.
      'boundaries/elements': [
        { type: 'domain', pattern: 'src/domain' },
        { type: 'application', pattern: 'src/application' },
        { type: 'infrastructure', pattern: 'src/infrastructure' },
        { type: 'shared', pattern: 'src/shared' },
        { type: 'features', pattern: 'src/features' },
        { type: 'widgets', pattern: 'src/widgets' },
        { type: 'pages', pattern: 'src/pages' },
        { type: 'app', pattern: 'src/app' },
        { type: 'service-worker', pattern: 'src/service-worker' },
      ],
    },

    rules: {
      ...reactHooks.configs.recommended.rules,

      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // --- Arquitectura ---------------------------------------------------
      'boundaries/dependencies': [
        'error',
        {
          // Todo lo que no este permitido explicitamente, se rechaza.
          default: 'disallow',
          policies: [
            // Los paquetes de node_modules los puede usar cualquier capa.
            { allow: { to: { module: { origin: 'external' } } } },

            // El dominio es el nucleo: no depende de nada mas que de si mismo.
            {
              from: { element: { type: 'domain' } },
              allow: { to: { element: { type: 'domain' } } },
            },

            // La aplicacion orquesta el dominio a traves de sus puertos.
            {
              from: { element: { type: 'application' } },
              allow: { to: { element: { types: { anyOf: ['domain', 'application'] } } } },
            },

            // La infraestructura implementa los puertos. Usa `shared` solo para la
            // configuracion de entorno (app-config).
            {
              from: { element: { type: 'infrastructure' } },
              allow: {
                to: {
                  element: {
                    types: { anyOf: ['domain', 'application', 'infrastructure', 'shared'] },
                  },
                },
              },
            },

            // `shared` es transversal, pero solo mira hacia dentro.
            {
              from: { element: { type: 'shared' } },
              allow: {
                to: { element: { types: { anyOf: ['domain', 'shared', 'infrastructure'] } } },
              },
            },

            // Las capas de interfaz pueden usar todo lo que tienen por debajo.
            {
              from: {
                element: { types: { anyOf: ['features', 'widgets', 'pages', 'app'] } },
              },
              allow: {
                to: {
                  element: {
                    types: {
                      anyOf: [
                        'domain',
                        'application',
                        'infrastructure',
                        'shared',
                        'features',
                        'widgets',
                        'pages',
                        'app',
                      ],
                    },
                  },
                },
              },
            },

            // El service worker corre fuera de React: solo contratos compartidos.
            {
              from: { element: { type: 'service-worker' } },
              allow: { to: { element: { types: { anyOf: ['shared', 'service-worker'] } } } },
            },
          ],
        },
      ],

      // --- TypeScript ------------------------------------------------------
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // Las promesas sin await son la fuente numero uno de bugs silenciosos en una
      // app con sincronizacion: hay que marcarlas con `void` de forma explicita.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],

      /* Apagadas a conciencia, cada una por un motivo concreto:

         - `no-unnecessary-type-parameters` marca como error el idioma estandar de los
           ayudantes de tipado (`brandId<T>`, `IdGenerator.next<T>`, `db.getMeta<T>`),
           donde el parametro existe justo para que quien llama elija el tipo de salida.

         - `require-await` castiga a los adaptadores que implementan una interfaz
           asincrona sin nada que esperar: el servicio local sin nube, los repositorios
           en memoria, el objeto nulo de notificaciones. Quitarles el `async` romperia
           el contrato; meterles un `await` inutil seria peor.

         - `non-nullable-type-assertion-style` pide usar `!`, que esta prohibido por
           `no-non-null-assertion`. Se conserva la regla mas segura de las dos. */
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',

      // Demasiado ruidosas para el valor que aportan en este proyecto.
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true, allowNullish: true },
      ],
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': [
        'error',
        { ignoreConditionalTests: true, ignoreMixedLogicalExpressions: true },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',

      // --- Generales -------------------------------------------------------
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'prefer-const': 'error',
      'no-param-reassign': 'error',
    },
  },

  /**
   * El sistema de diseño exporta a proposito primitivas ademas de componentes
   * (`DialogTrigger`, variantes de `cva`, constantes de estilo). Es lo normal en un
   * barrel de UI y la regla de Fast Refresh no sabe distinguirlo.
   */
  {
    files: ['src/shared/ui/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },

  /* Un proveedor de contexto y su hook (`AuthProvider` + `useAuth`) van juntos en el
     mismo archivo: es el patron canonico de React y separarlos solo para contentar a
     Fast Refresh dispersaria el contexto en el doble de archivos. */
  {
    files: ['src/app/providers/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },

  /**
   * Las pruebas y sus dobles se saltan varias reglas a proposito:
   *  - `boundaries`: los dobles cruzan capas por definicion.
   *  - `require-await`: un repositorio en memoria implementa una interfaz asincrona
   *    sin nada que esperar; obligarle a un `await` inutil seria ruido.
   *  - aserciones: en un test, afirmar que algo existe ES la comprobacion.
   */
  {
    files: ['tests/**/*.{ts,tsx}', '**/*.test.{ts,tsx}', 'vitest.setup.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'boundaries/dependencies': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },

  // Proceso principal de Electron: es Node, no navegador.
  {
    files: ['electron/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'boundaries/dependencies': 'off',
      'no-console': 'off',
    },
  },

  // Scripts de build.
  {
    files: ['scripts/**/*.mjs', '*.config.{ts,js}'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
);
