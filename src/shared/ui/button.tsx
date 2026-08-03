import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { cn } from '../lib/cn';

/**
 * El boton del sistema de diseño.
 *
 * Las variantes se declaran con `cva` en lugar de encadenar ternarios de clases: asi
 * el conjunto de combinaciones validas es un objeto que se lee de un vistazo, y
 * TypeScript rechaza en compilacion una variante que no exista.
 *
 * `asChild` fusiona el estilo con el hijo (un `<Link>`, por ejemplo) en vez de envolverlo.
 * Importa para la accesibilidad: un enlace que parece boton debe seguir siendo un
 * `<a>` con su href, navegable con el teclado y abrible en otra pestaña.
 */
const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap',
    'transition-[background-color,color,box-shadow,transform] duration-150',
    'disabled:pointer-events-none disabled:opacity-45',
    'active:scale-[0.98]',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ),
  {
    variants: {
      variant: {
        primary: 'bg-brand-600 text-white shadow-soft hover:bg-brand-700 active:bg-brand-800',
        secondary: 'border border-line bg-sunken text-ink hover:bg-hover',
        ghost: 'text-ink-soft hover:bg-hover hover:text-ink',
        outline: 'border border-line-strong bg-transparent text-ink hover:bg-hover',
        danger: 'bg-danger text-white hover:brightness-110 active:brightness-95',
        success: 'bg-success text-white hover:brightness-110 active:brightness-95',
        link: 'text-brand-600 underline-offset-4 hover:underline dark:text-brand-400',
      },
      size: {
        // 44px es el minimo tactil recomendado por Apple: mas pequeño se falla al tocar.
        sm: 'h-8 rounded-[--radius-control] px-3 text-sm',
        md: 'h-10 rounded-[--radius-control] px-4 text-sm',
        lg: 'h-11 rounded-xl px-5 text-base',
        icon: 'size-10 rounded-[--radius-control]',
        'icon-sm': 'size-8 rounded-lg',
        'icon-lg': 'size-11 rounded-xl',
      },
      block: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
      block: false,
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Bloquea el boton y muestra un indicador de carga. */
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      block,
      asChild = false,
      loading = false,
      leadingIcon,
      trailingIcon,
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    const Component = asChild ? Slot : 'button';

    return (
      <Component
        ref={ref}
        className={cn(buttonVariants({ variant, size, block }), className)}
        disabled={disabled === true || loading}
        // Los lectores de pantalla anuncian el estado ocupado en vez de quedarse mudos.
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Spinner className="size-4" /> : leadingIcon}
        {children}
        {trailingIcon}
      </Component>
    );
  },
);

Button.displayName = 'Button';

/** Indicador de carga en SVG: no depende de fuentes ni de imagenes externas. */
export const Spinner = ({ className }: { className?: string }) => (
  <svg className={cn('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

export { buttonVariants };
