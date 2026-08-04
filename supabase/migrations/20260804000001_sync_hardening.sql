-- =============================================================================
-- Endurecer la sincronizacion
-- =============================================================================
--
-- Dos arreglos que tienen que vivir EN EL SERVIDOR, no en el cliente.
--
-- El motivo de que esten aqui y no en la app: hay varios clientes -web, escritorio,
-- movil- y se actualizan cada uno por su cuenta. Un telefono con la version de hace tres
-- semanas seguira mandando lo que mandaba. Una regla escrita en el unico sitio por el que
-- pasan todos es una garantia; la misma regla repetida en cada cliente es una esperanza.

-- -----------------------------------------------------------------------------
-- 1. Que una escritura VIEJA no pueda pisar a una NUEVA
-- -----------------------------------------------------------------------------
--
-- El modelo de conflictos es "gana el `updated_at` mas reciente", pero nadie lo estaba
-- imponiendo: la subida hacia un upsert a secas, asi que ganaba el ultimo en LLEGAR, que
-- no es lo mismo. La diferencia se nota justo cuando mas duele:
--
--   Lunes 10:00  el escritorio edita una tarea sin conexion. La foto queda en su cola.
--   Martes 12:00 en la web se le pone fecha de vencimiento y se marca completada.
--   Miercoles    el escritorio recupera conexion y sube su foto del lunes.
--
-- El servidor aceptaba la foto del lunes: la fecha desaparecia y la tarea volvia a estar
-- pendiente, en TODOS los dispositivos, dias despues y sin que nadie hubiera tocado nada.
--
-- Se resuelve en el trigger que ya existia. Cuando llega una version mas antigua que la
-- guardada, se devuelve la fila actual sin cambios: la escritura se ignora en vez de
-- perder el dato. `server_updated_at` no se mueve, asi que la fila tampoco reaparece en
-- las bajadas de los demas dispositivos como si hubiera cambiado algo.
--
-- Es solo para UPDATE. Un INSERT no tiene con que compararse.

create or replace function public.touch_server_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Red de seguridad: un cliente con el reloj roto podria mandar `updated_at` en el
  -- futuro y ganar todos los conflictos para siempre. Se recorta a la hora del servidor.
  if new.updated_at is null or new.updated_at > now() + interval '1 minute' then
    new.updated_at := now();
  end if;

  if tg_op = 'UPDATE' and old.updated_at is not null and new.updated_at < old.updated_at then
    -- Llega una version anterior a la que ya hay. Se descarta la escritura entera y se
    -- conserva la fila tal cual: es el conflicto resuelto, no un error.
    return old;
  end if;

  new.server_updated_at := now();

  return new;
end;
$$;

comment on function public.touch_server_updated_at is
  'Sella la hora del servidor para las bajadas incrementales, recorta relojes adelantados '
  'e IGNORA las escrituras mas antiguas que la fila guardada (gana el updated_at mayor).';

-- -----------------------------------------------------------------------------
-- 2. Realtime tambien para focus_sessions
-- -----------------------------------------------------------------------------
--
-- Faltaba en la publicacion, asi que un pomodoro terminado en el telefono no aparecia en
-- las estadisticas de la computadora hasta la siguiente bajada periodica. Las otras tres
-- tablas ya estaban; esta se quedo fuera sin ningun motivo.

alter table public.focus_sessions replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'focus_sessions'
  ) then
    alter publication supabase_realtime add table public.focus_sessions;
  end if;
end;
$$;
