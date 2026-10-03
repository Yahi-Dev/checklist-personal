import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component, useEffect, type ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';

import type { LiquidEtherProps } from '../../src/shared/ui/liquid-ether';

import { AmbientBackground } from '../../src/widgets/ambient-background/ambient-background';
import { INK_MEDIA_QUERY, INK_TUNING } from '../../src/widgets/ambient-background/ambient-tuning';

/**
 * El fondo de tinta.
 *
 * jsdom no tiene WebGL, asi que la tinta de verdad se sustituye por un doble que anota
 * con que props se monto y cuantas veces. Lo que se prueba no es el fluido -eso se mira
 * en pantalla- sino las decisiones que pueden romper la app sin que se vea: que la capa
 * no robe clics, que el telefono no descargue three.js, que cambiar de pantalla no cree
 * otra escena WebGL y que un fallo al descargarla no tumbe nada.
 */

const ink = vi.hoisted(() => ({
  imported: false,
  mounts: 0,
  unmounts: 0,
  props: [] as LiquidEtherProps[],
}));

vi.mock('../../src/shared/ui/liquid-ether', () => {
  ink.imported = true;

  const LiquidEther = (props: LiquidEtherProps) => {
    ink.props.push(props);

    useEffect(() => {
      ink.mounts += 1;
      return () => {
        ink.unmounts += 1;
      };
    }, []);

    return <div data-testid="tinta" />;
  };

  return { LiquidEther };
});

