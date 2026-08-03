import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combina clases resolviendo los conflictos de Tailwind.
 *
 * `clsx` aplana condicionales y `twMerge` deja solo la ultima clase de cada familia:
 * sin el, `cn('p-2', 'p-4')` produce `"p-2 p-4"` y cual gana depende del orden en que
 * Tailwind las emitio en el CSS, no del orden en que se escribieron. Con `cn` gana
 * siempre la ultima, que es lo que espera cualquiera al pasar `className` a un
 * componente para ajustarlo.
 */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
