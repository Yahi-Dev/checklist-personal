import {
  Bell,
  BellOff,
  Cloud,
  Download,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Plus,
  RefreshCw,
  Smartphone,
  Sun,
  Tags,
  Timer,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { useState } from 'react';

import type { CategoryId } from '../domain/shared/branded';
import type { ThemeMode } from '../shared/stores/preferences-store';

import { Badge } from '../shared/ui/feedback';
import { Button } from '../shared/ui/button';
import { Card, CardContent, PageContent, PageHeader } from '../shared/ui/layout';
import { CATEGORY_COLORS } from '../domain/category/category';
import { cn } from '../shared/lib/cn';
import { ConfirmDialog } from '../shared/ui/overlays';
import {
  CreateCategoryUseCase,
  DeleteCategoryUseCase,
  UpdateCategoryUseCase,
} from '../application/use-cases/category/category-commands';
import {
  ExportBackupUseCase,
  ImportBackupUseCase,
} from '../application/use-cases/backup/backup-commands';
import { Field, Input, SegmentedGroup, SegmentedItem, Switch } from '../shared/ui/form-controls';
import { formatRelativeToNow } from '../shared/lib/date-format';
import { getContainer } from '../infrastructure/di/container';
import { isErr } from '../domain/shared/result';
import { QUICK_CAPTURE_SYNTAX } from '../features/quick-capture/quick-capture-syntax';
import { useAuth } from '../app/providers/auth-provider';
import { useCategories } from '../shared/hooks/use-live-query';
import { usePreferences } from '../shared/stores/preferences-store';
import { useSync } from '../app/providers/sync-provider';

/**
 * Ajustes: apariencia, notificaciones, categorias, respaldo y cuenta.
 *
 * La seccion de respaldo es la mas importante de todas aunque parezca la mas aburrida.
 * Sin exportacion, los datos quedan atados a que Supabase siga existiendo y a que la
 * cuenta gratuita no caduque por inactividad.
 */
export const SettingsPage = () => {
  const container = getContainer();
  const { user, isCloudEnabled } = useAuth();
  const { state: syncState, syncNow, fullResync } = useSync();
  const preferences = usePreferences();
  const categories = useCategories() ?? [];

  const [newCategory, setNewCategory] = useState('');
  const [confirmResync, setConfirmResync] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [deletingCategory, setDeletingCategory] = useState<CategoryId | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<string>('default');

  const requestNotifications = async () => {
    const result = await container.context.notifications.requestPermission();
    setNotificationPermission(result);
    preferences.markNotificationsRequested();

    if (result === 'granted') {
      const push = await container.context.notifications.registerForPush();
      if (!isErr(push) && push.value !== null) {
        // La suscripcion se guarda en el servidor: es lo que permite que el iPhone
        // reciba avisos con la app cerrada.
        await savePushSubscription(push.value);
      }
      toast.success('Notificaciones activadas');
    } else if (result === 'denied') {
      toast.error('Las bloqueaste. Tienes que permitirlas desde los ajustes del navegador.');
    } else if (result === 'unsupported') {
      toast.error(
        'Este navegador no las soporta. En iPhone, añade la app a la pantalla de inicio.',
      );
    }
  };

  const savePushSubscription = async (payload: {
    endpoint: string;
    p256dh: string;
    auth: string;
    platform: string;
  }) => {
    if (!isCloudEnabled || user === null) return;

    try {
      const { getSupabaseClient } = await import('../infrastructure/supabase/client');
      await getSupabaseClient()
        .from('push_subscriptions')
        .upsert(
          {
            user_id: user.id,
            endpoint: payload.endpoint,
            p256dh: payload.p256dh,
            auth: payload.auth,
            platform: payload.platform,
            user_agent: navigator.userAgent.slice(0, 300),
          },
          { onConflict: 'endpoint' },
        );
    } catch {
      toast.error('No se pudo registrar el dispositivo para notificaciones.');
    }
  };

  const exportData = async (format: 'json' | 'csv') => {
    const result = await new ExportBackupUseCase(container.context).execute({ format });

    if (isErr(result)) {
      toast.error(result.error.message);
      return;
    }

    const { fileName, contents, counts } = result.value;
    const saved = await container.context.platform.saveFile(
      fileName,
      contents,
      format === 'json' ? 'application/json' : 'text/csv;charset=utf-8',
    );

    if (isErr(saved)) toast.error(saved.error.message);
    else toast.success(`Exportado: ${counts.tasks} tareas`);
  };

  const importData = async () => {
    const picked = await container.context.platform.pickFile('.json,application/json');

    if (isErr(picked)) {
      toast.error(picked.error.message);
      return;
    }
    if (picked.value === null) return;

    const result = await new ImportBackupUseCase(container.context).execute({
      contents: picked.value,
      strategy: 'merge',
    });

    if (isErr(result)) {
      toast.error(result.error.message);
      return;
    }

    toast.success(
      `Importadas ${result.value.imported.tasks} tareas` +
        (result.value.skipped > 0 ? ` (${result.value.skipped} ya estaban al dia)` : ''),
    );
  };

  const addCategory = async () => {
    const name = newCategory.trim();
    if (name.length === 0) return;

    const result = await new CreateCategoryUseCase(container.context).execute({
      name,
      color: CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length],
    });

    if (isErr(result)) toast.error(result.error.message);
    else setNewCategory('');
  };

  return (
    <>
      <PageHeader title="Ajustes" />

      <PageContent className="space-y-4">
        {/* ---------------- Apariencia ---------------- */}
        <Section icon={<Palette className="size-4" />} title="Apariencia">
          <Field label="Tema">
            <SegmentedGroup
              type="single"
              value={preferences.theme}
              onValueChange={(value) => {
                if (value !== '') preferences.setTheme(value as ThemeMode);
              }}
              className="w-full"
            >
              <SegmentedItem value="light" className="flex-1">
                <Sun className="size-3.5" />
                Claro
              </SegmentedItem>
              <SegmentedItem value="dark" className="flex-1">
                <Moon className="size-3.5" />
                Oscuro
              </SegmentedItem>
              <SegmentedItem value="system" className="flex-1">
                <Monitor className="size-3.5" />
                Sistema
              </SegmentedItem>
            </SegmentedGroup>
          </Field>

          <ToggleRow
            label="Ver completadas en las listas"
            checked={preferences.showCompleted}
            onChange={preferences.toggleShowCompleted}
          />
          <ToggleRow
            label="Agrupar por categoria"
            checked={preferences.groupByCategory}
            onChange={preferences.toggleGroupByCategory}
          />
        </Section>

        {/* ---------------- Notificaciones ---------------- */}
        <Section icon={<Bell className="size-4" />} title="Recordatorios">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">Notificaciones del sistema</p>
              <p className="text-xs text-ink-muted">
                {notificationPermission === 'granted'
                  ? 'Activadas en este dispositivo.'
                  : 'Necesarias para que te avise a la hora que pongas.'}
              </p>
            </div>
            <Button
              variant={notificationPermission === 'granted' ? 'secondary' : 'primary'}
              size="sm"
              onClick={() => void requestNotifications()}
            >
              {notificationPermission === 'granted' ? (
                <>
                  <Bell className="size-4" />
                  Activadas
                </>
              ) : (
                <>
                  <BellOff className="size-4" />
                  Activar
                </>
              )}
            </Button>
          </div>

          <Field
            label="Avisar antes del vencimiento"
            hint="Minutos de antelacion al poner una hora."
          >
            <Input
              type="number"
              min={0}
              max={1440}
              value={preferences.defaultReminderLeadMinutes}
              onChange={(event) =>
                preferences.setDefaultReminderLead(Math.max(0, Number(event.target.value) || 0))
              }
              className="w-28"
              inputMode="numeric"
            />
          </Field>

          <div className="rounded-lg bg-sunken p-3 text-xs text-ink-soft">
            <p className="flex items-center gap-1.5 font-medium text-ink">
              <Smartphone className="size-3.5" />
              En el iPhone
            </p>
            <p className="mt-1">
              Las notificaciones solo funcionan si añades la app a la pantalla de inicio (Compartir
              → Añadir a inicio). Es una restriccion de iOS: en una pestaña de Safari no existe el
              permiso de notificaciones.
            </p>
          </div>
        </Section>

        {/* ---------------- Enfoque ---------------- */}
        <Section icon={<Timer className="size-4" />} title="Modo enfoque">
          <div className="grid grid-cols-3 gap-2">
            <Field label="Concentracion">
              <Input
                type="number"
                min={1}
                max={120}
                value={preferences.focusSettings.focusMinutes}
                onChange={(event) =>
                  preferences.setFocusSettings({
                    focusMinutes: Math.max(1, Number(event.target.value) || 25),
                  })
                }
                inputMode="numeric"
              />
            </Field>
            <Field label="Descanso">
              <Input
                type="number"
                min={1}
                max={60}
                value={preferences.focusSettings.shortBreakMinutes}
                onChange={(event) =>
                  preferences.setFocusSettings({
                    shortBreakMinutes: Math.max(1, Number(event.target.value) || 5),
                  })
                }
                inputMode="numeric"
              />
            </Field>
            <Field label="Descanso largo">
              <Input
                type="number"
                min={1}
                max={120}
                value={preferences.focusSettings.longBreakMinutes}
                onChange={(event) =>
                  preferences.setFocusSettings({
                    longBreakMinutes: Math.max(1, Number(event.target.value) || 15),
                  })
                }
                inputMode="numeric"
              />
            </Field>
          </div>

          <ToggleRow
            label="Empezar los descansos solos"
            checked={preferences.focusSettings.autoStartBreaks}
            onChange={() =>
              preferences.setFocusSettings({
                autoStartBreaks: !preferences.focusSettings.autoStartBreaks,
              })
            }
          />
          <ToggleRow
            label="Empezar el siguiente bloque solo"
            checked={preferences.focusSettings.autoStartFocus}
            onChange={() =>
              preferences.setFocusSettings({
                autoStartFocus: !preferences.focusSettings.autoStartFocus,
              })
            }
          />
        </Section>

        {/* ---------------- Categorias ---------------- */}
        <Section icon={<Tags className="size-4" />} title="Categorias">
          <ul className="space-y-1.5">
            {categories.map((category) => (
              <li key={category.id} className="flex items-center gap-2">
                <input
                  type="color"
                  value={category.color}
                  onChange={(event) => {
                    void new UpdateCategoryUseCase(container.context).execute({
                      categoryId: category.id,
                      color: event.target.value,
                    });
                  }}
                  className="size-7 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent p-0.5"
                  aria-label={`Color de ${category.name}`}
                />
                <input
                  defaultValue={category.name}
                  onBlur={(event) => {
                    const name = event.target.value.trim();
                    if (name.length > 0 && name !== category.name) {
                      void new UpdateCategoryUseCase(container.context).execute({
                        categoryId: category.id,
                        name,
                      });
                    } else {
                      event.target.value = category.name;
                    }
                  }}
                  className="h-9 flex-1 rounded-lg border border-line bg-panel px-2.5 text-sm text-ink outline-none focus:border-brand-500"
                  aria-label={`Nombre de ${category.name}`}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setDeletingCategory(category.id)}
                  aria-label={`Borrar ${category.name}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>

          <div className="flex gap-2">
            <Input
              value={newCategory}
              onChange={(event) => setNewCategory(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void addCategory();
                }
              }}
              placeholder="Nueva categoria"
              aria-label="Nueva categoria"
            />
            <Button variant="secondary" onClick={() => void addCategory()}>
              <Plus className="size-4" />
            </Button>
          </div>
        </Section>

        {/* ---------------- Sincronizacion ---------------- */}
        <Section icon={<Cloud className="size-4" />} title="Sincronizacion">
          {isCloudEnabled ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-ink">
                    {syncState.lastSyncedAt === null
                      ? 'Todavia sin sincronizar'
                      : `Ultima vez ${formatRelativeToNow(syncState.lastSyncedAt)}`}
                  </p>
                  {syncState.pendingOperations > 0 && (
                    <p className="text-xs text-ink-muted">
                      {syncState.pendingOperations} cambios por subir
                    </p>
                  )}
                </div>
                <Button variant="secondary" size="sm" onClick={syncNow}>
                  <RefreshCw className="size-4" />
                  Sincronizar
                </Button>
              </div>

              <Button variant="ghost" size="sm" onClick={() => setConfirmResync(true)}>
                Rehacer sincronizacion completa
              </Button>
            </>
          ) : (
            <p className="rounded-lg bg-warning/10 p-3 text-xs text-ink-soft">
              No hay Supabase configurado: los datos viven solo en este dispositivo. Rellena{' '}
              <code className="font-mono">.env</code> con tu URL y tu clave anon para sincronizar
              con el telefono.
            </p>
          )}
        </Section>

        {/* ---------------- Respaldo ---------------- */}
        <Section icon={<Download className="size-4" />} title="Respaldo">
          <p className="text-xs text-ink-soft">
            Guarda una copia de todo. El JSON se puede volver a importar; el CSV es para abrirlo en
            una hoja de calculo.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => void exportData('json')}>
              <Download className="size-4" />
              Exportar JSON
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void exportData('csv')}>
              <Download className="size-4" />
              Exportar CSV
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void importData()}>
              <Upload className="size-4" />
              Importar
            </Button>
          </div>
        </Section>

        {/* ---------------- Sintaxis ---------------- */}
        <Section icon={<Plus className="size-4" />} title="Atajos al escribir una tarea">
          <ul className="space-y-1.5">
            {QUICK_CAPTURE_SYNTAX.map((entry) => (
              <li key={entry.meaning} className="flex items-start gap-3 text-xs">
                <code className="shrink-0 rounded bg-sunken px-1.5 py-0.5 font-mono text-ink-soft">
                  {entry.token}
                </code>
                <span className="text-ink-muted">{entry.meaning}</span>
              </li>
            ))}
          </ul>
        </Section>

        {/* ---------------- Cuenta ---------------- */}
        {user !== null && (
          <Section icon={<LogOut className="size-4" />} title="Cuenta">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-ink">{user.email}</p>
                <Badge size="sm" variant="neutral">
                  {isCloudEnabled ? 'Sincronizada' : 'Local'}
                </Badge>
              </div>
              {isCloudEnabled && (
                <Button variant="ghost" size="sm" onClick={() => setConfirmSignOut(true)}>
                  <LogOut className="size-4" />
                  Cerrar sesion
                </Button>
              )}
            </div>
          </Section>
        )}

        <p className="pb-4 text-center text-xs text-ink-muted">
          Checklist Personal v{__APP_VERSION__}
        </p>
      </PageContent>

      <ConfirmDialog
        open={confirmResync}
        onOpenChange={setConfirmResync}
        title="¿Rehacer la sincronizacion?"
        description="Se borra la copia local y se descarga todo de nuevo desde el servidor. Los cambios que no se hayan subido todavia se perderan."
        confirmLabel="Rehacer"
        destructive
        onConfirm={() => {
          void fullResync();
          setConfirmResync(false);
        }}
      />

      <ConfirmDialog
        open={confirmSignOut}
        onOpenChange={setConfirmSignOut}
        title="¿Cerrar sesion?"
        description="Se borraran los datos guardados en este dispositivo. Siguen en el servidor y volveran al iniciar sesion otra vez."
        confirmLabel="Cerrar sesion"
        destructive
        onConfirm={() => {
          void (async () => {
            await container.auth.signOut();
            await container.database.wipe();
            setConfirmSignOut(false);
          })();
        }}
      />

      <ConfirmDialog
        open={deletingCategory !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingCategory(null);
        }}
        title="¿Borrar la categoria?"
        description="Las tareas que la usaban se quedan sin categoria, pero no se borran."
        confirmLabel="Borrar"
        destructive
        onConfirm={() => {
          if (deletingCategory !== null) {
            void new DeleteCategoryUseCase(container.context).execute({
              categoryId: deletingCategory,
            });
          }
          setDeletingCategory(null);
        }}
      />
    </>
  );
};

const Section = ({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) => (
  <Card>
    <CardContent className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <span className="text-ink-muted">{icon}</span>
        {title}
      </h2>
      {children}
    </CardContent>
  </Card>
);

const ToggleRow = ({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) => (
  <label className={cn('flex cursor-pointer items-center justify-between gap-3 py-0.5')}>
    <span className="text-sm text-ink">{label}</span>
    <Switch checked={checked} onCheckedChange={onChange} />
  </label>
);
