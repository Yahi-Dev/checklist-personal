-- =============================================================================
-- 0001 - Esquema base
-- =============================================================================
--
-- DOS COLUMNAS DE TIEMPO, Y HACEN FALTA LAS DOS
-- ---------------------------------------------
-- `updated_at`        lo escribe EL CLIENTE. Sirve para resolver conflictos:
--                     entre dos versiones de la misma fila gana la mas reciente.
--
-- `server_updated_at` lo escribe un TRIGGER con la hora del servidor. Sirve como
--                     marca de agua al bajar cambios.
--
-- Con una sola columna el sistema se rompe con el desfase de relojes. Si el reloj
-- del telefono va cinco minutos atrasado y escribe `updated_at` en el pasado, la
-- computadora -cuya marca de agua ya esta mas adelante- nunca volveria a ver esa
-- fila: se pierde en silencio y para siempre. Separando "cuando lo edito el
-- usuario" de "cuando llego al servidor", cada columna responde a la pregunta que
-- de verdad le corresponde.
--
-- POR QUE `subtasks` Y `attachments` SON jsonb
-- --------------------------------------------
-- Una Tarea es un agregado: su frontera transaccional incluye sus subtareas.
-- Normalizarlas en tablas aparte convertiria cada guardado en tres escrituras que
-- se sincronizan por separado, y abriria el estado "llego la subtarea pero su
-- tarea padre no". Una fila por agregado hace que cada operacion de sincronizacion
-- sea atomica por construccion.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Funciones auxiliares
-- -----------------------------------------------------------------------------

create or replace function public.touch_server_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.server_updated_at := now();

  -- Red de seguridad: un cliente con el reloj roto podria mandar `updated_at` en el
  -- futuro y ganar todos los conflictos para siempre. Se recorta a la hora del
  -- servidor con un margen de un minuto para absorber el desfase normal.
  if new.updated_at is null or new.updated_at > now() + interval '1 minute' then
    new.updated_at := now();
  end if;

  return new;
end;
$$;

comment on function public.touch_server_updated_at is
  'Sella la hora de servidor y recorta marcas de tiempo del cliente en el futuro.';

-- -----------------------------------------------------------------------------
-- categories
-- -----------------------------------------------------------------------------

create table if not exists public.categories (
  id                uuid primary key,
  user_id           uuid not null references auth.users (id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 60),
  color             text not null default '#6366f1' check (color ~* '^#[0-9a-f]{6}$'),
  icon              text not null default 'house',
  position          integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at        timestamptz
);

create index if not exists categories_user_sync_idx
  on public.categories (user_id, server_updated_at);

create unique index if not exists categories_user_name_unique
  on public.categories (user_id, lower(name))
  where deleted_at is null;

create trigger categories_touch
  before insert or update on public.categories
  for each row execute function public.touch_server_updated_at();

-- -----------------------------------------------------------------------------
-- tags
-- -----------------------------------------------------------------------------

create table if not exists public.tags (
  id                uuid primary key,
  user_id           uuid not null references auth.users (id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 40),
  slug              text not null check (char_length(slug) between 1 and 40),
  color             text not null default '#64748b' check (color ~* '^#[0-9a-f]{6}$'),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at        timestamptz
);

create index if not exists tags_user_sync_idx
  on public.tags (user_id, server_updated_at);

-- El slug es la clave real de deduplicacion: "Urgente" y "urgente" son la misma.
create unique index if not exists tags_user_slug_unique
  on public.tags (user_id, slug)
  where deleted_at is null;

create trigger tags_touch
  before insert or update on public.tags
  for each row execute function public.touch_server_updated_at();

-- -----------------------------------------------------------------------------
-- tasks
-- -----------------------------------------------------------------------------

