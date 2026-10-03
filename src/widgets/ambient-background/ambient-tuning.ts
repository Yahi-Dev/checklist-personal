/**
 * Cuanto se nota el fondo de tinta y donde se carga.
 *
 * Separado del componente para que Fast Refresh pueda recargarlo, y para que las
 * pruebas comparen contra estos mismos valores en vez de copiarlos.
 */

export type AmbientVariant = 'login' | 'app';

/**
 * Donde se carga la tinta: pantalla grande, raton y movimiento permitido.
 *
 * En el telefono la bateria vale mas que el efecto, asi que ni se descarga three.js;
 * queda el degradado estatico. `pointer: fine` deja fuera tambien las tablets, que son
 * igual de dependientes de la bateria. Y con «reducir movimiento» LiquidEther no
 * dibujaria nada: mejor no gastar la descarga.
 */
export const INK_MEDIA_QUERY =
  '(min-width: 1024px) and (pointer: fine) and (prefers-reduced-motion: no-preference)';

export interface InkTuning {
  /** Opacidad de la capa de tinta: la intensidad que se ve. */
  readonly opacity: number;
  readonly mouseForce: number;
  /** Radio del puntero en celdas de simulacion; a menos resolucion, celdas mas grandes. */
  readonly cursorSize: number;
  readonly autoSpeed: number;
  readonly autoIntensity: number;
  /** Fraccion del lienzo que simula el fluido. */
  readonly resolution: number;
  readonly iterationsPoisson: number;
}

/**
 * Cuanto se nota la tinta en cada pantalla.
 *
 * En el login es la protagonista y lleva los valores del original. En los modulos
 * acompaña: menos opacidad, menos fuerza y un cuarto de resolucion con la mitad de
 * iteraciones. Detras del velo la diferencia de resolucion no se ve, y gasta unas
 * cuatro veces menos GPU en la pantalla que se queda abierta todo el dia. El radio del
 * puntero baja con la resolucion para que el pincel mida en pantalla lo mismo.
 *
 * Todo esto lo lee LiquidEther en cada fotograma, salvo la resolucion, que redimensiona
 * las texturas de la simulacion: ninguno de estos cambios crea un contexto nuevo.
 */
export const INK_TUNING: Readonly<Record<AmbientVariant, InkTuning>> = {
  login: {
    opacity: 1,
    mouseForce: 18,
    cursorSize: 110,
    autoSpeed: 0.4,
    autoIntensity: 2,
    resolution: 0.5,
    iterationsPoisson: 32,
  },
  app: {
    opacity: 0.75,
    mouseForce: 10,
    cursorSize: 50,
    autoSpeed: 0.35,
    autoIntensity: 1.6,
    resolution: 0.25,
    iterationsPoisson: 16,
  },
};
