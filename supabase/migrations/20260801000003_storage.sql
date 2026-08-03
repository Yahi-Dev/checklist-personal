-- =============================================================================
-- 0003 - Storage para los adjuntos
-- =============================================================================
--
-- Bucket PRIVADO. Las fotos que adjuntes a una tarea pueden ser una receta medica o
-- un documento, y un bucket publico significa que cualquiera con la URL los ve, para
-- siempre y sin autenticacion.
--
-- Convencion de rutas: `<user_id>/<task_id>/<attachment_id>-<nombre>`.
-- El primer segmento es lo que permite escribir la politica: comparar el uid del JWT
-- con la primera carpeta de la ruta.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-attachments',
  'task-attachments',
  false,
  10485760,  -- 10 MB
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
    'application/pdf',
    'text/plain', 'text/csv', 'text/markdown',
    'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- -----------------------------------------------------------------------------
-- Politicas: cada quien manda solo dentro de su propia carpeta
-- -----------------------------------------------------------------------------
-- `storage.foldername(name)` parte la ruta por '/', asi que `[1]` es el primer
-- segmento. Postgres indexa los arrays desde 1.

drop policy if exists "attachments_read_own" on storage.objects;
create policy "attachments_read_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'task-attachments'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

drop policy if exists "attachments_insert_own" on storage.objects;
create policy "attachments_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'task-attachments'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

drop policy if exists "attachments_update_own" on storage.objects;
create policy "attachments_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'task-attachments'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

drop policy if exists "attachments_delete_own" on storage.objects;
create policy "attachments_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'task-attachments'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );
