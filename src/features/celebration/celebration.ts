import type { Task } from '../../domain/task/task';

/**
 * La celebracion al completar una tarea.
 *
 * POR QUE EXISTE: marcar una tarea es EL momento de la app -todo lo demas es
 * preparacion- y despacharlo con un tachado y un toast es tratarlo como un tramite.
 * Un estallido de medio segundo en el punto exacto del click convierte el registro
 * de un hecho en un pequeño premio. No es decoracion: es la razon de volver mañana.
 *
 * DOS CLIMAS, SIGUIENDO LA DIRECCION DE ARTE "CIELO":
 *
 *   'brillante'  Terminaste a tiempo (o sin fecha): fuegos artificiales de
 *                estrellas celeste -> morado, el crepusculo de la marca.
 *   'amanecer'   Terminaste TARDE: brasas doradas que flotan hacia arriba, como
 *                un sol saliendo. Distinto a proposito, pero igual de positivo:
 *                una tarea vencida que se cierra es una deuda saldada, y castigar
 *                ese momento con un gris de culpa enseñaria a no cerrarlas.
 *
 * COMO ESTA HECHO: la capa vive fija sobre toda la app y escucha un CustomEvent.
 * Se eligio un evento y no un contexto de React porque quien dispara (la fila de
 * la lista, la hoja de detalle) no necesita re-renderizarse cuando la capa pinta:
 * un contexto los acoplaria al ciclo de vida de la animacion sin darles nada.
 *
 * Las particulas se animan con la Web Animations API y no con clases CSS porque
 * cada una lleva angulo, distancia, giro y duracion ALEATORIOS: veinte keyframes
 * distintos por estallido. Precisamente por eso la API ignora la regla global de
 * `prefers-reduced-motion` (que solo alcanza a las animaciones CSS), asi que aqui
 * se comprueba a mano y, si el usuario pidio calma, no se pinta nada: el toast ya
 * confirma el hecho.
 */

export type CelebrationKind = 'brillante' | 'amanecer';

export interface CelebrationDetail {
  readonly kind: CelebrationKind;
  /** Centro del estallido, en coordenadas de viewport (el checkbox pulsado). */
  readonly x: number;
  readonly y: number;
}

export const CELEBRATION_EVENT = 'checklist:celebracion';

/**
 * Decide el clima de la celebracion. Pura y exportada para poder probarla:
 * es la unica logica de negocio de esta funcionalidad.
 *
 * "Tarde" es tener fecha de vencimiento y completar despues de ella. Sin fecha
 * no hay tarde posible: lo que no tiene plazo no puede incumplirlo.
 */
export const celebrationKindFor = (
  task: Pick<Task, 'dueAt'>,
  nowMs: number,
): CelebrationKind =>
  task.dueAt !== null && Date.parse(task.dueAt) < nowMs ? 'amanecer' : 'brillante';

/** Lanza la celebracion. Puede llamarse desde cualquier sitio, sin contexto. */
export const celebrate = (detail: CelebrationDetail): void => {
  window.dispatchEvent(new CustomEvent<CelebrationDetail>(CELEBRATION_EVENT, { detail }));
};

/** Centro de un elemento en coordenadas de viewport: el origen natural del estallido. */
export const centerOf = (element: HTMLElement | null): { x: number; y: number } => {
  if (element === null) {
    // Sin referencia se celebra en el centro: peor que en el checkbox, mejor que nada.
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  }
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};
