import { contextBridge, ipcRenderer } from 'electron';

import type {
  DesktopBadgeState,
  DesktopBridge,
  DesktopNotificationRequest,
  DesktopPreferences,
} from '../src/shared/desktop-bridge';

import { IPC_CHANNELS } from '../src/shared/desktop-bridge';

/**
 * Puente entre el proceso principal y la interfaz.
 *
 * Este archivo es la frontera de seguridad completa de la aplicacion de escritorio.
 * Corre con `contextIsolation`, asi que lo unico que la interfaz puede alcanzar es
 * exactamente lo que se expone aqui: una lista cerrada de funciones concretas.
 *
 * Lo que NO se hace, y es lo importante:
 *   - No se expone `ipcRenderer` entero. Con acceso a `invoke` libre, la interfaz
 *     podria llamar a cualquier canal, incluidos los que se añadan en el futuro sin
 *     pensar en quien los llama.
 *   - No se expone `fs`, `path`, `child_process` ni `process`.
 *   - Los canales son constantes compartidas, no strings sueltos que puedan
 *     desincronizarse entre los dos lados.
 */

const bridge: DesktopBridge = {
  platform: 'electron',
  appVersion: process.env.npm_package_version ?? '1.0.0',

  notifications: {
    schedule: (request: DesktopNotificationRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.notificationSchedule, request),
    cancel: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.notificationCancel, id),
    cancelAll: () => ipcRenderer.invoke(IPC_CHANNELS.notificationCancelAll),
    showNow: (request) => ipcRenderer.invoke(IPC_CHANNELS.notificationShowNow, request),
  },

  window: {
    minimizeToTray: () => ipcRenderer.invoke(IPC_CHANNELS.windowMinimizeToTray),
    setBadge: (state: DesktopBadgeState) => ipcRenderer.invoke(IPC_CHANNELS.windowSetBadge, state),
    focus: () => ipcRenderer.invoke(IPC_CHANNELS.windowFocus),
  },

  preferences: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.preferencesGet),
    set: (preferences: Partial<DesktopPreferences>) =>
      ipcRenderer.invoke(IPC_CHANNELS.preferencesSet, preferences),
  },

  files: {
    save: (fileName: string, contents: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.filesSave, fileName, contents),
    open: (filters) => ipcRenderer.invoke(IPC_CHANNELS.filesOpen, filters),
  },

  shell: {
    openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.shellOpenExternal, url),
  },

  on: {
    /**
     * Cada suscripcion devuelve su funcion de baja. Sin ella, cada montaje de un
     * componente de React dejaria un listener mas en el proceso principal, y tras un
     * rato navegando la misma notificacion se procesaria decenas de veces.
     */
    navigate: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, route: string) => listener(route);
      ipcRenderer.on(IPC_CHANNELS.navigate, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.navigate, handler);
    },

    notificationClicked: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, taskId: string) => listener(taskId);
      ipcRenderer.on(IPC_CHANNELS.notificationClicked, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.notificationClicked, handler);
    },

    quickCapture: (listener) => {
      const handler = () => listener();
      ipcRenderer.on(IPC_CHANNELS.quickCapture, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.quickCapture, handler);
    },
  },
};

contextBridge.exposeInMainWorld('desktop', bridge);
