-- ===========================================================================
--  Verificacion: confirma que todo quedo instalado correctamente.
--  Pegar en el SQL Editor y pulsar Run. Debe devolver 4 filas, todas "OK".
-- ===========================================================================

select 'Tablas creadas' as comprobacion,
       count(*)::text || ' de 4' as resultado,
       case when count(*) = 4 then 'OK' else 'FALTA ALGO' end as estado
from information_schema.tables
where table_schema = 'public'
  and table_name in ('tasks', 'categories', 'tags', 'focus_sessions')

union all

select 'Seguridad RLS activa',
       count(*)::text || ' de 4',
       case when count(*) = 4 then 'OK' else 'FALTA ALGO' end
from pg_tables
where schemaname = 'public'
  and tablename in ('tasks', 'categories', 'tags', 'focus_sessions')
  and rowsecurity = true

union all

select 'Politicas de acceso',
       count(*)::text || ' (se esperan 16)',
       case when count(*) >= 16 then 'OK' else 'FALTA ALGO' end
from pg_policies
where schemaname = 'public'

union all

select 'Bucket de adjuntos',
       coalesce(max(id), 'no encontrado'),
       case when count(*) = 1 then 'OK' else 'FALTA ALGO' end
from storage.buckets
where id = 'task-attachments';
