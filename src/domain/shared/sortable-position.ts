/**
 * Indexacion fraccionaria para el orden manual de las tareas.
 *
 * El enfoque ingenuo es guardar `position` como entero: mover un elemento obliga a
 * reescribir todas las filas siguientes. Con sincronizacion eso es un desastre: dos
 * dispositivos reordenando a la vez generan escrituras que chocan en cada fila.
 *
 * Aqui la posicion es un `number` de punto flotante y para insertar entre A y B se
 * usa el punto medio. Mover un elemento toca UNA sola fila, y dos dispositivos que
 * reordenan en paralelo casi nunca se pisan.
 */

/** Separacion inicial entre elementos, para que quepan muchas inserciones. */
const STEP = 1024;

/**
 * A esta distancia dos posiciones consecutivas ya no se pueden partir con precision
 * de coma flotante fiable. Es el umbral que dispara el rebalanceo.
 */
const MIN_GAP = 1e-6;

export const firstPosition = (): number => STEP;

/** Posicion para insertar al final de la lista. */
export const positionAfterLast = (positions: readonly number[]): number => {
  if (positions.length === 0) return firstPosition();
  return Math.max(...positions) + STEP;
};

/** Posicion para insertar al inicio de la lista. */
export const positionBeforeFirst = (positions: readonly number[]): number => {
  if (positions.length === 0) return firstPosition();
  return Math.min(...positions) - STEP;
};

/**
 * Posicion entre dos vecinas. `undefined` significa "no hay vecino por ese lado".
 * Devuelve `null` cuando el hueco es demasiado estrecho: hay que rebalancear.
 */
export const positionBetween = (before?: number, after?: number): number | null => {
  if (before === undefined) {
    return after === undefined ? firstPosition() : after - STEP;
  }
  if (after === undefined) return before + STEP;

  if (after - before < MIN_GAP) return null;
  return before + (after - before) / 2;
};

/**
 * Reasigna posiciones limpias y equidistantes.
 * Se ejecuta solo cuando `positionBetween` devuelve null, cosa que en uso real
 * requiere cientos de reordenamientos sobre el mismo par de vecinos.
 */
export const rebalance = <T>(items: readonly T[], assign: (item: T, position: number) => T): T[] =>
  items.map((item, index) => assign(item, (index + 1) * STEP));

/** Comparador estable por posicion, con el id como desempate determinista. */
export const byPosition = <T extends { position: number; id: string }>(a: T, b: T): number => {
  const delta = a.position - b.position;
  return delta !== 0 ? delta : a.id.localeCompare(b.id);
};