create table if not exists public.tasks (
  id                  uuid primary key,
  user_id             uuid not null references auth.users (id) on delete cascade,
  title               text not null check (char_length(title) between 1 and 500),
  notes               text check (char_length(notes) <= 20000),
  status              text not null default 'pending'
                        check (status in ('pending', 'completed', 'archived')),
  priority            text not null default 'medium'
                        check (priority in ('low', 'medium', 'high')),
  is_important        boolean not null default false,
  due_at              timestamptz,
  is_all_day          boolean not null default false,
  reminder_at         timestamptz,
  completed_at        timestamptz,

  -- ON DELETE SET NULL y no CASCADE: borrar la categoria "Trabajo" no puede llevarse
  -- por delante las tareas de trabajo.
  category_id         uuid references public.categories (id) on delete set null,
  tag_ids             uuid[] not null default '{}',

  subtasks            jsonb not null default '[]'::jsonb,
  attachments         jsonb not null default '[]'::jsonb,
  recurrence          jsonb,
  location            jsonb,

  -- Sin clave foranea a proposito: apunta a la primera tarea de la serie, que puede
  -- haberse borrado. Una FK obligaria a resucitarla o a romper la cadena.
  series_id           uuid,

  snooze_count        integer not null default 0 check (snooze_count >= 0),
  position            double precision not null default 0,
  estimated_pomodoros integer check (estimated_pomodoros between 1 and 50),
  completed_pomodoros integer not null default 0 check (completed_pomodoros >= 0),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  server_updated_at   timestamptz not null default now(),
  deleted_at          timestamptz,

  -- Coherencia elemental: si esta completada tiene fecha de completado, y al reves.
  constraint tasks_completed_consistency
    check ((status = 'completed') = (completed_at is not null)),

  -- Un recordatorio posterior al vencimiento no avisa de nada.
  constraint tasks_reminder_before_due
    check (reminder_at is null or due_at is null or reminder_at <= due_at),

  constraint tasks_subtasks_is_array check (jsonb_typeof(subtasks) = 'array'),
  constraint tasks_attachments_is_array check (jsonb_typeof(attachments) = 'array')
);

-- Indice de sincronizacion: la consulta "dame lo cambiado desde X" es la mas frecuente.
create index if not exists tasks_user_sync_idx
  on public.tasks (user_id, server_updated_at);

-- Vista de Hoy y de proximas: pendientes ordenadas por vencimiento.
create index if not exists tasks_user_due_idx
  on public.tasks (user_id, due_at)
  where deleted_at is null and status = 'pending';

create index if not exists tasks_user_category_idx
  on public.tasks (user_id, category_id)
  where deleted_at is null;

create index if not exists tasks_series_idx
  on public.tasks (series_id)
  where series_id is not null;

-- GIN sobre el array de etiquetas: hace que `tag_ids && '{...}'` use indice.
create index if not exists tasks_tag_ids_idx
  on public.tasks using gin (tag_ids);

-- Barrido de recordatorios pendientes de enviar (lo usa la Edge Function).
create index if not exists tasks_reminder_due_idx
  on public.tasks (reminder_at)
  where deleted_at is null and status = 'pending' and reminder_at is not null;

-- Busqueda por texto en español: acentos y plurales incluidos.
create index if not exists tasks_search_idx
  on public.tasks using gin (
    to_tsvector('spanish', title || ' ' || coalesce(notes, ''))
  );

create trigger tasks_touch
  before insert or update on public.tasks
  for each row execute function public.touch_server_updated_at();

-- -----------------------------------------------------------------------------
-- focus_sessions
-- -----------------------------------------------------------------------------

create table if not exists public.focus_sessions (
  id                uuid primary key,
  user_id           uuid not null references auth.users (id) on delete cascade,
  task_id           uuid references public.tasks (id) on delete set null,
  mode              text not null check (mode in ('focus', 'short-break', 'long-break')),
  started_at        timestamptz not null,
  ended_at          timestamptz,
  planned_seconds   integer not null check (planned_seconds > 0),
  elapsed_seconds   integer not null default 0 check (elapsed_seconds >= 0),
  was_completed     boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),

  constraint focus_sessions_chronology check (ended_at is null or ended_at >= started_at)
);

create index if not exists focus_sessions_user_sync_idx
  on public.focus_sessions (user_id, server_updated_at);

create index if not exists focus_sessions_user_started_idx
  on public.focus_sessions (user_id, started_at desc);

create trigger focus_sessions_touch
  before insert or update on public.focus_sessions
  for each row execute function public.touch_server_updated_at();

-- -----------------------------------------------------------------------------
-- Comentarios de documentacion
-- -----------------------------------------------------------------------------

comment on table public.tasks is
  'Agregado Tarea. Las subtareas y los adjuntos viven en jsonb para que cada sincronizacion sea atomica por agregado.';

comment on column public.tasks.updated_at is
  'Marca del CLIENTE. Resuelve conflictos: gana la mas reciente.';

comment on column public.tasks.server_updated_at is
  'Marca del SERVIDOR. Es la marca de agua para bajar cambios; inmune al desfase de relojes.';

comment on column public.tasks.deleted_at is
  'Borrado logico. Es la unica forma de propagar un borrado al otro dispositivo.';
