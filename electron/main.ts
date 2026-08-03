import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  DesktopBadgeState,
  DesktopNotificationRequest,
  DesktopPreferences,
} from '../src/shared/desktop-bridge';

import { IPC_CHANNELS } from '../src/shared/desktop-bridge';
import { NotificationScheduler } from './notification-scheduler';
import { readPreferences, writePreferences } from './preferences-store';

/**
 * Proceso principal de Electron.
 *
 * SEGURIDAD
 * ---------
 * La ventana corre con `contextIsolation: true` y `nodeIntegration: false`, que es la
 * configuracion segura y no negociable. El renderer carga codigo de terceros (React,
 * Supabase, y cualquier enlace que el usuario pegue en una tarea); si tuviera acceso a
 * `require`, un fallo de XSS pasaria de "molesto" a "acceso total al disco".
 *
 * Todo lo que la interfaz necesita del sistema pasa por canales IPC declarados en
 * `desktop-bridge.ts`. Lo que no este ahi, no se puede hacer.
 */

/**
 * Carpeta del bundle compilado.
 *
 * Se usa `__dirname` y NO `fileURLToPath(import.meta.url)`. El bundle de salida es CJS
 * -obligatorio, porque Electron carga el preload con `require`- y al compilar a CJS
 * esbuild sustituye `import.meta` por un objeto vacio. `import.meta.url` queda como
 * `undefined`, `fileURLToPath(undefined)` lanza durante la carga del modulo y la app
 * muere antes de tener ventana, consola o registro: se cierra sin decir nada.
 */
const currentDir = __dirname;

const isDevelopment = !app.isPackaged;
const DEV_SERVER_URL = 'http://localhost:5173';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let scheduler: NotificationScheduler;

/**
 * Una sola instancia.
 *
 * Sin esto, abrir el acceso directo dos veces levanta dos procesos que compiten por
 * la misma base de IndexedDB y duplican todos los recordatorios programados.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // El usuario intento abrirla otra vez: en vez de arrancar de nuevo, se trae al
    // frente la ventana que ya existe.
    showMainWindow();
  });

  /**
   * Un fallo durante el arranque cierra el proceso sin ventana, sin consola y sin
   * ningun rastro: desde fuera la app simplemente "no abre". Este manejador convierte
   * ese silencio en un mensaje que se puede leer y reportar.
   */
  void app.whenReady().then(bootstrap).catch(reportFatalError);

  process.on('uncaughtException', reportFatalError);
}

function reportFatalError(error: unknown): void {
  const message =
    error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error);
  console.error('[main] fallo fatal en el arranque', message);

  dialog.showErrorBox('Checklist Personal no pudo arrancar', message.slice(0, 2000));

  app.exit(1);
}

async function bootstrap(): Promise<void> {
  // Necesario para que Windows muestre el nombre correcto en las notificaciones.
  app.setAppUserModelId('dev.yahi.checklistpersonal');

  scheduler = new NotificationScheduler(navigateTo);

  registerIpcHandlers();
  createTray();

  const preferences = readPreferences();
  const startHidden = preferences.startMinimized || process.argv.includes('--hidden');

  await createMainWindow(startHidden);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow(false);
    else showMainWindow();
  });
}

// ---------------------------------------------------------------------------
// Ventana
// ---------------------------------------------------------------------------

