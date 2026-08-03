import { AlertCircle, Check, CloudOff, HardDrive, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button, Spinner } from '../../shared/ui/button';
import { cn } from '../../shared/lib/cn';
import { formatRelativeToNow } from '../../shared/lib/date-format';
import { Tooltip } from '../../shared/ui/overlays';
import { useAuth } from '../../app/providers/auth-provider';
import { usePendingOutboxCount } from '../../shared/hooks/use-live-query';
import { useSync } from '../../app/providers/sync-provider';

/**
 * Estado de la sincronizacion.
 *
 * En una app offline-first el usuario tiene que poder responder a una sola pregunta:
 * "¿lo que acabo de escribir esta a salvo o solo en este aparato?". Ocultar el estado
 * ahorra pixeles y regala la desconfianza de no saber si el telefono vera lo de la
 * computadora.
 */
export const SyncIndicator = ({ compact = false }: { compact?: boolean }) => {
  const { state, isOnline, syncNow } = useSync();
  const { isCloudEnabled } = useAuth();
  const pending = usePendingOutboxCount();

  // Repinta cada 30 s para que "hace 2 minutos" no se quede congelado.
  const [, forceRefresh] = useState(0);
  useEffect(() => {
    const interval = window.setInterval(() => forceRefresh((tick) => tick + 1), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  if (!isCloudEnabled) {
    return (
      <Tooltip content="Configura Supabase para sincronizar con el telefono.">
        <div
          className={cn(
            'flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-ink-muted',
            compact && 'px-1.5',
          )}
        >
          <HardDrive className="size-3.5" />
          {!compact && <span>Solo en este dispositivo</span>}
        </div>
      </Tooltip>
    );
  }

  const { icon, label, tone } = describe({ status: state.status, isOnline, pending });

  return (
    <Tooltip
      content={
        <span className="flex flex-col gap-0.5">
          <span>{label}</span>
          {state.lastSyncedAt !== null && (
            <span className="opacity-70">Ultima vez {formatRelativeToNow(state.lastSyncedAt)}</span>
          )}
          {state.lastError !== null && <span className="opacity-70">{state.lastError}</span>}
        </span>
      }
    >
      <Button
        variant="ghost"
        size={compact ? 'icon-sm' : 'sm'}
        onClick={syncNow}
        className={cn('gap-2', tone)}
        aria-label={`Sincronizacion: ${label}. Pulsa para sincronizar ahora.`}
      >
        {icon}
        {!compact && <span className="truncate text-xs">{label}</span>}
      </Button>
    </Tooltip>
  );
};

const describe = ({
  status,
  isOnline,
  pending,
}: {
  status: string;
  isOnline: boolean;
  pending: number;
}): { icon: React.ReactNode; label: string; tone: string } => {
  if (!isOnline || status === 'offline') {
    return {
      icon: <CloudOff className="size-3.5" />,
      label: pending > 0 ? `Sin conexion · ${pending} por subir` : 'Sin conexion',
      tone: 'text-ink-muted',
    };
  }

  if (status === 'syncing') {
    return {
      icon: <Spinner className="size-3.5" />,
      label: 'Sincronizando...',
      tone: 'text-ink-soft',
    };
  }

  if (status === 'error') {
    return {
      icon: <AlertCircle className="size-3.5" />,
      label: 'Error al sincronizar',
      tone: 'text-danger',
    };
  }

  if (pending > 0) {
    return {
      icon: <RefreshCw className="size-3.5" />,
      label: `${pending} por subir`,
      tone: 'text-ink-soft',
    };
  }

  return { icon: <Check className="size-3.5" />, label: 'Todo sincronizado', tone: 'text-success' };
};
