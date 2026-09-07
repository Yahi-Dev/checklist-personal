-- ===========================================================================
--  CHECKLIST PERSONAL - Horario academico (asignaturas y clases)
--  Pegar ENTERO en:  Supabase -> SQL Editor -> New query -> Run
--
--  Se puede ejecutar varias veces sin romper nada.
--  No toca ninguna tabla existente: solo crea `subjects` y `schedule_blocks`
--  con sus indices, sus triggers, sus politicas de seguridad y el aviso en
--  tiempo real.
--
--  QUE HABILITA
--  ------------
--  Que el horario que importas del PDF de la universidad viaje entre el
--  telefono y la computadora, igual que las tareas. Sin esto la app sigue
--  funcionando, pero el horario se queda solo en el dispositivo donde lo
--  importaste.
--
--  Hace falta haber ejecutado antes PEGAR-EN-SUPABASE-sincronizacion.sql:
--  de ahi sale la funcion `touch_server_updated_at` que usan los triggers.
-- ===========================================================================


-- ===========================================================================
--  0006 - Horario academico: asignaturas y tramos semanales
-- ===========================================================================
--  Dos tablas y no una con un jsonb dentro. La razon es la sincronizacion, no
--  la pureza del modelo: lo que mas le pasa a un horario a mitad de
--  cuatrimestre es que cambien UN aula. Si los tramos viajaran dentro de la
--  asignatura, dos dispositivos que tocaran tramos distintos de la misma
--  materia se pisarian entero el uno al otro, porque la unidad de conflicto
--  es la fila. Separados, cada tramo tiene su propia frontera.
--
--  La hora se guarda como TEXTO 'HH:mm' y no como entero de minutos. Con el
--  cero a la izquierda el orden lexicografico es el cronologico, asi que
--  `order by starts_at` y el indice de Dexie funcionan sin conversion, y el
--  dominio persiste tal cual sin un mapeador que solo sirva para esto.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- subjects
-- ---------------------------------------------------------------------------

