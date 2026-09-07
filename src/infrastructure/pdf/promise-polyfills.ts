/**
 * Los dos metodos de `Promise` que pdfjs da por hechos y Safari puede no tener.
 *
 * pdfjs trae su propio relleno de core-js dentro de la compilacion `legacy`, y esa es la
 * razon de usar esa y no la normal. El problema es que ese relleno se instala llamando a
 * una funcion cuyo resultado nadie usa, asi que el empaquetador lo considera codigo
 * muerto y lo BORRA. Se comprueba sobre el bundle ya compilado y el resultado es
 * exactamente ese: `Promise.try` sobrevive y `Promise.withResolvers` no.
 *
 * El fallo que provoca es de manual: en escritorio no se ve -Chrome tiene los dos desde
 * hace tiempo- y en el iPhone la importacion del horario muere con "No se pudo leer el
 * PDF" en cuanto el Safari es anterior a 17.4, que es cuando llego `withResolvers`.
 *
 * De ahi que se rellenen aqui, a mano y antes de cargar pdfjs. Son ocho lineas, no
 * dependen de nada y solo actuan si de verdad faltan.
 */

interface PromiseWithResolvers<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

type PromiseConstructorWithExtras = PromiseConstructor & {
  withResolvers?: <T>() => PromiseWithResolvers<T>;
  try?: <T>(callback: (...args: unknown[]) => T, ...args: unknown[]) => Promise<Awaited<T>>;
};

export const installPromisePolyfills = (): void => {
  const target = Promise as PromiseConstructorWithExtras;

  if (typeof target.withResolvers !== 'function') {
    target.withResolvers = function withResolvers<T>(): PromiseWithResolvers<T> {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;

      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });

      return { promise, resolve, reject };
    };
  }

  if (typeof target.try !== 'function') {
    target.try = function attempt<T>(
      callback: (...args: unknown[]) => T,
      ...args: unknown[]
    ): Promise<Awaited<T>> {
      // `new Promise` y no `Promise.resolve().then(...)`: `Promise.try` tiene que
      // ejecutar el callback DE INMEDIATO y convertir en rechazo lo que lance, no
      // aplazarlo a la siguiente vuelta del bucle de eventos.
      return new Promise<Awaited<T>>((resolve) => {
        resolve(callback(...args) as Awaited<T>);
      });
    };
  }
};
