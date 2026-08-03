import { toast } from 'sonner';

/**
 * Registro del service worker y aviso de version nueva.
 *
 * La actualizacion NO se aplica sola. Recargar por sorpresa mientras alguien escribe
 * una tarea le borra lo que llevaba; en su lugar se avisa y se recarga cuando el
 * usuario decide.
 */
export const registerServiceWorker = (): void => {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  void (async () => {
    try {
      // Import dinamico: `virtual:pwa-register` solo existe cuando el plugin de PWA
      // esta activo, es decir, en la build web y no en la de Electron.
      const { registerSW } = await import('virtual:pwa-register');

      const updateApp = registerSW({
        immediate: true,

        onNeedRefresh() {
          toast('Hay una version nueva', {
            duration: Number.POSITIVE_INFINITY,
            action: {
              label: 'Actualizar',
              onClick: () => {
                void updateApp(true);
              },
            },
          });
        },

        onOfflineReady() {
          console.info('[pwa] lista para funcionar sin conexion');
        },

        onRegisterError(error: unknown) {
          console.error('[pwa] no se pudo registrar el service worker', error);
        },
      });
    } catch (error) {
      console.info('[pwa] service worker no disponible en este entorno', error);
    }
  })();
};
