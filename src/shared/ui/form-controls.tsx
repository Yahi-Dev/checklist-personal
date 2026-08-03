import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as LabelPrimitive from '@radix-ui/react-label';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { Check, ChevronDown, Eye, EyeOff } from 'lucide-react';
import {
  forwardRef,
  useState,
  type ComponentPropsWithoutRef,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

import { cn } from '../lib/cn';

/**
 * Controles de formulario.
 *
 * Se apoyan en Radix y no en elementos nativos estilizados porque la accesibilidad de
 * un desplegable o un interruptor -roles ARIA, navegacion con flechas, gestion del
 * foco, cierre con Escape- es mucho codigo sutil y facil de dejar a medias. Radix ya
 * lo resuelve; aqui solo se pone el estilo.
 */

// ---------------------------------------------------------------------------
// Etiqueta
// ---------------------------------------------------------------------------

export const Label = forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      'text-sm font-medium text-ink-soft select-none',
      'peer-disabled:cursor-not-allowed peer-disabled:opacity-60',
      className,
    )}
    {...props}
  />
));
Label.displayName = 'Label';

// ---------------------------------------------------------------------------
// Campo de texto
// ---------------------------------------------------------------------------

const fieldStyles = cn(
  'w-full rounded-control border border-line bg-panel px-3 text-ink',
  'placeholder:text-ink-muted',
  'transition-[border-color,box-shadow] duration-150',
  'focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none',
  'disabled:cursor-not-allowed disabled:opacity-60',
  'aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/20',
);

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      // El tamaño de fuente de 16px en el movil no es estetica: Safari en iOS hace zoom
      // automatico al enfocar un campo con letra mas pequeña, y descoloca el layout.
      className={cn(fieldStyles, 'h-10 text-base sm:text-sm', className)}
      aria-invalid={invalid === true ? true : undefined}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

/**
 * Campo de contraseña con interruptor para verla.
 *
 * Los puntitos existen para que nadie lea la contraseña por encima del hombro, pero en
 * un movil, escribiendo con el pulgar y sin poder revisar lo escrito, ese mismo secreto
 * convierte cada error de tecleo en un "correo o contraseña incorrectos" que no dice
 * cual de los dos fallo. Poder mirar un segundo lo que se acaba de escribir resuelve
 * mas problemas de los que crea, y la decision la toma el usuario, no el formulario.
 *
 * El boton es `type="button"` a proposito: dentro de un formulario, un boton sin tipo
 * es de envio por defecto, asi que mirar la contraseña enviaria el formulario a medias.
 */
export const PasswordInput = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => {
    const [visible, setVisible] = useState(false);

    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? 'text' : 'password'}
          // Hueco a la derecha para que el texto no pase por debajo del boton.
          className={cn('pr-11', className)}
          {...props}
        />

        <button
          type="button"
          onClick={() => {
            setVisible((shown) => !shown);
          }}
          // Sin `tabIndex={-1}` el tabulador pasaria por aqui camino del boton de
          // enviar, que es el recorrido que hace todo el mundo tras teclear la clave.
          tabIndex={-1}
          aria-label={visible ? 'Ocultar la contraseña' : 'Ver la contraseña'}
          aria-pressed={visible}
          className={cn(
            'absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-control',
            'text-ink-muted transition-colors duration-150',
            'hover:text-ink focus-visible:text-ink focus-visible:outline-none',
          )}
        >
          {visible ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(fieldStyles, 'min-h-24 resize-y py-2 text-base sm:text-sm', className)}
      aria-invalid={invalid === true ? true : undefined}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

// ---------------------------------------------------------------------------
// Casilla
// ---------------------------------------------------------------------------

