import * as SeparatorPrimitive from '@radix-ui/react-separator';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';

import { cn } from '../lib/cn';

/** Piezas de composicion visual. */

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-card border border-line bg-panel shadow-soft', className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

export const CardHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1 px-4 pt-4', className)} {...props} />
);

export const CardTitle = ({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn('text-sm font-semibold text-ink', className)} {...props} />
);

export const CardDescription = ({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn('text-sm text-ink-soft', className)} {...props} />
);

export const CardContent = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('p-4', className)} {...props} />
);

export const CardFooter = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex items-center gap-2 border-t border-line px-4 py-3', className)}
    {...props}
  />
);

export const Separator = forwardRef<
  React.ComponentRef<typeof SeparatorPrimitive.Root>,
  ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = 'horizontal', decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn(
      'shrink-0 bg-line',
      orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
      className,
    )}
    {...props}
  />
));
Separator.displayName = 'Separator';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Contenido bajo el titulo: filtros, pestañas... */
  children?: ReactNode;
  className?: string;
}

/**
 * Cabecera de pagina, pegada arriba al desplazar.
 *
 * `drag-region` deja arrastrar la ventana de Electron desde aqui, ya que la app corre
 * sin la barra de titulo nativa de Windows. Los botones llevan `no-drag` para que
 * sigan siendo pulsables y no arrastren la ventana.
 */
export const PageHeader = ({ title, subtitle, actions, children, className }: PageHeaderProps) => (
  <header
    className={cn(
      // Translucida sobre la aurora del lienzo: al desplazar, el contenido se
      // intuye detras del vidrio en vez de cortarse contra un bloque opaco.
      'sticky top-0 z-30 border-b border-line/60 bg-canvas/75 backdrop-blur-xl',
      'drag-region pt-safe',
      className,
    )}
  >
    <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold tracking-tight text-ink sm:text-2xl">
          {title}
        </h1>
        {subtitle !== undefined && (
          <p className="mt-0.5 truncate text-sm text-ink-soft">{subtitle}</p>
        )}
      </div>
      {actions !== undefined && <div className="no-drag flex items-center gap-2">{actions}</div>}
    </div>
    {children !== undefined && <div className="no-drag px-4 pb-3 sm:px-6">{children}</div>}
  </header>
);

/**
 * Contenedor de ancho legible con espacio inferior para la barra de navegacion movil.
 * `animate-page-in` + el remontaje por ruta del shell = cada pantalla entra con un
 * fundido que sube, en vez de cambiar de golpe.
 */
export const PageContent = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'mx-auto w-full max-w-3xl animate-page-in px-4 py-4 pb-28 sm:px-6 lg:pb-8',
      className,
    )}
    {...props}
  />
);
