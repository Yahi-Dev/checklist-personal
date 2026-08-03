/* eslint-disable @typescript-eslint/consistent-type-definitions,
                  @typescript-eslint/consistent-indexed-object-style --
   Las filas TIENEN que declararse con `type` y no con `interface`: el cliente de
   Supabase exige que cada tabla sea asignable a `Record<string, unknown>`, y en
   TypeScript solo los alias de tipo obtienen la firma de indice implicita que hace
   falta. Con `interface` el esquema deja de encajar en `GenericSchema` y todas las
   consultas caen a `never`, sin ningun error que lo explique.
   Por el mismo motivo las secciones vacias son tipos mapeados y no `Record`. */

/**
 * Tipos de la base de datos remota.
 *
 * Escritos a mano y sincronizados con `supabase/migrations/`. Se pueden regenerar con:
 *   pnpm dlx supabase gen types typescript --project-id <id> > src/infrastructure/supabase/database.types.ts
 *
 * Nota sobre el diseño de `tasks`: las subtareas, los adjuntos, la regla de repeticion
 * y la ubicacion viven como `jsonb` en la propia fila, y las etiquetas como `uuid[]`,
 * en vez de estar normalizadas en tablas aparte.
 *
 * No es pereza, es una consecuencia directa de que la app sea offline-first. Una
 * Tarea es un AGREGADO: su frontera transaccional incluye sus subtareas. Con tablas
 * separadas, guardar una tarea son tres escrituras que pueden sincronizarse por
 * separado, y entonces existe el estado "llego la subtarea pero no su tarea padre".
 * Con una fila por agregado, cada operacion de sincronizacion es atomica por
 * construccion y la resolucion de conflictos opera sobre unidades con sentido.
 *
 * El precio es que no se puede consultar "todas las subtareas de todas las tareas" en
 * SQL, algo que esta app nunca necesita. Los indices GIN sobre `tag_ids` cubren el
 * unico filtrado transversal que si se usa.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type TaskRow = {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  status: 'pending' | 'completed' | 'archived';
  priority: 'low' | 'medium' | 'high';
  is_important: boolean;
  due_at: string | null;
  is_all_day: boolean;
  reminder_at: string | null;
  completed_at: string | null;
  category_id: string | null;
  tag_ids: string[];
  subtasks: Json;
  attachments: Json;
  recurrence: Json | null;
  series_id: string | null;
  snooze_count: number;
  position: number;
  estimated_pomodoros: number | null;
  completed_pomodoros: number;
  location: Json | null;
  created_at: string;
  /** Marca del CLIENTE: resuelve conflictos (gana la mas reciente). */
  updated_at: string;
  /** Marca del SERVIDOR: marca de agua para bajar cambios. La escribe un trigger. */
  server_updated_at: string;
  deleted_at: string | null;
};

export type CategoryRow = {
  id: string;
  user_id: string;
  name: string;
  color: string;
  icon: string;
  position: number;
  created_at: string;
  updated_at: string;
  server_updated_at: string;
  deleted_at: string | null;
};

export type TagRow = {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  color: string;
  created_at: string;
  updated_at: string;
  server_updated_at: string;
  deleted_at: string | null;
};

export type FocusSessionRow = {
  id: string;
  user_id: string;
  task_id: string | null;
  mode: 'focus' | 'short-break' | 'long-break';
  started_at: string;
  ended_at: string | null;
  planned_seconds: number;
  elapsed_seconds: number;
  was_completed: boolean;
  created_at: string;
  updated_at: string;
  server_updated_at: string;
};

export type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  platform: string;
  user_agent: string | null;
  created_at: string;
  last_used_at: string | null;
};

/**
 * `Relationships` va vacio en todas las tablas.
 *
 * El cliente de Supabase lo usa para tipar los `select` con joins anidados
 * (`select('*, categories(*)')`). Esta app nunca hace joins: cada agregado se lee
 * entero de su propia fila, y las relaciones se resuelven en memoria con los indices
 * de `useCategoryIndex` / `useTagIndex`. Declararlo vacio deja claro que es
 * intencionado y no un descuido del generador de tipos.
 */
export type Database = {
  public: {
    Tables: {
      tasks: {
        Row: TaskRow;
        Insert: Omit<TaskRow, 'created_at' | 'updated_at' | 'server_updated_at'> &
          Partial<Pick<TaskRow, 'created_at' | 'updated_at'>>;
        Update: Partial<TaskRow>;
        Relationships: [];
      };
      categories: {
        Row: CategoryRow;
        Insert: Omit<CategoryRow, 'created_at' | 'updated_at' | 'server_updated_at'> &
          Partial<Pick<CategoryRow, 'created_at' | 'updated_at'>>;
        Update: Partial<CategoryRow>;
        Relationships: [];
      };
      tags: {
        Row: TagRow;
        Insert: Omit<TagRow, 'created_at' | 'updated_at' | 'server_updated_at'> &
          Partial<Pick<TagRow, 'created_at' | 'updated_at'>>;
        Update: Partial<TagRow>;
        Relationships: [];
      };
      focus_sessions: {
        Row: FocusSessionRow;
        Insert: Omit<FocusSessionRow, 'created_at' | 'updated_at' | 'server_updated_at'> &
          Partial<Pick<FocusSessionRow, 'created_at' | 'updated_at'>>;
        Update: Partial<FocusSessionRow>;
        Relationships: [];
      };
      push_subscriptions: {
        Row: PushSubscriptionRow;
        Insert: Omit<PushSubscriptionRow, 'id' | 'created_at' | 'last_used_at'> &
          Partial<Pick<PushSubscriptionRow, 'id' | 'created_at' | 'last_used_at'>>;
        Update: Partial<PushSubscriptionRow>;
        Relationships: [];
      };
    };
    /* Tipos mapeados vacios en vez de `Record<never, never>`: el cliente de Supabase
       exige que cada seccion sea asignable a `Record<string, ...>`, y solo un tipo
       mapeado obtiene la firma de indice implicita que hace falta. */
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

/**
 * Lo que el cliente ENVIA al hacer upsert.
 *
 * `server_updated_at` queda fuera a proposito: lo pone el trigger con la hora del
 * servidor, y dejar que el cliente lo escriba destruiria justo la garantia por la que
 * existe esa columna.
 */
export type TaskUpsert = Omit<TaskRow, 'server_updated_at'>;
export type CategoryUpsert = Omit<CategoryRow, 'server_updated_at'>;
export type TagUpsert = Omit<TagRow, 'server_updated_at'>;
export type FocusSessionUpsert = Omit<FocusSessionRow, 'server_updated_at'>;

/** Nombre de tabla remota para cada tipo de entidad de la cola de salida. */
export const TABLE_FOR_ENTITY = {
  task: 'tasks',
  category: 'categories',
  tag: 'tags',
  focusSession: 'focus_sessions',
} as const;
