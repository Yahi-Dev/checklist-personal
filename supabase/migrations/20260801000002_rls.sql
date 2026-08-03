-- =============================================================================
-- 0002 - Row Level Security
-- =============================================================================
--
-- La app usa la clave `anon`, que va EMBEBIDA en el bundle y por tanto es publica:
-- cualquiera puede leerla del JavaScript descargado. Lo unico que impide que un
-- tercero lea tus tareas es RLS.
--
-- Regla unica y sin excepciones: `user_id = auth.uid()`.
--
-- `auth.uid()` sale del JWT firmado por Supabase, no de nada que el cliente pueda
-- inventarse. Se envuelve en `(select auth.uid())` porque asi Postgres lo evalua UNA
-- vez por consulta en lugar de una vez por fila: en tablas con miles de filas la
-- diferencia es notable.
-- =============================================================================

alter table public.categories     enable row level security;
alter table public.tags           enable row level security;
alter table public.tasks          enable row level security;
alter table public.focus_sessions enable row level security;

-- -----------------------------------------------------------------------------
-- categories
-- -----------------------------------------------------------------------------

drop policy if exists "categories_select_own" on public.categories;
create policy "categories_select_own"
  on public.categories for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "categories_insert_own" on public.categories;
create policy "categories_insert_own"
  on public.categories for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "categories_update_own" on public.categories;
create policy "categories_update_own"
  on public.categories for update
  to authenticated
  using ((select auth.uid()) = user_id)
  -- El WITH CHECK evita reasignar una fila propia a otro usuario en el UPDATE.
  with check ((select auth.uid()) = user_id);

drop policy if exists "categories_delete_own" on public.categories;
create policy "categories_delete_own"
  on public.categories for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- tags
-- -----------------------------------------------------------------------------

drop policy if exists "tags_select_own" on public.tags;
create policy "tags_select_own"
  on public.tags for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "tags_insert_own" on public.tags;
create policy "tags_insert_own"
  on public.tags for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "tags_update_own" on public.tags;
create policy "tags_update_own"
  on public.tags for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "tags_delete_own" on public.tags;
create policy "tags_delete_own"
  on public.tags for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- tasks
-- -----------------------------------------------------------------------------

drop policy if exists "tasks_select_own" on public.tasks;
create policy "tasks_select_own"
  on public.tasks for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "tasks_insert_own" on public.tasks;
create policy "tasks_insert_own"
  on public.tasks for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "tasks_update_own" on public.tasks;
create policy "tasks_update_own"
  on public.tasks for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "tasks_delete_own" on public.tasks;
create policy "tasks_delete_own"
  on public.tasks for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- focus_sessions
-- -----------------------------------------------------------------------------

drop policy if exists "focus_sessions_select_own" on public.focus_sessions;
create policy "focus_sessions_select_own"
  on public.focus_sessions for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "focus_sessions_insert_own" on public.focus_sessions;
create policy "focus_sessions_insert_own"
  on public.focus_sessions for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "focus_sessions_update_own" on public.focus_sessions;
create policy "focus_sessions_update_own"
  on public.focus_sessions for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "focus_sessions_delete_own" on public.focus_sessions;
create policy "focus_sessions_delete_own"
  on public.focus_sessions for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- Realtime
-- -----------------------------------------------------------------------------
-- Realtime respeta RLS: cada cliente solo recibe los eventos de sus propias filas.
-- REPLICA IDENTITY FULL hace que el payload traiga la fila completa; sin ella solo
-- llegaria la clave primaria y habria que ir a buscar el resto con otra consulta.

alter table public.tasks          replica identity full;
alter table public.categories     replica identity full;
alter table public.tags           replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;
end
$$;

alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.categories;
alter publication supabase_realtime add table public.tags;
