import { useSyncExternalStore } from 'react';

/**
 * Si el tema que SE ESTA VIENDO es el oscuro.
 *
 * Lee la clase `.dark` de `<html>` en vez de la preferencia guardada, y no es un
 * capricho. `ThemeProvider` pone la clase en un efecto, y React ejecuta los efectos de
 * los hijos ANTES que los del padre: un componente que reaccionara a la preferencia
 * leeria los tokens de color con la clase todavia sin cambiar, es decir, los del tema
 * anterior. Observando la clase, el aviso llega cuando el cambio ya esta aplicado.
 */
const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
};

const getSnapshot = () => document.documentElement.classList.contains('dark');

const getServerSnapshot = () => false;

export const useIsDarkTheme = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
