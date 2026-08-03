/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { createHandlerBoundToURL } from 'workbox-precaching';

/**
 * Service worker de la PWA.
 *
 * Hace dos trabajos distintos:
 *
 * 1. CACHE. Precachea el bundle para que la app abra sin conexion. Los DATOS no pasan
 *    por aqui: viven en IndexedDB, que es la fuente de verdad. Cachear tambien las
 *    respuestas de Supabase daria dos capas de cache compitiendo por decidir cual es
 *    la version buena.
 *
 * 2. WEB PUSH. Es lo unico capaz de despertar la app cerrada en el iPhone. El evento
 *    `push` llega aunque la PWA lleve horas sin abrirse.
 */

declare const self: ServiceWorkerGlobalScope & {
  /* `injectManifest` de Workbox sustituye esta variable por la lista real de archivos
     durante el build. En tiempo de desarrollo no existe, de ahi la declaracion. */
  readonly __WB_MANIFEST: { url: string; revision: string | null }[];
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

/**
 * Toda navegacion devuelve index.html. La app usa enrutado por hash, asi que un solo
 * documento cubre todas las rutas.
 */
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

/**
 * LA VERSION NUEVA ESPERA. NO SE ACTIVA SOLA.
 *
 * Aqui habia un `self.skipWaiting()` suelto, y era un fallo que rompia la app instalada
 * en cada despliegue. Merece explicarse porque parece inofensivo:
 *
 * La pagina que ya esta abierta corre el JavaScript VIEJO, y sus rutas perezosas piden
 * trozos con el hash viejo (`upcoming-page-ABC123.js`). Al activarse de golpe, el
 * service worker nuevo precachea solo los trozos NUEVOS y `cleanupOutdatedCaches`
 * borra los anteriores. En GitHub Pages cada despliegue reemplaza el sitio entero, asi
 * que esos archivos tampoco estan ya en el servidor. Resultado: la primera navegacion a
 * una pantalla que aun no se habia abierto pide un archivo que no existe ni en cache ni
 * en la red, y la app muere con "Importing a module script failed".
 *
 * Peor todavia: con `skipWaiting` al instalar, el worker nunca pasa por el estado
 * "waiting", asi que `onNeedRefresh` NUNCA se dispara y el aviso de "hay una version
 * nueva" no llega a aparecer. La actualizacion que el comentario anterior daba por
 * negociada con el usuario ocurria a sus espaldas.
 *
 * Ahora el worker nuevo espera. La pestaña vieja sigue con sus archivos viejos, que
 * siguen en su cache. Cuando el usuario acepta el aviso, `updateApp(true)` manda
 * SKIP_WAITING y recarga: la pagina y el service worker cambian de version A LA VEZ.
 */
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

// Se conserva: al activarse -ya con permiso del usuario- toma el control de las
// pestañas abiertas sin exigir un segundo cierre.
clientsClaim();

// ---------------------------------------------------------------------------
// Notificaciones push
// ---------------------------------------------------------------------------

interface PushPayload {
  title: string;
  body: string;
  taskId?: string;
  deepLink?: string;
  tag?: string;
}

self.addEventListener('push', (event: PushEvent) => {
  if (event.data == null) return;

  let payload: PushPayload;

  try {
    payload = event.data.json() as PushPayload;
  } catch {
    // Un push sin JSON valido igualmente tiene que mostrar algo: en iOS, un push
    // recibido y NO mostrado puede costar el permiso de notificaciones de la app.
    payload = { title: 'Checklist Personal', body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: './icons/icon-192.png',
      badge: './icons/badge-72.png',
      // El tag hace que un recordatorio reemplace al anterior de la misma tarea en
      // lugar de apilarse.
      tag: payload.tag ?? payload.taskId ?? 'checklist',
      data: { deepLink: payload.deepLink ?? '#/hoy' },
      requireInteraction: false,
    }),
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();

  const target =
    (event.notification.data as { deepLink?: string } | undefined)?.deepLink ?? '#/hoy';

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // Reutilizar una ventana ya abierta en vez de abrir otra: si no, cada
      // notificacion pulsada dejaria una pestaña nueva.
      for (const client of clientList) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            await client.navigate(`${self.registration.scope}${target}`).catch(() => undefined);
          }
          return;
        }
      }

      await self.clients.openWindow(`${self.registration.scope}${target}`);
    })(),
  );
});

// Mensajes desde la app (por ejemplo, forzar la activacion de una version nueva).
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if ((event.data as { type?: string })?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});
