import { lazy, Suspense, type ComponentType, type CSSProperties } from 'react';

import type { AmbientVariant } from './ambient-tuning';
import type { LiquidEtherProps } from '../../shared/ui/liquid-ether';

import { cn } from '../../shared/lib/cn';
import { INK_MEDIA_QUERY, INK_TUNING } from './ambient-tuning';
import { useIsDarkTheme } from '../../shared/hooks/use-is-dark-theme';
import { useMediaQuery } from '../../shared/hooks/use-media-query';

/**
 * El fondo de tinta liquida, detras de toda la app.
 *
 * UNA sola capa para el login y para los modulos. Se monta una vez por encima de los
 * dos (en `App`) y al pasar de una pantalla a otra solo cambian su intensidad y sus
 * velos. Si cada pantalla montara la suya habria dos contextos WebGL vivos durante la
 * transicion, y otro nuevo en cada cambio de ruta.
 *
 * Va encima de la aurora y debajo de las nubes y las estrellas: con `-z-2` comparte
 * capa con `body::before`, pero sale despues en el arbol, asi que se pinta encima; las
 * nubes, las estrellas y la estrella fugaz estan en `-z-1` y quedan por delante. El
 * contenido no tiene z negativa, asi que siempre queda por encima de todo esto.
 */

/**
 * Los colores de la tinta, de lento a rapido. Son tokens del tema (`global.css`) y
 * LiquidEther los resuelve al montar, por eso cambian solos entre claro y oscuro.
 * Es una constante de modulo a proposito: si la lista cambiara de identidad en cada
 * render no pasaria nada, pero si cambiara de contenido reconstruiria la escena.
 */
const INK_COLORS = ['var(--ink-slow)', 'var(--ink-fast)', 'var(--ink-peak)'] as const;

const NoInk: ComponentType<LiquidEtherProps> = () => null;

/**
 * three.js solo se descarga cuando esta capa decide pintar la tinta.
 *
 * El `catch` no es opcional. Sin conexion, o con una copia vieja que pide un trozo que
 * ya no existe, la carga falla; sin el, ese fallo subiria hasta `AppErrorBoundary` y
 * tumbaria la app entera por un adorno. Asi, sencillamente, no hay tinta.
 */
const LiquidEther = lazy<ComponentType<LiquidEtherProps>>(() =>
  import('../../shared/ui/liquid-ether')
    .then((module) => ({ default: module.LiquidEther }))
    .catch(() => ({ default: NoInk })),
);

/** Destellos del login: la luz que cae desde arriba, como en el panel original. */
const GLOWS = [
  'radial-gradient(ellipse 110% 55% at 50% 0%, color-mix(in oklch, var(--ink-glow) 22%, transparent) 0%, transparent 65%)',
  'radial-gradient(ellipse 80% 45% at 90% 105%, color-mix(in oklch, var(--ink-glow) 10%, transparent) 0%, transparent 55%)',
  'radial-gradient(ellipse 60% 40% at 10% 80%, color-mix(in oklch, var(--ink-glow) 6%, transparent) 0%, transparent 50%)',
].join(', ');

/** Velo del login: solo en el centro, detras del titulo y la tarjeta. */
const LOGIN_VEIL =
  'radial-gradient(ellipse 55% 45% at 50% 50%, color-mix(in oklch, var(--ink-veil) 55%, transparent) 0%, color-mix(in oklch, var(--ink-veil) 20%, transparent) 55%, transparent 100%)';

/** Velo de los modulos: parejo y mas fuerte, para que la tinta acompañe y no distraiga. */
const APP_VEIL = 'color-mix(in oklch, var(--ink-veil) 35%, transparent)';

const GRAIN: CSSProperties = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='256' height='256'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='256' height='256' filter='url(%23n)'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'repeat',
  opacity: 0.035,
};

const FADE = 'absolute inset-0 transition-opacity duration-700 ease-out-quint';

export const AmbientBackground = ({ variant }: { variant: AmbientVariant }) => {
  const showsInk = useMediaQuery(INK_MEDIA_QUERY);
  const isDark = useIsDarkTheme();
  const tuning = INK_TUNING[variant];
  const isLogin = variant === 'login';

  return (
    <div
      aria-hidden="true"
      data-ambient={variant}
      className="pointer-events-none fixed inset-0 -z-2 overflow-hidden"
    >
      <div
        data-layer="glows"
        className={cn(FADE, isLogin ? 'opacity-100' : 'opacity-0')}
        style={{ background: GLOWS }}
      />

      {showsInk && (
        <div data-layer="ink" className={FADE} style={{ opacity: tuning.opacity }}>
          <Suspense fallback={null}>
            <LiquidEther
              colors={INK_COLORS}
              lightMode={!isDark}
              mouseForce={tuning.mouseForce}
              cursorSize={tuning.cursorSize}
              autoSpeed={tuning.autoSpeed}
              autoIntensity={tuning.autoIntensity}
              resolution={tuning.resolution}
              iterationsPoisson={tuning.iterationsPoisson}
            />
          </Suspense>
        </div>
      )}

      <div
        data-layer="login-veil"
        className={cn(FADE, isLogin ? 'opacity-100' : 'opacity-0')}
        style={{ background: LOGIN_VEIL }}
      />

      {/* El velo de los modulos solo existe para calmar la tinta. Sin tinta -telefono,
          «reducir movimiento»- no se pinta: solo apagaria la aurora, y eso cambiaria
          el aspecto de siempre de la app sin ganar nada. */}
      {showsInk && (
        <div
          data-layer="app-veil"
          className={cn(FADE, isLogin ? 'opacity-0' : 'opacity-100')}
          style={{ background: APP_VEIL }}
        />
      )}

      <div data-layer="grain" className="absolute inset-0" style={GRAIN} />
    </div>
  );
};
