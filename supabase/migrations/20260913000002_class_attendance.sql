-- ===========================================================================
--  0008 - Asistencia a clase
-- ===========================================================================
--  Una fila por clase MARCADA, no por clase que existe.
--
--  El calendario de sesiones esperadas se calcula al vuelo desde el tramo y el
--  rango de fechas del cuatrimestre, que ya estan en `schedule_blocks`. Generar
--  una fila por cada clase del semestre serian cientos de filas por cuatrimestre
--  viajando por la sincronizacion para no decir nada, y ademas obligaria a
--  regenerarlas cada vez que se corrige un horario.
--
--  El dato que se enseña NO es "85% de asistencia": es "te quedan 3 faltas". Si
--  la universidad te reprueba pasando un limite, eso es lo unico que importa, y
--  por eso el limite es un campo por asignatura que pone el usuario.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Cuantas faltas admite la asignatura
-- ---------------------------------------------------------------------------
-- Nullable a proposito: vacio = sin limite. No se inventa un numero por defecto
-- porque cada universidad y cada profesor tienen el suyo, y un tope inventado
-- que avise de mas es peor que no avisar.

alter table public.subjects
  add column if not exists max_absences integer
    check (max_absences is null or max_absences >= 0);


-- ---------------------------------------------------------------------------
-- 2. class_attendance
-- ---------------------------------------------------------------------------

create table if not exists public.class_attendance (
  id                uuid primary key,
  user_id           uuid not null references auth.users (id) on delete cascade,
  block_id          uuid not null references public.schedule_blocks (id) on delete cascade,
  -- Desnormalizado a proposito: casi todas las preguntas son por MATERIA ("cuantas
  -- faltas llevo en Fisica") y sin esto cada una obligaria a pasar por los tramos.
  subject_id        uuid not null references public.subjects (id) on delete cascade,
  -- El dia concreto de esa clase, en hora local. `date` y no `timestamptz`: lo que
  -- se marca es "el martes falte", no un instante.
  session_date      date not null,
  status            text not null
                      check (status in ('attended', 'absent', 'excused', 'cancelled')),
  note              text check (char_length(note) <= 200),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at        timestamptz
);

create index if not exists class_attendance_user_sync_idx
  on public.class_attendance (user_id, server_updated_at);

create index if not exists class_attendance_subject_idx
  on public.class_attendance (subject_id, session_date)
  where deleted_at is null;

create index if not exists class_attendance_block_idx
  on public.class_attendance (block_id, session_date)
  where deleted_at is null;

-- SIN INDICE UNICO sobre (user_id, block_id, session_date), y aqui la razon es
-- mas fuerte que en `subjects`.
--
-- El escenario es real y corriente: marcas la clase del martes en el telefono
-- sin conexion y la marcas tambien en la computadora. Son dos filas con ids
-- distintos para el mismo dia, y un indice unico las rechazaria con 23505 -que
-- `isRowRejection` clasifica como fila mala-, gastando los diez intentos y
-- dejando la entrada envenenada.
--
-- La fusion se hace en el cliente, por clave natural `(block_id, session_date)`,
-- que es donde se sabe cual de las dos marcas es la buena.


-- ---------------------------------------------------------------------------
-- Sellado de `server_updated_at`
-- ---------------------------------------------------------------------------

drop trigger if exists class_attendance_touch on public.class_attendance;
create trigger class_attendance_touch
  before insert or update on public.class_attendance
  for each row execute function public.touch_server_updated_at();


-- ---------------------------------------------------------------------------
-- Seguridad a nivel de fila
-- ---------------------------------------------------------------------------

alter table public.class_attendance enable row level security;

drop policy if exists "class_attendance_select_own" on public.class_attendance;
create policy "class_attendance_select_own"
  on public.class_attendance for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "class_attendance_insert_own" on public.class_attendance;
create policy "class_attendance_insert_own"
  on public.class_attendance for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "class_attendance_update_own" on public.class_attendance;
create policy "class_attendance_update_own"
  on public.class_attendance for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "class_attendance_delete_own" on public.class_attendance;
create policy "class_attendance_delete_own"
  on public.class_attendance for delete
  to authenticated
  using ((select auth.uid()) = user_id);


-- ---------------------------------------------------------------------------
-- Tiempo real
-- ---------------------------------------------------------------------------

alter table public.class_attendance replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'class_attendance'
  ) then
    alter publication supabase_realtime add table public.class_attendance;
  end if;
end;
$$;


comment on table public.class_attendance is
  'Una fila por clase MARCADA. Las sesiones esperadas se calculan desde el tramo, no se guardan.';

comment on column public.subjects.max_absences is
  'Faltas que admite la asignatura antes de reprobar. Null = sin limite.';
