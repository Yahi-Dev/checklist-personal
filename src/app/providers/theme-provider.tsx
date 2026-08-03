import { useEffect } from 'react';

import { usePreferences } from '../../shared/stores/preferences-store';

/**
 * Aplica el tema al elemento raiz.
 *
 * En modo `system` se escucha `prefers-color-scheme` para reaccionar en vivo: si el
 * telefono cambia a oscuro al anochecer, la app cambia con el sin recargar.
 *
 * Tambien actualiza `theme-color`, que es lo que colorea la barra de estado del iPhone
 * cuando la PWA corre en pantalla completa. Sin esto queda una franja blanca sobre una
 * interfaz oscura.
 */
export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const theme = usePreferences((state) => state.theme);

  useEffect(() => {
    const root = document.documentElement;

    const apply = (isDark: boolean) => {
      root.classList.toggle('dark', isDark);

      const meta = document.querySelector('meta[name="theme-color"]');
      meta?.setAttribute('content', isDark ? '#2b2f3a' : '#ffffff');
    };

    if (theme !== 'system') {
      apply(theme === 'dark');
      return;
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    apply(media.matches);

    const onChange = (event: MediaQueryListEvent) => apply(event.matches);
    media.addEventListener('change', onChange);

    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  return <>{children}</>;
};