async function createMainWindow(startHidden: boolean): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 380,
    minHeight: 500,
    // Sin barra de titulo nativa: la cabecera de la app hace de zona de arrastre y
    // deja un acabado mas limpio, con los botones de ventana en su sitio.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#6b7280',
      height: 44,
    },
    backgroundColor: '#0b0f19',
    show: false,
    autoHideMenuBar: true,
    icon: join(currentDir, '../build/icon.png'),
    webPreferences: {
      preload: join(currentDir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      // Evita que un enlace en una tarea abra ventanas de Electron sin control.
      allowRunningInsecureContent: false,
    },
  });

  // `ready-to-show` evita el destello blanco de una ventana que se pinta a medias.
  mainWindow.once('ready-to-show', () => {
    if (!startHidden) mainWindow?.show();
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;

    if (readPreferences().closeToTray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Los enlaces externos van al navegador del sistema, nunca a una ventana de Electron.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Bloquea la navegacion fuera de la app: ni un enlace ni un redirect pueden sacar
  // a la ventana de su propio contenido.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isDevServer = isDevelopment && url.startsWith(DEV_SERVER_URL);
    const isLocalFile = url.startsWith('file://');

    if (!isDevServer && !isLocalFile) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  if (isDevelopment) {
    await mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(join(currentDir, '../dist/index.html'));
  }
}

function showMainWindow(): void {
  if (mainWindow === null) {
    void createMainWindow(false);
    return;
  }

  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function navigateTo(route: string): void {
  showMainWindow();
  mainWindow?.webContents.send(IPC_CHANNELS.navigate, route);
}

// ---------------------------------------------------------------------------
// Bandeja del sistema
// ---------------------------------------------------------------------------

function createTray(): void {
  const iconPath = join(currentDir, '../build/tray-icon.png');
  const image = nativeImage.createFromPath(iconPath);

  // Si falta el icono, `createFromPath` devuelve una imagen vacia y Electron lanza al
  // crear el Tray. Mejor seguir sin bandeja que no arrancar.
  if (image.isEmpty()) {
    console.warn('[tray] no se encontro el icono; se omite la bandeja');
    return;
  }

  tray = new Tray(image.resize({ width: 16, height: 16 }));
  tray.setToolTip('Checklist Personal');

  const menu = Menu.buildFromTemplate([
    { label: 'Abrir Checklist', click: () => showMainWindow() },
    { type: 'separator' },
    { label: 'Hoy', click: () => navigateTo('#/hoy') },
    { label: 'Nueva tarea', click: () => navigateTo('#/hoy?nueva=1') },
    { label: 'Modo enfoque', click: () => navigateTo('#/enfoque') },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
  tray.on('click', () => showMainWindow());
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpcHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.notificationSchedule,
    (_event, request: DesktopNotificationRequest) => {
      scheduler.schedule(request);
    },
  );

  ipcMain.handle(IPC_CHANNELS.notificationCancel, (_event, id: string) => {
    scheduler.cancel(id);
  });

  ipcMain.handle(IPC_CHANNELS.notificationCancelAll, () => {
    scheduler.cancelAll();
  });

  ipcMain.handle(
    IPC_CHANNELS.notificationShowNow,
    (_event, request: Omit<DesktopNotificationRequest, 'scheduledAt'>) => {
      scheduler.show(request);
    },
  );

  ipcMain.handle(IPC_CHANNELS.windowMinimizeToTray, () => {
    mainWindow?.hide();
  });

  ipcMain.handle(IPC_CHANNELS.windowSetBadge, (_event, state: DesktopBadgeState) => {
    // Windows no tiene contador numerico como macOS: se usa el overlay del icono
    // en la barra de tareas, que es el equivalente nativo.
    if (mainWindow === null) return;

    if (state.count <= 0) {
      mainWindow.setOverlayIcon(null, '');
      return;
    }

    const label = state.count > 99 ? '99+' : String(state.count);
    mainWindow.setOverlayIcon(createBadgeImage(label), `${state.count} tareas para hoy`);
  });

  ipcMain.handle(IPC_CHANNELS.windowFocus, () => {
    showMainWindow();
  });

  ipcMain.handle(IPC_CHANNELS.preferencesGet, (): DesktopPreferences => readPreferences());

  ipcMain.handle(
    IPC_CHANNELS.preferencesSet,
    (_event, patch: Partial<DesktopPreferences>): DesktopPreferences => writePreferences(patch),
  );

  ipcMain.handle(
    IPC_CHANNELS.filesSave,
    async (_event, fileName: string, contents: string): Promise<string | null> => {
      if (mainWindow === null) return null;

      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        defaultPath: join(app.getPath('downloads'), fileName),
        filters: [
          { name: 'JSON', extensions: ['json'] },
          { name: 'CSV', extensions: ['csv'] },
          { name: 'Todos', extensions: ['*'] },
        ],
      });

      if (canceled || filePath === undefined) return null;

      await writeFile(filePath, contents, 'utf8');
      return filePath;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.filesOpen,
    async (_event, filters: { name: string; extensions: string[] }[]): Promise<string | null> => {
      if (mainWindow === null) return null;

      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: filters.length > 0 ? filters : [{ name: 'JSON', extensions: ['json'] }],
      });

      const picked = filePaths[0];
      if (canceled || picked === undefined) return null;

      return readFile(picked, 'utf8');
    },
  );

  ipcMain.handle(IPC_CHANNELS.shellOpenExternal, async (_event, url: string) => {
    // Se valida el esquema antes de abrir: sin esto, una tarea con un adjunto
    // `file:///C:/...` podria abrir cualquier cosa del disco al pulsarla.
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:')) {
      await shell.openExternal(url);
    }
  });
}

/** Distintivo numerico para el icono de la barra de tareas, dibujado en SVG. */
function createBadgeImage(label: string): Electron.NativeImage {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="15" fill="#ef4444"/>
      <text x="16" y="22" font-family="Segoe UI, sans-serif" font-size="${
        label.length > 2 ? 13 : 17
      }" font-weight="700" fill="white" text-anchor="middle">${label}</text>
    </svg>`;

  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
  );
}

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------

app.on('before-quit', () => {
  isQuitting = true;
  scheduler?.cancelAll();
  tray?.destroy();
});

app.on('window-all-closed', () => {
  // En Windows la app sigue viva en la bandeja: cerrar la ventana no debe matar los
  // recordatorios programados. Solo se sale si el usuario lo pidio expresamente.
  if (process.platform !== 'darwin' && !readPreferences().closeToTray) {
    app.quit();
  }
});
