-- =============================================================================
-- 0004 - Recordatorios por Web Push
-- =============================================================================
--
-- POR QUE HACE FALTA UN SERVIDOR PARA ESTO
-- ----------------------------------------
-- Un `setTimeout` en el navegador muere al cerrar la pestaña. En iOS ademas no existe
-- ninguna alarma en segundo plano para aplicaciones web: en cuanto la PWA sale de
-- pantalla, deja de ejecutar codigo. Es una limitacion de la plataforma, no algo que
-- se pueda rodear con mas JavaScript.
--
-- La unica via que despierta al telefono con la app cerrada es Web Push, y Web Push
-- exige un emisor con la llave VAPID privada. De ahi este trozo de servidor: pg_cron
-- barre cada minuto los recordatorios vencidos y una Edge Function los envia.
--
-- Desde iOS 16.4 esto funciona en iPhone, PERO solo si la app se añadio a la pantalla
-- de inicio. En una pestaña de Safari no hay permiso de notificaciones que valga.
-- =============================================================================

create extension if not exists pg_cron  with schema extensions;
create extension if not exists pg_net   with schema extensions;

-- -----------------------------------------------------------------------------
-- Dispositivos suscritos
-- -----------------------------------------------------------------------------

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  endpoint     text not null,
  p256dh       text not null,
  auth         text not null,
  platform     text not null default 'web',
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

-- El endpoint identifica al dispositivo. Reinstalar la PWA genera uno nuevo; volver a
-- registrar el mismo debe actualizar las llaves, no duplicar la fila.
create unique index if not exists push_subscriptions_endpoint_unique
  on public.push_subscriptions (endpoint);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_select_own" on public.push_subscriptions;
create policy "push_select_own"
  on public.push_subscriptions for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "push_insert_own" on public.push_subscriptions;
create policy "push_insert_own"
  on public.push_subscriptions for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "push_update_own" on public.push_subscriptions;
create policy "push_update_own"
  on public.push_subscriptions for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "push_delete_own" on public.push_subscriptions;
create policy "push_delete_own"
  on public.push_subscriptions for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- Registro de envios
-- -----------------------------------------------------------------------------
-- Tabla aparte, sin tocar `tasks`, y esto es deliberado: marcar el envio en la propia
-- tarea moveria su `updated_at`, lo que dispararia una sincronizacion en todos los
-- dispositivos cada vez que suena un recordatorio. Ruido puro.
--
-- La clave primaria compuesta (task_id, reminder_at) es lo que hace el envio
-- idempotente: si el cron se solapa o se reintenta, el segundo insert choca y no se
-- manda la notificacion dos veces.

create table if not exists public.reminder_dispatches (
  task_id     uuid not null references public.tasks (id) on delete cascade,
  reminder_at timestamptz not null,
  sent_at     timestamptz not null default now(),
  delivered   integer not null default 0,
  failed      integer not null default 0,
  primary key (task_id, reminder_at)
);

create index if not exists reminder_dispatches_sent_idx
  on public.reminder_dispatches (sent_at desc);

alter table public.reminder_dispatches enable row level security;

-- Sin politicas para `authenticated`: esta tabla es interna del servidor. Solo la
-- Edge Function, que usa la clave de servicio, la escribe.

-- -----------------------------------------------------------------------------
-- Recordatorios listos para enviar
-- -----------------------------------------------------------------------------
-- Ventana de 5 minutos hacia atras: si el cron falla un par de veces, el recordatorio
-- se manda con retraso en lugar de perderse. Mas alla de eso ya no tiene sentido
-- avisar de algo que vencio hace media hora.

create or replace function public.pending_reminders()
returns table (
  task_id     uuid,
  user_id     uuid,
  title       text,
  due_at      timestamptz,
  reminder_at timestamptz,
  is_all_day  boolean,
  priority    text
)
language sql
security definer
set search_path = ''
as $$
  select t.id, t.user_id, t.title, t.due_at, t.reminder_at, t.is_all_day, t.priority
  from public.tasks t
  where t.deleted_at is null
    and t.status = 'pending'
    and t.reminder_at is not null
    and t.reminder_at <= now()
    and t.reminder_at > now() - interval '5 minutes'
    and not exists (
      select 1
      from public.reminder_dispatches d
      where d.task_id = t.id
        and d.reminder_at = t.reminder_at
    )
  order by t.reminder_at
  limit 200;
$$;

comment on function public.pending_reminders is
  'Recordatorios vencidos en los ultimos 5 minutos que todavia no se han enviado.';

-- -----------------------------------------------------------------------------
-- Programacion del barrido
-- -----------------------------------------------------------------------------
-- ANTES DE EJECUTAR ESTA MIGRACION hay que guardar dos secretos en el Vault de
-- Supabase (Panel -> Project Settings -> Vault), porque `net.http_post` necesita la
-- URL del proyecto y una clave con permisos:
--
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service_role_key>',        'service_role_key');
--
-- Si faltan, el bloque de abajo se salta la programacion sin romper la migracion.

do $$
declare
  v_project_url text;
  v_service_key text;
begin
  select decrypted_secret into v_project_url
  from vault.decrypted_secrets where name = 'project_url';

  select decrypted_secret into v_service_key
  from vault.decrypted_secrets where name = 'service_role_key';

  if v_project_url is null or v_service_key is null then
    raise notice 'Faltan los secretos project_url / service_role_key: no se programa el cron de recordatorios.';
    return;
  end if;

  -- Reprogramar limpio: sin esto, aplicar la migracion dos veces duplicaria el barrido.
  perform cron.unschedule('dispatch-reminders')
  where exists (select 1 from cron.job where jobname = 'dispatch-reminders');

  perform cron.schedule(
    'dispatch-reminders',
    '* * * * *',   -- cada minuto
    format(
      $cmd$
      select net.http_post(
        url     := %L,
        headers := jsonb_build_object(
                     'Content-Type',  'application/json',
                     'Authorization', %L
                   ),
        body    := '{}'::jsonb,
        timeout_milliseconds := 20000
      );
      $cmd$,
      v_project_url || '/functions/v1/dispatch-reminders',
      'Bearer ' || v_service_key
    )
  );

  raise notice 'Cron de recordatorios programado cada minuto.';
end
$$;
