-- ===========================================================================
--  CHECKLIST PERSONAL — Arreglo de la sincronizacion
--  Pegar ENTERO en:  Supabase -> SQL Editor -> New query -> Run
--
--  Se puede ejecutar varias veces sin romper nada.
--  No borra datos ni cambia ninguna tabla: solo reemplaza una funcion y
--  añade una tabla a la lista de las que avisan en tiempo real.
--
--  QUE ARREGLA
--  -----------
--  1. Que una version VIEJA de una tarea no pueda pisar a una mas nueva.
--     Sin esto, un dispositivo que llevaba dias sin conexion subia su copia
--     antigua al reconectar y borraba en TODOS los demas la fecha de
--     vencimiento y el completado. El sintoma era que la tarea se veia bien
--     y unos minutos despues volvia atras sola.
--
--  2. Que las sesiones de enfoque tambien lleguen al instante, como ya
--     hacian las tareas, las categorias y las etiquetas.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Gana siempre la version mas reciente
-- ---------------------------------------------------------------------------
--
-- Tiene que estar EN EL SERVIDOR y no en la aplicacion: hay tres clientes
-- -web, escritorio y movil- y cada uno se actualiza cuando le toca. Un
-- telefono con la version de hace tres semanas seguira mandando lo que
-- mandaba. Una regla escrita en el unico sitio por el que pasan todos es una
-- garantia; la misma regla repetida en cada cliente es una esperanza.

create or replace function public.touch_server_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Red de seguridad: un cliente con el reloj adelantado podria mandar una
  -- marca en el futuro y ganar todos los conflictos para siempre.
  if new.updated_at is null or new.updated_at > now() + interval '1 minute' then
    new.updated_at := now();
  end if;

  if tg_op = 'UPDATE' and old.updated_at is not null and new.updated_at < old.updated_at then
    -- Llega una version anterior a la que ya hay guardada. Se descarta la
    -- escritura y se conserva la fila tal cual: esto es el conflicto
    -- resuelto, no un error. Al no tocar `server_updated_at`, la fila
    -- tampoco reaparece en los demas dispositivos como si hubiera cambiado.
    return old;
  end if;

  new.server_updated_at := now();

  return new;
end;
$$;

comment on function public.touch_server_updated_at is
  'Sella la hora del servidor para las bajadas incrementales, recorta relojes adelantados '
  'e IGNORA las escrituras mas antiguas que la fila guardada (gana el updated_at mayor).';


-- ---------------------------------------------------------------------------
-- 2. Tiempo real tambien para las sesiones de enfoque
-- ---------------------------------------------------------------------------

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


-- ---------------------------------------------------------------------------
-- Comprobacion: deberia devolver las CUATRO tablas
-- ---------------------------------------------------------------------------

select tablename as "tablas que avisan al instante"
from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
order by tablename;
