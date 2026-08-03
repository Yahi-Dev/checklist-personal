/**
 * El contrato del puente entre Electron y la interfaz.
 *
 * Este archivo lo importan LAS DOS partes: el `preload` que expone la API y el
 * renderer que la consume. Tenerlo compartido es lo que hace que añadir un metodo en
 * el proceso principal sin implementarlo en el otro lado falle en compilacion y no en
 * ejecucion, cuando el usuario pulsa el boton.
 *
 * El renderer corre con `contextIsolation` y sin `nodeIntegration`: no tiene acceso a
 * `require`, al sistema de archivos ni a `process`. Todo pasa por aqui, y lo que no
 * este en esta interfaz sencillamente no se puede hacer desde la interfaz.
 */

export interface DesktopNotificationRequest {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  /** ISO-8601. Si es pasado, se muestra de inmediato. */
  readonly scheduledAt: string;
  readonly deepLink?: string;
}

export interface DesktopBadgeState {
  /** Numero para el icono de la barra de tareas. 0 lo quita. */
  readonly count: number;
}

export interface DesktopPreferences {
  readonly launchAtLogin: boolean;
  readonly startMinimized: boolean;
  readonly closeToTray: boolean;
}

export interface DesktopBridge {
  readonly platform: 'electron';
  readonly appVersion: string;

  notifications: {
    schedule(request: DesktopNotificationRequest): Promise<void>;
    cancel(id: string): Promise<void>;
    cancelAll(): Promise<void>;
    showNow(request: Omit<DesktopNotificationRequest, 'scheduledAt'>): Promise<void>;
  };

  window: {
    minimizeToTray(): Promise<void>;
    setBadge(state: DesktopBadgeState): Promise<void>;
    focus(): Promise<void>;
  };

  preferences: {
    get(): Promise<DesktopPreferences>;
    set(preferences: Partial<DesktopPreferences>): Promise<DesktopPreferences>;
  };

  files: {
    /** Abre el dialogo de guardar y escribe el archivo. Devuelve la ruta elegida. */
    save(fileName: string, contents: string): Promise<string | null>;
    /** Abre el dialogo de abrir y devuelve el contenido en texto. */
    open(filters: readonly { name: string; extensions: string[] }[]): Promise<string | null>;
  };

  shell: {
    openExternal(url: string): Promise<void>;
  };

  /**
   * Eventos que empuja el proceso principal.
   * Devuelven la funcion para dejar de escuchar; sin ella, cada montaje de React
   * acumularia un listener mas en el proceso principal.
   */
  on: {
    navigate(listener: (route: string) => void): () => void;
    notificationClicked(listener: (taskId: string) => void): () => void;
    quickCapture(listener: () => void): () => void;
  };
}

declare global {
  interface Window {
    /** Solo existe dentro de Electron. En el navegador es `undefined`. */
    readonly desktop?: DesktopBridge;
  }
}

/** Canales de IPC. Constantes compartidas para que no se desincronicen los strings. */
export const IPC_CHANNELS = {
  notificationSchedule: 'notification:schedule',
  notificationCancel: 'notification:cancel',
  notificationCancelAll: 'notification:cancel-all',
  notificationShowNow: 'notification:show-now',
  notificationClicked: 'notification:clicked',
  windowMinimizeToTray: 'window:minimize-to-tray',
  windowSetBadge: 'window:set-badge',
  windowFocus: 'window:focus',
  preferencesGet: 'preferences:get',
  preferencesSet: 'preferences:set',
  filesSave: 'files:save',
  filesOpen: 'files:open',
  shellOpenExternal: 'shell:open-external',
  navigate: 'app:navigate',
  quickCapture: 'app:quick-capture',
} as const;

export const isDesktop = (): boolean =>
  typeof window !== 'undefined' && window.desktop?.platform === 'electron';

export const desktopBridge = (): DesktopBridge | null =>
  typeof window !== 'undefined' && window.desktop !== undefined ? window.desktop : null;
