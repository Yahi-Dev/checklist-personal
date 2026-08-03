import { cva, type VariantProps } from 'class-variance-authority';
import { useId } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../lib/cn';

/**
 * Elementos de retroalimentacion: distintivos, progreso, esqueletos y estados vacios.
 */

// ---------------------------------------------------------------------------
// Distintivo
// ---------------------------------------------------------------------------

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        neutral: 'bg-sunken text-ink-soft',
        brand: 'bg-brand-100 text-brand-800 dark:bg-brand-900/50 dark:text-brand-200',
        success: 'bg-success/15 text-success',
        warning: 'bg-warning/15 text-warning',
        danger: 'bg-danger/15 text-danger',
        outline: 'border border-line text-ink-soft',
      },
      size: {
        sm: 'px-1.5 py-0.5 text-[10px]',
        md: 'px-2 py-0.5 text-xs',
      },
    },
    defaultVariants: { variant: 'neutral', size: 'md' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export const Badge = ({ className, variant, size, ...props }: BadgeProps) => (
  <span className={cn(badgeVariants({ variant, size }), className)} {...props} />
);

// ---------------------------------------------------------------------------
// Barra de progreso
// ---------------------------------------------------------------------------

export interface ProgressProps {
  /** 0..1 */
  value: number;
  className?: string;
  label?: string;
  tone?: 'brand' | 'success';
}

export const Progress = ({ value, className, label, tone = 'brand' }: ProgressProps) => {
  const percentage = Math.round(Math.min(Math.max(value, 0), 1) * 100);

  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-sunken', className)}
      role="progressbar"
      aria-valuenow={percentage}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? 'Progreso'}
    >
      <div
        className={cn(
          // El resorte hace que la barra "aterrice" al completar una subtarea en
          // vez de deslizarse sin caracter.
          'h-full rounded-full transition-[width] duration-500 ease-spring',
          tone === 'success' ? 'bg-success' : 'bg-linear-to-r from-brand-400 to-brand-500',
        )}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
};

/** Progreso circular: se usa en el temporizador de concentracion. */
export interface RingProgressProps {
  /** 0..1 */
  value: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  children?: ReactNode;
}

export const RingProgress = ({
  value,
  size = 220,
  strokeWidth = 10,
  className,
  children,
}: RingProgressProps) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(Math.max(value, 0), 1);

  // Los ids de un <linearGradient> son globales al documento: con dos anillos en
  // pantalla, un id fijo haria que ambos pintaran con el gradiente del primero.
  const gradientId = useId();

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <defs>
          {/* Degradado del acento a lo largo del arco: el anillo plano de un solo
              color se ve de herramienta; este se ve de producto. Los stops leen las
              variables del tema, asi que siguen al modo claro/oscuro solos. */}
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style={{ stopColor: 'var(--color-brand-400)' }} />
            <stop offset="100%" style={{ stopColor: 'var(--color-brand-600)' }} />
          </linearGradient>
        </defs>

        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          // `line` y no `sunken`: en oscuro, sunken es MAS oscuro que el lienzo y la
          // pista desaparecia; el color de borde queda visible en ambos temas.
          className="text-line"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          className="transition-[stroke-dashoffset] duration-500 ease-linear"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Esqueleto de carga
// ---------------------------------------------------------------------------

export const Skeleton = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('animate-pulse rounded-lg bg-sunken', className)}
    aria-hidden="true"
    {...props}
  />
);

export const TaskListSkeleton = ({ count = 4 }: { count?: number }) => (
  <div className="space-y-2" aria-busy="true" aria-label="Cargando tareas">
    {Array.from({ length: count }, (_, index) => (
      <div key={index} className="flex items-start gap-3 rounded-card bg-panel p-3.5">
        <Skeleton className="size-5 shrink-0 rounded-md" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4" style={{ width: `${55 + ((index * 13) % 35)}%` }} />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
    ))}
  </div>
);

// ---------------------------------------------------------------------------
// Estado vacio
// ---------------------------------------------------------------------------

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * Un estado vacio siempre dice que hacer a continuacion.
 * "No hay tareas" a secas deja al usuario mirando una pantalla en blanco sin pistas.
 */
export const EmptyState = ({ icon, title, description, action, className }: EmptyStateProps) => (
  <div
    className={cn(
      'flex flex-col items-center justify-center gap-3 px-6 py-14 text-center',
      className,
    )}
  >
    {icon !== undefined && (
      // La burbuja flota despacio: un vacio que respira invita a llenar; uno
      // congelado parece un error.
      <div
        className={cn(
          'flex size-16 animate-float items-center justify-center rounded-3xl shadow-soft',
          'bg-linear-to-br from-brand-100 to-brand-50 text-brand-500',
          'dark:from-brand-900/40 dark:to-brand-800/20 dark:text-brand-300',
          '[&_svg]:size-7',
        )}
      >
        {icon}
      </div>
    )}
    <div className="space-y-1">
      <p className="text-base font-semibold text-balance text-ink">{title}</p>
      {description !== undefined && (
        <p className="max-w-xs text-sm text-balance text-ink-soft">{description}</p>
      )}
    </div>
    {action}
  </div>
);
