import type { Clock } from '../../domain/shared/clock';
import type {
  CategoryRepository,
  CurrentUser,
  FocusSessionRepository,
  TagRepository,
  TaskRepository,
} from '../ports/repositories';
import type {
  FileStorageService,
  NotificationService,
  PlanningAdvisorService,
  PlatformService,
} from '../ports/services';
import type { IdGenerator } from '../../domain/shared/id-generator';
import type { ReminderScheduler } from '../services/reminder-scheduler';
import type { Result } from '../../domain/shared/result';

/**
 * Contrato de un caso de uso: una entrada, un `Result` de salida.
 *
 * Cada operacion que el usuario puede disparar es una clase con un unico metodo
 * `execute`. Suena ceremonioso frente a exportar funciones sueltas, pero compra tres
 * cosas concretas: las dependencias se declaran en el constructor (asi que un test las
 * sustituye sin tocar modulos globales), la operacion tiene un nombre buscable en el
 * codigo, y la firma no puede crecer sin que se note.
 */
export interface UseCase<TInput, TOutput> {
  execute(input: TInput): Promise<Result<TOutput>>;
}

/** Para consultas que no reciben parametros. */
export interface Query<TOutput> {
  execute(): Promise<Result<TOutput>>;
}

/**
 * Las dependencias que comparten los casos de uso.
 *
 * `currentUser` es una funcion y no un valor porque la sesion puede cambiar mientras
 * la app corre: capturarlo una vez en el arranque dejaria a los casos de uso
 * escribiendo con el `userId` del usuario anterior tras un cambio de cuenta.
 */
export interface UseCaseContext {
  readonly tasks: TaskRepository;
  readonly categories: CategoryRepository;
  readonly tags: TagRepository;
  readonly focusSessions: FocusSessionRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly notifications: NotificationService;
  readonly reminders: ReminderScheduler;
  readonly files: FileStorageService;
  readonly platform: PlatformService;
  readonly advisor: PlanningAdvisorService;
  readonly currentUser: () => CurrentUser | null;
}

/** Error estandar cuando una operacion necesita sesion y no la hay. */
export const requireUser = (context: Pick<UseCaseContext, 'currentUser'>): CurrentUser | null =>
  context.currentUser();