/** Simula un escritorio con raton: solo la consulta de la tinta responde que si. */
const simulateDesktop = () => {
  const original = window.matchMedia;

  window.matchMedia = ((query: string) => ({
    matches: query === INK_MEDIA_QUERY,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;

  return () => {
    window.matchMedia = original;
  };
};

const lastProps = (): LiquidEtherProps => {
  const props = ink.props.at(-1);
  if (props === undefined) throw new Error('la tinta no se llego a pintar');
  return props;
};

const layer = (container: HTMLElement): HTMLElement => {
  const element = container.querySelector<HTMLElement>('[data-ambient]');
  if (element === null) throw new Error('no se monto la capa');
  return element;
};

afterEach(() => {
  document.documentElement.classList.remove('dark');
});

describe('fondo de tinta', () => {
  /* Va primero a proposito: comprueba que el modulo de la tinta NO se ha importado
     nunca, y en cuanto otra prueba lo importe queda en la cache del modulo. */
  it('en el telefono no descarga three.js ni apaga la aurora', () => {
    // matchMedia responde que no a todo, como en un telefono.
    const { container } = render(<AmbientBackground variant="app" />);

    expect(ink.imported).toBe(false);
    expect(screen.queryByTestId('tinta')).toBeNull();
    expect(container.querySelector('[data-layer="ink"]')).toBeNull();

    // Sin tinta no hay nada que calmar: el velo de los modulos no se pinta, y los
    // destellos y el velo del login estan apagados, asi que la app se ve en el telefono
    // como antes. Solo queda el grano.
    expect(container.querySelector('[data-layer="app-veil"]')).toBeNull();
    expect(container.querySelector('[data-layer="glows"]')).toHaveClass('opacity-0');
    expect(container.querySelector('[data-layer="login-veil"]')).toHaveClass('opacity-0');
    expect(container.querySelector('[data-layer="grain"]')).not.toBeNull();
  });

  it('en el login del telefono queda el degradado estatico, sin tinta', () => {
    const { container } = render(<AmbientBackground variant="login" />);

    expect(container.querySelector('[data-layer="ink"]')).toBeNull();
    expect(container.querySelector('[data-layer="glows"]')).toHaveClass('opacity-100');
    expect(container.querySelector('[data-layer="login-veil"]')).toHaveClass('opacity-100');
  });

  it('nunca recibe clics, foco ni lectores de pantalla', () => {
    const { container } = render(<AmbientBackground variant="login" />);
    const element = layer(container);

    expect(element).toHaveAttribute('aria-hidden', 'true');
    expect(element.className).toContain('pointer-events-none');
    expect(element.className).toContain('fixed');
    expect(element.className).toContain('inset-0');
    // Detras del contenido: una z negativa, nunca algo que pueda taparlo.
    expect(element.className).toMatch(/(^|\s)-z-\d/);
    expect(element.querySelector('a, button, input, [tabindex]')).toBeNull();
  });

  it('en escritorio pinta la tinta con la intensidad del login', async () => {
    const restore = simulateDesktop();

    try {
      render(<AmbientBackground variant="login" />);
      await screen.findByTestId('tinta');

      const props = lastProps();
      expect(props.mouseForce).toBe(INK_TUNING.login.mouseForce);
      expect(props.resolution).toBe(INK_TUNING.login.resolution);
      expect(props.colors).toEqual(['var(--ink-slow)', 'var(--ink-fast)', 'var(--ink-peak)']);
    } finally {
      restore();
    }
  });

  it('pasar del login a la app cambia la intensidad, NO crea otra escena', async () => {
    // Es el requisito de un solo contexto WebGL: si la tinta se desmontara y volviera a
    // montar, durante la transicion habria dos, y uno nuevo en cada cambio de pantalla.
    const restore = simulateDesktop();

    try {
      const { container, rerender } = render(<AmbientBackground variant="login" />);
      await screen.findByTestId('tinta');
      const mountsBefore = ink.mounts;
      const unmountsBefore = ink.unmounts;

      rerender(<AmbientBackground variant="app" />);

      expect(ink.mounts).toBe(mountsBefore);
      expect(ink.unmounts).toBe(unmountsBefore);
      expect(lastProps().mouseForce).toBe(INK_TUNING.app.mouseForce);
      expect(lastProps().resolution).toBe(INK_TUNING.app.resolution);

      // Y en los modulos se ve menos.
      const wrapper = container.querySelector<HTMLElement>('[data-layer="ink"]');
      expect(wrapper?.style.opacity).toBe(String(INK_TUNING.app.opacity));
      expect(INK_TUNING.app.opacity).toBeLessThan(INK_TUNING.login.opacity);
    } finally {
      restore();
    }
  });

  it('sigue el tema que se ve, no el que esta guardado', async () => {
    // La tinta lee los colores al montar. Si reaccionara a la preferencia, los leeria
    // antes de que ThemeProvider cambie la clase: con los colores del tema anterior.
    const restore = simulateDesktop();

    try {
      render(<AmbientBackground variant="app" />);
      await screen.findByTestId('tinta');
      expect(lastProps().lightMode).toBe(true);

      act(() => {
        document.documentElement.classList.add('dark');
      });

      await waitFor(() => {
        expect(lastProps().lightMode).toBe(false);
      });
    } finally {
      restore();
    }
  });
});

describe('cuando three.js no se puede descargar', () => {
  class CatchErrors extends Component<{ children: ReactNode; onError: (error: Error) => void }> {
    override state = { failed: false };

    static getDerivedStateFromError() {
      return { failed: true };
    }

    override componentDidCatch(error: Error) {
      this.props.onError(error);
    }

    override render() {
      return this.state.failed ? null : this.props.children;
    }
  }

  it('el fondo se queda sin tinta y la app sigue en pie', async () => {
    // Sin conexion, o con una copia vieja que pide un trozo que ya no existe. Sin el
    // `catch` del `lazy`, este fallo llegaria hasta AppErrorBoundary.
    vi.resetModules();
    vi.doMock('../../src/shared/ui/liquid-ether', () => {
      throw new Error('Failed to fetch dynamically imported module');
    });

    const { AmbientBackground: FreshBackground } =
      await import('../../src/widgets/ambient-background/ambient-background');
    const restore = simulateDesktop();
    const errors: Error[] = [];

    try {
      const { container } = render(
        <CatchErrors onError={(error) => errors.push(error)}>
          <FreshBackground variant="login" />
        </CatchErrors>,
      );

      // Se deja resolver la importacion fallida.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      expect(errors).toEqual([]);
      expect(container.querySelector('[data-ambient]')).not.toBeNull();
      expect(screen.queryByTestId('tinta')).toBeNull();
    } finally {
      restore();
      vi.doUnmock('../../src/shared/ui/liquid-ether');
    }
  });
});
