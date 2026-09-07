import type { AdvisorPlan } from '../../domain/assistant/advisor-plan';
import type { CurrentUser } from './repositories';
import type { DomainError } from '../../domain/shared/domain-error';
import type { IsoDateTime } from '../../domain/task/value-objects/iso-date-time';
import type { PlanningBrief } from '../../domain/assistant/planning-brief';
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
  /** Cuantas operaciones locales esperan subir y aun se reintentan solas. */
  readonly pendingOperations: number;
  readonly lastError: string | null;
  /**
   * Cambios que el servidor rechazo tantas veces que ya no se reintentan.
   *
   * Se cuentan aparte de los pendientes porque no son lo mismo y confundirlos es lo que
   * hacia que el problema fuera invisible: un dispositivo podia llevar dias sin subir
   * nada mientras enseñaba un "todo sincronizado" perfectamente sincero segun sus
   * propias cuentas. Esto no se arregla esperando, asi que se enseña y se ofrece salida.
   */
  readonly blockedOperations: number;
  /** Lo que dijo el servidor sobre lo atascado, tal cual, para poder diagnosticarlo. */
  readonly blockedReason: string | null;
}

export interface SyncService {
  /** Sube la cola pendiente y baja los cambios del servidor. */
  sync(): Promise<Result<SyncState>>;
  /** Descarta el estado local y vuelve a bajarlo todo. */
  fullResync(): Promise<Result<SyncState>>;
  /**
   * Devuelve a la cola lo que se habia dado por perdido y lo intenta otra vez.
   *
   * Existe porque la causa mas habitual de que algo se atasque -una sesion caducada, una
   * categoria que aun no habia subido, permisos recien arreglados- se resuelve FUERA de
   * la app. Sin esta puerta, el unico camino de vuelta seria la resincronizacion completa,
   * que empieza por borrar la copia local: para recuperar tres cambios atascados habria
   * que arriesgar todo lo demas.
   */
  retryBlocked(): Promise<Result<SyncState>>;
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

// --- Asistente de priorizacion --------------------------------------------

export type AdvisorRole = 'user' | 'assistant';

/** Que hizo el usuario con un plan propuesto. Se le cuenta al asistente en el turno siguiente. */
export type PlanOutcome = 'pendiente' | 'aplicado' | 'descartado';

export interface AdvisorMessage {
  readonly id: string;
  readonly role: AdvisorRole;
  readonly text: string;
  /** Solo en mensajes del asistente, y solo si propuso un orden. */
  readonly plan: AdvisorPlan | null;
  readonly planOutcome: PlanOutcome;
  readonly at: IsoDateTime;
}

/**
 * Trozos de la respuesta segun van llegando.
 *
 * El error viaja como un evento del flujo y no como una excepcion: cuando ya se
 * imprimieron tres parrafos y la conexion se corta, lanzar obligaria a cada consumidor
 * a envolver el bucle en try/catch y a decidir que hacer con lo ya pintado. Como
 * evento, el fallo se trata igual que cualquier otro trozo.
 */
export type AdvisorEvent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'plan'; readonly plan: AdvisorPlan }
  | { readonly type: 'done' }
  | { readonly type: 'error'; readonly error: DomainError };

export interface AdvisorTurn {
  readonly brief: PlanningBrief;
  /** La conversacion completa, incluido el mensaje nuevo del usuario al final. */
  readonly messages: readonly AdvisorMessage[];
  readonly signal?: AbortSignal;
}

/**
 * El asistente de priorizacion.
 *
 * El puerto no menciona a Claude, ni HTTP, ni SSE: la aplicacion solo sabe que existe
 * algo que, dado el estado del dia y una conversacion, devuelve texto y a veces un
 * plan. Eso es lo que permite que los casos de uso se prueben con un doble que
 * devuelve un guion fijo, sin red y sin clave de API.
 */
export interface PlanningAdvisorService {
  /** `false` cuando no hay servidor configurado: la interfaz lo dice en vez de fallar. */
  readonly isAvailable: boolean;
  ask(turn: AdvisorTurn): AsyncIterable<AdvisorEvent>;
}

// --- Preferencias ----------------------------------------------------------

export interface KeyValueStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

// --- Documentos ------------------------------------------------------------

/**
 * Un fragmento de texto de un PDF, con su posicion en la pagina.
 *
 * Las coordenadas NO son un extra: son el dato principal. El horario de la universidad
 * es una tabla donde la fila dice que asignatura es y la columna dice que dia, y en un
 * PDF esa rejilla no existe en ninguna parte -no hay celdas, solo trozos de texto
 * sueltos con un `x` y un `y`-. Un extractor que devolviera `string[]` tiraria justo la
 * informacion que distingue el lunes del jueves.
 *
 * El origen es el del PDF: `x` crece hacia la derecha, `y` crece hacia ARRIBA, y ambos
 * van en puntos tipograficos (1/72 de pulgada) sobre una pagina que suele medir
 * 612x792.
 */
export interface PdfTextItem {
  readonly text: string;
  /** Pagina, empezando en 1. */
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Extrae el texto posicionado de un PDF.
 *
 * Vive como puerto para que el parser del horario, que es donde esta toda la logica
 * fragil, se pueda probar con un array de fragmentos escrito a mano: sin navegador, sin
 * worker y sin arrastrar un megabyte de pdfjs a la suite de pruebas.
 */
export interface PdfTextExtractor {
  extract(bytes: Uint8Array): Promise<Result<readonly PdfTextItem[]>>;
}
