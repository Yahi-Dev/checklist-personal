import type { Task } from './task';

import { startOfLocalDay } from '../shared/clock';

/**
 * El historial de lo terminado, agrupado por el dia en que se termino.
 *
 * POR QUE ES DOMINIO Y NO UN `useMemo` DENTRO DE LA PANTALLA.
 *
 * Agrupar por dia parece cosmetico y no lo es: la pregunta "¿que dia se hizo esto?" tiene
 * una respuesta correcta y varias plausibles. La marca de completado se guarda en UTC,
 * asi que una tarea cerrada a las 21:30 en Santo Domingo lleva dentro la fecha del DIA
 * SIGUIENTE. Agrupar por el texto de esa marca -que es lo que sale solo si uno corta el
 * ISO por la T- pondria media tarde de trabajo en el dia equivocado, y el error solo se
 * nota de noche, que es justo cuando menos se mira.
 *
 * Aqui se agrupa por el dia LOCAL, con las mismas funciones que ya usan las rachas y las
 * estadisticas. Que sea una funcion pura, ademas, es lo que permite probarlo con un huso
 * concreto en vez de a ojo.
 */

export interface CompletionDay {
  /** Clave estable del dia local, `AAAA-MM-DD`. Sirve de `key` en las listas. */
  readonly key: string;
  /** Medianoche local de ese dia. Para formatear el encabezado. */
  readonly date: Date;
  /** Las tareas de ese dia, de la mas reciente a la mas antigua. */
  readonly tasks: readonly Task[];
}

/**
 * Agrupa por dia de completado, del dia mas reciente al mas antiguo.
 *
 * Las que no tienen fecha de completado se descartan: no es que su dia sea desconocido,
 * es que no pertenecen a un historial de cosas terminadas.
 */
export const groupByCompletionDay = (tasks: readonly Task[]): CompletionDay[] => {
  const buckets = new Map<string, { date: Date; tasks: Task[] }>();

  for (const task of tasks) {
    if (task.completedAt === null) continue;

    const date = startOfLocalDay(new Date(task.completedAt));
    const key = localDayKey(date);

    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, { date, tasks: [task] });
    else bucket.tasks.push(task);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, bucket]) => ({
      key,
      date: bucket.date,
      // Dentro del dia, lo ultimo que se termino va arriba: se lee como un registro de
      // actividad, que es como uno recuerda su propio dia -hacia atras desde ahora-.
      tasks: [...bucket.tasks].sort(
        (a, b) => Date.parse(b.completedAt ?? '') - Date.parse(a.completedAt ?? ''),
      ),
    }));
};

/**
 * `AAAA-MM-DD` del dia LOCAL.
 *
 * Se construye a mano en vez de con `toISOString().slice(0, 10)`, que devolveria el dia
 * en UTC y desplazaria la mitad de las noches al dia siguiente. Es exactamente el fallo
 * que este modulo existe para no cometer.
 */
const localDayKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(year)}-${month}-${day}`;
};
