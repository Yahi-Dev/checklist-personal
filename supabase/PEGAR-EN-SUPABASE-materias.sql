-- ===========================================================================
--  CHECKLIST PERSONAL - Tareas por materia, nivel de atencion y notas
--  Pegar ENTERO en:  Supabase -> SQL Editor -> New query -> Run
--
--  Se puede ejecutar varias veces sin romper nada.
--
--  QUE HACE
--  --------
--  1. Añade `subject_id` a `tasks`, para que una tarea pueda pertenecer a una
--     materia y aun asi seguir siendo una tarea normal: aparece en Hoy, en
--     Proximas y en el Calendario, te avisa y la ve el asistente.
--  2. Añade `attention` a `subjects`, el nivel de atencion de cada materia.
--  3. Crea `subject_notes`, para las observaciones que no son tareas.
--
--  PEGA ESTO ANTES DE ACTUALIZAR LA APP.
--  El orden importa de verdad aqui, mas que en veces anteriores: `tasks` es una
--  tabla llena y en uso, y si la app aprende la columna antes de que exista en
--  el servidor, este rechaza la peticion entera y dejan de subir TODAS las
--  tareas -no solo lo del horario-. La app ya sabe sobrevivir a eso sin perder
--  nada ni atascar la cola, pero mientras tanto no sincroniza.
--
--  Hace falta haber ejecutado antes PEGAR-EN-SUPABASE-horario.sql: estas tres
--  cosas cuelgan de la tabla `subjects`.
-- ===========================================================================


-- ===========================================================================
--  0007 - La materia como hilo conductor
-- ===========================================================================
--  Tres cosas, y solo una es una tabla nueva.
--
--  1. `tasks.subject_id`. Una tarea de Calculo tiene que SER una tarea, no un
--     pariente pobre que vive dentro del horario: asi hereda vencimiento,
--     recordatorio, subtareas, prioridad, repeticion, busqueda, estadisticas y
--     el asistente. El coste de eso es esta columna. La alternativa -una entidad
--     de "tarea de materia" propia- habria producido dos listas de pendientes
--     que no se hablan entre si.
--
--  2. `subjects.attention`. Cuanto hay que vigilar esa materia. Cambia como se
--     pinta su tarjeta, nunca su color: el color es identidad -"la morada es
--     Calculo"- y si ademas significara urgencia dejaria de servir para las dos
--     cosas.
--
--  3. `subject_notes`. Lo que NO es una tarea: "el parcial cubre hasta el
--     capitulo 4". No vence, no se completa y no es un pendiente, asi que no
--     cabe en `tasks` por mucho que se fuerce.
--
--  Las notas se clasifican por TIPO y no por importancia. "Alta/media/baja"
--  dice cuanto te importa; el tipo dice que hacer con ello, y es lo que permite
--  preguntar "enseñame todo lo que entra en el parcial de Fisica".
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. La tarea sabe de que materia es
-- ---------------------------------------------------------------------------
-- `set null` y no `cascade`, igual que con las categorias: dar de baja una
-- asignatura no puede llevarse por delante las tareas que hiciste para ella.

alter table public.tasks
  add column if not exists subject_id uuid references public.subjects (id) on delete set null;

create index if not exists tasks_user_subject_idx
  on public.tasks (user_id, subject_id)
  where deleted_at is null and subject_id is not null;


-- ---------------------------------------------------------------------------
-- 2. Cuanta atencion pide la materia
-- ---------------------------------------------------------------------------
-- Cuatro niveles y no tres. "relaxed" parece el menos util y es justo al reves:
-- apagar lo que no necesitas mirar es lo que hace que destaque lo que si, sin
-- tener que pintar nada de rojo.

alter table public.subjects
  add column if not exists attention text not null default 'normal'
    check (attention in ('critical', 'watch', 'normal', 'relaxed'));


-- ---------------------------------------------------------------------------
-- 3. subject_notes
-- ---------------------------------------------------------------------------

create table if not exists public.subject_notes (
  id                uuid primary key,
  user_id           uuid not null references auth.users (id) on delete cascade,
  -- `cascade` aqui si: una observacion sobre una materia que ya no existe no
  -- significa nada. En la practica casi nunca se dispara, porque la app borra
  -- en logico y nunca en fisico.
  subject_id        uuid not null references public.subjects (id) on delete cascade,
  kind              text not null default 'note'
                      check (kind in ('exam', 'assignment', 'notice', 'note')),
  body              text not null check (char_length(body) between 1 and 4000),
  is_pinned         boolean not null default false,
  position          integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at        timestamptz
);

create index if not exists subject_notes_user_sync_idx
  on public.subject_notes (user_id, server_updated_at);

create index if not exists subject_notes_subject_idx
  on public.subject_notes (subject_id, is_pinned, position)
  where deleted_at is null;


-- ---------------------------------------------------------------------------
-- Sellado de `server_updated_at`
-- ---------------------------------------------------------------------------
-- Sin el trigger, la columna se queda con la hora de creacion, la bajada delta
-- no ve NUNCA un cambio y la sincronizacion parece funcionar sin traer nada.

drop trigger if exists subject_notes_touch on public.subject_notes;
create trigger subject_notes_touch
  before insert or update on public.subject_notes
  for each row execute function public.touch_server_updated_at();


-- ---------------------------------------------------------------------------
-- Seguridad a nivel de fila
-- ---------------------------------------------------------------------------

alter table public.subject_notes enable row level security;

drop policy if exists "subject_notes_select_own" on public.subject_notes;
create policy "subject_notes_select_own"
  on public.subject_notes for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "subject_notes_insert_own" on public.subject_notes;
create policy "subject_notes_insert_own"
  on public.subject_notes for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "subject_notes_update_own" on public.subject_notes;
create policy "subject_notes_update_own"
  on public.subject_notes for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "subject_notes_delete_own" on public.subject_notes;
create policy "subject_notes_delete_own"
  on public.subject_notes for delete
  to authenticated
  using ((select auth.uid()) = user_id);


-- ---------------------------------------------------------------------------
-- Tiempo real
-- ---------------------------------------------------------------------------

alter table public.subject_notes replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'subject_notes'
  ) then
    alter publication supabase_realtime add table public.subject_notes;
  end if;
end;
$$;


comment on table public.subject_notes is
  'Observaciones de una materia que no son tareas: lo que entra en el examen, un aviso del profesor.';

comment on column public.tasks.subject_id is
  'Materia a la que pertenece la tarea. Null = tarea normal, sin relacion con el horario.';

comment on column public.subjects.attention is
  'Cuanta atencion pide: critical | watch | normal | relaxed. Solo cambia como se pinta.';
