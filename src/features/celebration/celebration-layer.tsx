import { useEffect, useRef } from 'react';

import type { CelebrationDetail } from './celebration';

import { CELEBRATION_EVENT } from './celebration';

/**
 * La capa que pinta las celebraciones. Separada de las funciones de disparo por
 * la regla de fast-refresh (un archivo con componente y funciones sueltas pierde
 * la recarga en caliente), y porque quien dispara no necesita nada de esto.
 */
// ---------------------------------------------------------------------------
// La capa
// ---------------------------------------------------------------------------

/** Estrella de cuatro puntas. `clip-path` sobre un span: sin SVG ni assets. */
const STAR_CLIP = 'polygon(50% 0%, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0% 50%, 38% 38%)';

const SKY_COLORS = [
  'var(--color-brand-400)',
  'var(--color-brand-500)',
  'var(--color-accent-400)',
  'var(--color-accent-500)',
  'oklch(0.97 0.02 245)',
];

const DAWN_COLORS = [
  'oklch(0.8 0.13 75)',
  'oklch(0.72 0.15 55)',
  'oklch(0.68 0.14 35)',
  'oklch(0.92 0.06 85)',
];

export const CelebrationLayer = () => {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onCelebrate = (event: Event) => {
      const layer = layerRef.current;
      if (layer === null) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      const { kind, x, y } = (event as CustomEvent<CelebrationDetail>).detail;
      if (kind === 'brillante') burstBright(layer, x, y);
      else burstDawn(layer, x, y);
    };

    window.addEventListener(CELEBRATION_EVENT, onCelebrate);
    return () => {
      window.removeEventListener(CELEBRATION_EVENT, onCelebrate);
    };
  }, []);

  // pointer-events-none: la fiesta nunca puede robarle un click a la interfaz.
  return (
    <div
      ref={layerRef}
      className="pointer-events-none fixed inset-0 z-70 overflow-hidden"
      aria-hidden="true"
    />
  );
};

// ---------------------------------------------------------------------------
// Los estallidos
// ---------------------------------------------------------------------------

const random = (min: number, max: number): number => min + Math.random() * (max - min);
const pick = <T,>(options: readonly T[]): T => options[Math.floor(Math.random() * options.length)] as T;

/** Crea un span posicionado en el origen, lo anima y lo retira al terminar. */
const spawn = (
  layer: HTMLElement,
  x: number,
  y: number,
  style: Partial<CSSStyleDeclaration>,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): void => {
  const node = document.createElement('span');
  node.style.position = 'absolute';
  node.style.left = `${String(x)}px`;
  node.style.top = `${String(y)}px`;
  node.style.willChange = 'transform, opacity';
  Object.assign(node.style, style);
  layer.append(node);

  const animation = node.animate(keyframes, { fill: 'forwards', ...options });
  // finished puede rechazar si la animacion se cancela (p. ej. al desmontar);
  // en ambos casos el nodo sobra.
  animation.finished.then(
    () => {
      node.remove();
    },
    () => {
      node.remove();
    },
  );
};

/**
 * A tiempo: fuegos artificiales de estrellas.
 *
 * Tres actos en 900 ms: un destello que abre, una onda que se expande y una
 * lluvia de estrellas y chispas del crepusculo con algo de gravedad. Las 26
 * particulas son el punto donde se lee "fuegos" y no "confeti tacaño"; por
 * encima de 30 se vuelve ruido y ademas se nota en moviles baratos.
 */
