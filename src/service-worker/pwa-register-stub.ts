/**
 * Sustituto de `virtual:pwa-register` para la build de escritorio.
 *
 * El modulo virtual solo existe cuando `vite-plugin-pwa` esta activo, y en Electron el
 * plugin se desactiva a proposito: un service worker interceptando `file://` no aporta
 * nada y entorpece la carga.
 *
 * El `try/catch` que rodea el import dinamico en `register.ts` cubre el fallo en
 * ejecucion, pero el empaquetador resuelve los imports ANTES de que ese catch exista,
 * asi que sin este stub la compilacion se cae. Se enlaza por alias desde
 * `vite.config.ts` cuando el objetivo es Electron.
 */

export interface RegisterSWOptions {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisterError?: (error: unknown) => void;
}

/** No hace nada y devuelve una funcion de actualizacion inerte. */
export const registerSW = (_options?: RegisterSWOptions): ((reload?: boolean) => Promise<void>) => {
  return async () => undefined;
};