create table if not exists public.subjects (
  id                uuid primary key,
  user_id           uuid not null references auth.users (id) on delete cascade,
  code              text not null check (char_length(code) between 1 and 16),
  name              text not null check (char_length(name) between 1 and 160),
  section           text not null default '' check (char_length(section) <= 16),
  credits           integer check (credits between 0 and 30),
  teacher_code      text check (char_length(teacher_code) <= 32),
  teacher_name      text check (char_length(teacher_name) <= 160),
  color             text not null default '#6366f1' check (color ~* '^#[0-9a-f]{6}$'),
  term_code         text not null check (char_length(term_code) between 1 and 16),
  starts_on         date,
  ends_on           date,
  position          integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at        timestamptz,
  constraint subjects_term_range check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create index if not exists subjects_user_sync_idx
  on public.subjects (user_id, server_updated_at);

create index if not exists subjects_user_term_idx
  on public.subjects (user_id, term_code)
  where deleted_at is null;

-- A PROPOSITO NO HAY INDICE UNICO AQUI, y conviene dejarlo escrito para que
-- nadie lo "arregle" mas adelante.
--
-- La clave natural de una asignatura es (cuatrimestre, codigo, seccion): la
-- misma materia se repite entre cuatrimestres, y dentro de uno puede estar dos
-- veces con secciones distintas (la teoria y su laboratorio). Un unico sobre
-- (user_id, lower(name)) devolveria 23505 en el segundo import, y ese codigo
-- lo clasifica `isRowRejection` como rechazo de fila: biseccion, diez
-- reintentos y la asignatura atascada en la cola para siempre.
--
-- La deduplicacion se hace donde tiene el contexto para hacerla bien: en
-- `ImportSchedulePdfUseCase`, casando por esa terna antes de escribir.


-- ---------------------------------------------------------------------------
-- schedule_blocks
-- ---------------------------------------------------------------------------

create table if not exists public.schedule_blocks (
  id                uuid primary key,
  user_id           uuid not null references auth.users (id) on delete cascade,
  -- `cascade` y no `set null` como en el resto de claves foraneas del esquema:
  -- un tramo sin asignatura no significa nada. En la practica casi nunca se
  -- dispara, porque la app borra en logico y nunca en fisico.
  subject_id        uuid not null references public.subjects (id) on delete cascade,
  weekday           smallint not null check (weekday between 0 and 6),
  starts_at         text not null check (starts_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ends_at           text not null check (ends_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  modality          text not null default 'presencial'
                      check (modality in ('presencial', 'semipresencial', 'virtual')),
  location_label    text not null default '' check (char_length(location_label) <= 120),
  is_remote         boolean not null default false,
  starts_on         date,
  ends_on           date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at        timestamptz,
  -- Comparacion de texto, no de hora: con el cero a la izquierda es lo mismo.
  constraint schedule_blocks_chronology check (ends_at > starts_at)
);

create index if not exists schedule_blocks_user_sync_idx
  on public.schedule_blocks (user_id, server_updated_at);

create index if not exists schedule_blocks_subject_idx
  on public.schedule_blocks (subject_id)
  where deleted_at is null;

create index if not exists schedule_blocks_user_weekday_idx
  on public.schedule_blocks (user_id, weekday, starts_at)
  where deleted_at is null;


-- ---------------------------------------------------------------------------
-- Sellado de `server_updated_at`
-- ---------------------------------------------------------------------------
-- Sin estos triggers la columna se queda con la hora de creacion, la bajada
-- delta no ve NUNCA un cambio y la sincronizacion parece funcionar mientras no
-- trae nada. La funcion ya existe desde 20260804000001.

drop trigger if exists subjects_touch on public.subjects;
create trigger subjects_touch
  before insert or update on public.subjects
  for each row execute function public.touch_server_updated_at();

drop trigger if exists schedule_blocks_touch on public.schedule_blocks;
create trigger schedule_blocks_touch
  before insert or update on public.schedule_blocks
  for each row execute function public.touch_server_updated_at();


-- ---------------------------------------------------------------------------
-- Seguridad a nivel de fila
-- ---------------------------------------------------------------------------
-- Cuatro politicas por tabla. Si falta cualquiera, el servidor responde 42501
-- fila a fila y la cola de salida acaba envenenada.
-- El `(select auth.uid())` envolvente es deliberado: se evalua una vez por
-- consulta en vez de una vez por fila.

alter table public.subjects enable row level security;
alter table public.schedule_blocks enable row level security;

drop policy if exists "subjects_select_own" on public.subjects;
create policy "subjects_select_own"
  on public.subjects for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "subjects_insert_own" on public.subjects;
create policy "subjects_insert_own"
  on public.subjects for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "subjects_update_own" on public.subjects;
create policy "subjects_update_own"
  on public.subjects for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "subjects_delete_own" on public.subjects;
create policy "subjects_delete_own"
  on public.subjects for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "schedule_blocks_select_own" on public.schedule_blocks;
create policy "schedule_blocks_select_own"
  on public.schedule_blocks for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "schedule_blocks_insert_own" on public.schedule_blocks;
create policy "schedule_blocks_insert_own"
  on public.schedule_blocks for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "schedule_blocks_update_own" on public.schedule_blocks;
create policy "schedule_blocks_update_own"
  on public.schedule_blocks for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "schedule_blocks_delete_own" on public.schedule_blocks;
create policy "schedule_blocks_delete_own"
  on public.schedule_blocks for delete
  to authenticated
  using ((select auth.uid()) = user_id);


-- ---------------------------------------------------------------------------
-- Tiempo real
-- ---------------------------------------------------------------------------
-- `replica identity full` es obligatorio: sin el, el aviso de Realtime trae
-- solo la clave primaria y el cliente mapearia una fila incompleta.

alter table public.subjects replica identity full;
alter table public.schedule_blocks replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'subjects'
  ) then
    alter publication supabase_realtime add table public.subjects;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'schedule_blocks'
  ) then
    alter publication supabase_realtime add table public.schedule_blocks;
  end if;
end;
$$;


comment on table public.subjects is
  'Asignaturas matriculadas. Clave natural: (user_id, term_code, code, section).';

comment on table public.schedule_blocks is
  'Tramos semanales de una asignatura. weekday 0=domingo, horas en HH:mm local.';