export const Checkbox = forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer size-5 shrink-0 rounded-md border-2 border-line-strong',
      'transition-colors duration-150',
      'focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:border-brand-600 data-[state=checked]:bg-brand-600',
      // El pop al marcar es LA micro-interaccion de una app de tareas: completar
      // algo tiene que sentirse como un pequeño premio, no como un cambio de estado.
      'data-[state=checked]:animate-pop data-[state=checked]:text-white',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      <Check className="size-3.5" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = 'Checkbox';

// ---------------------------------------------------------------------------
// Interruptor
// ---------------------------------------------------------------------------

export const Switch = forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full',
      'border-2 border-transparent transition-colors duration-200',
      'focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:bg-brand-600 data-[state=unchecked]:bg-line-strong',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        'pointer-events-none block size-5 rounded-full bg-white shadow-soft',
        'transition-transform duration-200',
        'data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0',
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';

// ---------------------------------------------------------------------------
// Desplegable
// ---------------------------------------------------------------------------

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export const SelectTrigger = forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex h-10 w-full items-center justify-between gap-2 rounded-control',
      'border border-line bg-panel px-3 text-sm text-ink',
      'transition-[border-color,box-shadow] duration-150',
      'focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none',
      'disabled:cursor-not-allowed disabled:opacity-60',
      '[&>span]:line-clamp-1 [&>span]:text-left',
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="size-4 shrink-0 text-ink-muted" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = 'SelectTrigger';

export const SelectContent = forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      className={cn(
        'relative z-50 max-h-80 min-w-[8rem] overflow-hidden rounded-xl',
        'border border-line bg-panel shadow-overlay',
        'data-[state=open]:animate-fade-in',
        position === 'popper' && 'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.Viewport
        className={cn(
          'p-1',
          position === 'popper' && 'w-full min-w-[var(--radix-select-trigger-width)]',
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = 'SelectContent';

export const SelectItem = forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-pointer items-center gap-2 rounded-lg select-none',
      'py-2 pr-3 pl-8 text-sm text-ink outline-none',
      'focus:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex size-4 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="size-4 text-brand-600 dark:text-brand-400" strokeWidth={3} />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = 'SelectItem';

export const SelectLabel = forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Label>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn(
      'px-3 py-1.5 text-xs font-semibold tracking-wide text-ink-muted uppercase',
      className,
    )}
    {...props}
  />
));
SelectLabel.displayName = 'SelectLabel';

// ---------------------------------------------------------------------------
// Grupo segmentado
// ---------------------------------------------------------------------------

export const SegmentedGroup = forwardRef<
  React.ComponentRef<typeof ToggleGroupPrimitive.Root>,
  ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn('inline-flex gap-1 rounded-xl bg-sunken p-1', className)}
    {...props}
  />
));
SegmentedGroup.displayName = 'SegmentedGroup';

export const SegmentedItem = forwardRef<
  React.ComponentRef<typeof ToggleGroupPrimitive.Item>,
  ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Item
    ref={ref}
    className={cn(
      'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3',
      'text-sm font-medium text-ink-soft transition-colors duration-150',
      'hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none',
      'data-[state=on]:bg-panel data-[state=on]:text-ink data-[state=on]:shadow-soft',
      className,
    )}
    {...props}
  />
));
SegmentedItem.displayName = 'SegmentedItem';

// ---------------------------------------------------------------------------
// Campo con etiqueta, ayuda y error
// ---------------------------------------------------------------------------

export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export const Field = ({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: FieldProps) => (
  <div className={cn('space-y-1.5', className)}>
    <Label htmlFor={htmlFor}>
      {label}
      {required === true && <span className="ml-0.5 text-danger">*</span>}
    </Label>

    {children}

    {/* `role="alert"` hace que el lector de pantalla anuncie el error al aparecer,
        sin que el usuario tenga que ir a buscarlo. */}
    {error != null && error.length > 0 ? (
      <p className="text-xs text-danger" role="alert">
        {error}
      </p>
    ) : hint !== undefined ? (
      <p className="text-xs text-ink-muted">{hint}</p>
    ) : null}
  </div>
);
