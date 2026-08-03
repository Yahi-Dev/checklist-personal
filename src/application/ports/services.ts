import type { CurrentUser } from './repositories';
import type { IsoDateTime } from '../../domain/task/value-objects/iso-date-time';
import type { Result } from '../../domain/shared/result';
import type { TaskId } from '../../domain/shared/branded';

/**
 * Puertos de servicios: todo lo que la aplicacion necesita del mundo exterior y que
 * no es persistencia. Cada uno tiene al menos dos implementaciones reales (web y
 * Electron) mas una falsa para los tests.
 */

// --- Autenticacion ---------------------------------------------------------

export interface AuthSession {
  readonly user: CurrentUser;
  readonly accessToken: string;
  readonly expiresAt: IsoDateTime;
}

export interface AuthService {
  getSession(): Promise<Result<AuthSession | null>>;
  signInWithPassword(email: string, password: string): Promise<Result<AuthSession>>;
  signUpWithPassword(email: string, password: string): Promise<Result<AuthSession | null>>;
  signInWithMagicLink(email: string): Promise<Result<void>>;
  signOut(): Promise<Result<void>>;
  /** Notifica cada cambio de sesion. Devuelve la funcion para dejar de escuchar. */
  onAuthStateChange(listener: (session: AuthSession | null) => void): () => void;
}

// --- Notificaciones --------------------------------------------------------

export type NotificationPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export interface LocalNotification {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly scheduledAt: IsoDateTime;
  readonly taskId: TaskId | null;
  /** Ruta a la que navegar al pulsar la notificacion. */
  readonly deepLink?: string;
}

export interface NotificationService {
  getPermission(): Promise<NotificationPermission>;
  requestPermission(): Promise<NotificationPermission>;
  /** Programa un aviso local. Reprogramar con el mismo id lo reemplaza. */
  schedule(notification: LocalNotification): Promise<Result<void>>;
  cancel(notificationId: string): Promise<Result<void>>;
  cancelAll(): Promise<Result<void>>;
  /** Muestra un aviso ahora mismo, sin programarlo. */
  showNow(notification: Omit<LocalNotification, 'scheduledAt'>): Promise<Result<void>>;
  /**
   * Registra el dispositivo para Web Push, imprescindible para que el iPhone avise
   * con la app cerrada. Devuelve `null` donde la plataforma no lo soporta.
   */
  registerForPush(): Promise<Result<PushSubscriptionPayload | null>>;
  unregisterFromPush(): Promise<Result<void>>;
}

export interface PushSubscriptionPayload {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly platform: 'web' | 'ios-pwa' | 'electron';
}

// --- Almacenamiento de archivos -------------------------------------------

export interface UploadedFile {
  readonly storagePath: string;
  readonly publicUrl: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
}

export interface FileStorageService {
  upload(file: File, path: string): Promise<Result<UploadedFile>>;
  remove(storagePath: string): Promise<Result<void>>;
  /** URL temporal de lectura para un objeto privado. */
  createSignedUrl(storagePath: string, expiresInSeconds?: number): Promise<Result<string>>;
}

// --- Sincronizacion --------------------------------------------------------

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncState {
  readonly status: SyncStatus;
  readonly lastSyncedAt: IsoDateTime | null;
  /** Cuantas operaciones locales esperan subir. */
  readonly pendingOperations: number;
  readonly lastError: string | null;
}

export interface SyncService {
  /** Sube la cola pendiente y baja los cambios del servidor. */
  sync(): Promise<Result<SyncState>>;
  /** Descarta el estado local y vuelve a bajarlo todo. */
  fullResync(): Promise<Result<SyncState>>;
  getState(): SyncState;
  subscribe(listener: (state: SyncState) => void): () => void;
  /** Abre la escucha en tiempo real para que los cambios lleguen sin recargar. */
  startRealtime(): void;
  stopRealtime(): void;
}

// --- Plataforma ------------------------------------------------------------

export type PlatformKind = 'web' | 'ios-pwa' | 'android-pwa' | 'electron';

export interface PlatformService {
  readonly kind: PlatformKind;
  readonly isDesktop: boolean;
  readonly isStandalone: boolean;
  readonly supportsNativeNotifications: boolean;
  readonly supportsBackgroundGeolocation: boolean;
  /** Abre una URL externa en el navegador del sistema. */
  openExternal(url: string): Promise<void>;
  /** Guarda datos en disco. En web dispara una descarga. */
  saveFile(fileName: string, contents: string, mimeType: string): Promise<Result<void>>;
  /** Pide un archivo al usuario y devuelve su contenido en texto. */
  pickFile(accept: string): Promise<Result<string | null>>;
}

// --- Preferencias ----------------------------------------------------------

export interface KeyValueStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}
