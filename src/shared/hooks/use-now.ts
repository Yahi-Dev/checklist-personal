import { useEffect, useState } from 'react';

/**
 * El instante actual como estado de React, refrescado cada `intervalMs`.
 *
 * Existe por dos motivos, y el segundo es el importante:
 *
 * 1. CORRECCION. Llamar a `Date.now()` en el cuerpo de un componente lo vuelve impuro:
 *    dos renders con los mismos datos producen resultados distintos, y React (y el
 *    compilador de React) asumen lo contrario. Aqui el tiempo entra como estado, que
 *    es la unica forma de que un valor cambiante sea legitimo durante el render.
 *
 * 2. LA APP SE QUEDA ABIERTA. La ventana de escritorio pasa dias sin cerrarse. Sin
 *    esto, una tarea de las 15:00 seguiria pintandose como "pendiente" a las 18:00
 *    porque el `Date.now()` que decidio su color se evaluo por la mañana.
 *
 * El intervalo por defecto es un minuto: suficiente para que "vence a las 15:00" pase
 * a rojo cuando toca, y lo bastante espaciado para no despertar la pantalla.
 */
export const useNow = (intervalMs = 60_000): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(interval);
  }, [intervalMs]);

  return now;
};
