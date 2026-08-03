import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { X } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';

import { Button } from './button';
import { cn } from '../lib/cn';

/**
 * Capas flotantes: dialogos, hojas, menus, globos y avisos.
 *
 * Todas comparten el mismo comportamiento no negociable, que Radix aporta: atrapar el
 * foco mientras estan abiertas, devolverlo al elemento que las abrio al cerrarse,
 * cerrar con Escape y marcar el resto de la pagina como inerte para los lectores de
 * pantalla. Reimplementarlo a mano es donde se cuelan los fallos de accesibilidad.
 */

// ---------------------------------------------------------------------------
// Dialogo
// ---------------------------------------------------------------------------

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const Overlay = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]',
      'data-[state=open]:animate-fade-in',
      className,
    )}
    {...props}
  />
));
Overlay.displayName = 'DialogOverlay';

export interface DialogContentProps extends ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  /** Titulo accesible. Obligatorio: Radix avisa en consola si falta. */
  title: string;
  description?: string;
  /** Oculta el titulo visualmente pero lo mantiene para los lectores de pantalla. */
  hideTitle?: boolean;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const DIALOG_SIZES = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
} as const;

export const DialogContent = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, title, description, hideTitle, footer, size = 'md', children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <Overlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed z-50 flex flex-col overflow-hidden bg-panel shadow-overlay',
        // En el movil sube desde abajo como una hoja; en escritorio se centra.
        'animate-sheet-up pb-safe inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl',
        'sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[85dvh] sm:w-full',
        'sm:animate-slide-up sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-0',
        'sm:border sm:border-line',
        DIALOG_SIZES[size],
        className,
      )}
      {...props}
    >
      <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div className="min-w-0 space-y-1">
          {hideTitle === true ? (
            <VisuallyHidden asChild>
              <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
            </VisuallyHidden>
          ) : (
            <DialogPrimitive.Title className="truncate text-base font-semibold text-ink">
              {title}
            </DialogPrimitive.Title>
          )}

          {description !== undefined ? (
            <DialogPrimitive.Description className="text-sm text-ink-soft">
              {description}
            </DialogPrimitive.Description>
          ) : (
            <VisuallyHidden asChild>
              <DialogPrimitive.Description>{title}</DialogPrimitive.Description>
            </VisuallyHidden>
          )}
        </div>

        <DialogPrimitive.Close asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Cerrar">
            <X className="size-4" />
          </Button>
        </DialogPrimitive.Close>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

      {footer !== undefined && (
        <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          {footer}
        </footer>
      )}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = 'DialogContent';

// ---------------------------------------------------------------------------
// Confirmacion destructiva
// ---------------------------------------------------------------------------

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

export interface ConfirmDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}

export const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  destructive = false,
  onConfirm,
  children,
}: ConfirmDialogProps) => (
  <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    {children !== undefined && (
      <AlertDialogPrimitive.Trigger asChild>{children}</AlertDialogPrimitive.Trigger>
    )}

    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="data-[state=open]:animate-fade-in fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
      <AlertDialogPrimitive.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm',
          '-translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-panel',
          'animate-slide-up p-5 shadow-overlay',
        )}
      >
        <AlertDialogPrimitive.Title className="text-base font-semibold text-ink">
          {title}
        </AlertDialogPrimitive.Title>
        <AlertDialogPrimitive.Description className="mt-1.5 text-sm text-ink-soft">
          {description}
        </AlertDialogPrimitive.Description>

        <div className="mt-5 flex justify-end gap-2">
          <AlertDialogPrimitive.Cancel asChild>
            <Button variant="ghost">{cancelLabel}</Button>
          </AlertDialogPrimitive.Cancel>
          <AlertDialogPrimitive.Action asChild>
            <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </AlertDialogPrimitive.Action>
        </div>
      </AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Portal>
  </AlertDialogPrimitive.Root>
);

// ---------------------------------------------------------------------------
// Globo
// ---------------------------------------------------------------------------

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export const PopoverContent = forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Content>,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 6, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      collisionPadding={12}
      className={cn(
        'z-50 w-72 rounded-xl border border-line bg-panel p-3 shadow-overlay',
        'data-[state=open]:animate-slide-up',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = 'PopoverContent';

// ---------------------------------------------------------------------------
// Menu contextual
// ---------------------------------------------------------------------------

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;

export const DropdownMenuContent = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={12}
      className={cn(
        'z-50 min-w-52 overflow-hidden rounded-xl border border-line bg-panel p-1',
        'data-[state=open]:animate-slide-up shadow-overlay',
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = 'DropdownMenuContent';

export const DropdownMenuItem = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { destructive?: boolean }
>(({ className, destructive, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-pointer items-center gap-2.5 rounded-lg select-none',
      'px-2.5 py-2 text-sm transition-colors outline-none',
      'focus:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-muted',
      destructive === true ? 'text-danger [&_svg]:text-danger' : 'text-ink',
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = 'DropdownMenuItem';

export const DropdownMenuLabel = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Label>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(
      'px-2.5 py-1.5 text-xs font-semibold tracking-wide text-ink-muted uppercase',
      className,
    )}
    {...props}
  />
));
DropdownMenuLabel.displayName = 'DropdownMenuLabel';

export const DropdownMenuSeparator = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-line', className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';

// ---------------------------------------------------------------------------
// Ayuda emergente
// ---------------------------------------------------------------------------

export const TooltipProvider = TooltipPrimitive.Provider;

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Atajo de teclado que se muestra a la derecha del texto. */
  shortcut?: string;
}

export const Tooltip = ({ content, children, side = 'top', shortcut }: TooltipProps) => (
  <TooltipPrimitive.Root>
    <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        side={side}
        sideOffset={6}
        className={cn(
          'z-50 flex items-center gap-2 rounded-lg bg-ink px-2.5 py-1.5',
          'text-xs font-medium text-canvas shadow-raised',
          'data-[state=delayed-open]:animate-fade-in',
        )}
      >
        {content}
        {shortcut !== undefined && (
          <kbd className="rounded border border-white/20 px-1 font-mono text-[10px] opacity-70">
            {shortcut}
          </kbd>
        )}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  </TooltipPrimitive.Root>
);