const burstBright = (layer: HTMLElement, x: number, y: number): void => {
  // El destello: un circulo del degradado que estalla y se desvanece.
  spawn(
    layer,
    x,
    y,
    {
      width: '4rem',
      height: '4rem',
      marginLeft: '-2rem',
      marginTop: '-2rem',
      borderRadius: '999px',
      background:
        'radial-gradient(circle, oklch(0.9 0.06 245 / 0.9), oklch(0.7 0.15 280 / 0.35) 55%, transparent 70%)',
    },
    [
      { transform: 'scale(0.2)', opacity: 1 },
      { transform: 'scale(2.4)', opacity: 0 },
    ],
    { duration: 480, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  );

  // La onda: un anillo fino que empuja hacia afuera.
  spawn(
    layer,
    x,
    y,
    {
      width: '2.5rem',
      height: '2.5rem',
      marginLeft: '-1.25rem',
      marginTop: '-1.25rem',
      borderRadius: '999px',
      border: '2.5px solid var(--color-brand-400)',
    },
    [
      { transform: 'scale(0.3)', opacity: 0.9 },
      { transform: 'scale(4.4)', opacity: 0 },
    ],
    { duration: 620, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', delay: 40 },
  );

  // Las estrellas y las chispas.
  for (let i = 0; i < 26; i += 1) {
    const isStar = i % 3 !== 0;
    const size = isStar ? random(9, 17) : random(3.5, 6.5);
    const angle = random(0, Math.PI * 2);
    const distance = random(44, 148);
    const color = pick(SKY_COLORS);
    // La gravedad: el punto final cae un poco; sin ella parecen chinchetas clavadas.
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance + random(14, 42);

    spawn(
      layer,
      x,
      y,
      {
        width: `${String(size)}px`,
        height: `${String(size)}px`,
        marginLeft: `${String(-size / 2)}px`,
        marginTop: `${String(-size / 2)}px`,
        background: color,
        // `drop-shadow` y no `box-shadow`: el segundo se recorta con el clip-path
        // de la estrella; el primero sigue su silueta. Es lo que las hace brillar
        // tambien sobre el lienzo claro, donde un punto celeste a secas se pierde.
        filter: `drop-shadow(0 0 4px ${color})`,
        ...(isStar ? { clipPath: STAR_CLIP } : { borderRadius: '999px' }),
      },
      [
        { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 1 },
        {
          transform: `translate(${String(dx)}px, ${String(dy)}px) rotate(${String(random(-220, 220))}deg) scale(0.2)`,
          opacity: 0,
        },
      ],
      { duration: random(620, 950), easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  }
};

/**
 * Tarde: el amanecer.
 *
 * Un resplandor calido que abre despacio y brasas que FLOTAN HACIA ARRIBA, al
 * reves que la gravedad de los fuegos: la fisica invertida es lo que hace que
 * los dos momentos se sientan distintos sin leer ningun texto. Mas lento y con
 * menos particulas a proposito -es un logro sereno, no una traca-.
 */
const burstDawn = (layer: HTMLElement, x: number, y: number): void => {
  // El sol que asoma: resplandor dorado, mas lento que el destello celeste.
  spawn(
    layer,
    x,
    y,
    {
      width: '3.5rem',
      height: '3.5rem',
      marginLeft: '-1.75rem',
      marginTop: '-1.75rem',
      borderRadius: '999px',
      background:
        'radial-gradient(circle, oklch(0.88 0.1 80 / 0.9), oklch(0.75 0.14 55 / 0.35) 55%, transparent 72%)',
    },
    [
      { transform: 'scale(0.25)', opacity: 1 },
      { transform: 'scale(2.1)', opacity: 0 },
    ],
    { duration: 700, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  );

  // Un halo suave, sin borde duro: el amanecer no tiene onda expansiva.
  spawn(
    layer,
    x,
    y,
    {
      width: '2.5rem',
      height: '2.5rem',
      marginLeft: '-1.25rem',
      marginTop: '-1.25rem',
      borderRadius: '999px',
      border: '1.5px solid oklch(0.8 0.12 70 / 0.8)',
    },
    [
      { transform: 'scale(0.4)', opacity: 0.7 },
      { transform: 'scale(2.6)', opacity: 0 },
    ],
    { duration: 780, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', delay: 60 },
  );

  // Las brasas: suben con un balanceo lateral minimo, como aire caliente.
  for (let i = 0; i < 13; i += 1) {
    const size = random(4.5, 9);
    const dx = random(-42, 42);
    const dy = -random(46, 110);

    spawn(
      layer,
      x,
      y,
      {
        width: `${String(size)}px`,
        height: `${String(size)}px`,
        marginLeft: `${String(-size / 2)}px`,
        marginTop: `${String(-size / 2)}px`,
        borderRadius: '999px',
        background: pick(DAWN_COLORS),
        boxShadow: '0 0 10px oklch(0.8 0.12 70 / 0.7)',
      },
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        {
          transform: `translate(${String(dx * 0.4)}px, ${String(dy * 0.55)}px) scale(0.9)`,
          opacity: 0.9,
          offset: 0.55,
        },
        { transform: `translate(${String(dx)}px, ${String(dy)}px) scale(0.3)`, opacity: 0 },
      ],
      { duration: random(850, 1300), easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)' },
    );
  }
};
