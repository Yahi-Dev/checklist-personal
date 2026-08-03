// deno-lint-ignore-file no-explicit-any
/**
 * Edge Function: envio de recordatorios por Web Push.
 *
 * pg_cron la invoca cada minuto. Su trabajo es:
 *   1. Preguntar a `pending_reminders()` que recordatorios vencieron.
 *   2. Buscar los dispositivos suscritos de cada usuario.
 *   3. Mandar la notificacion cifrada a cada endpoint.
 *   4. Anotar el envio para no repetirlo.
 *
 * Esta funcion es la UNICA pieza de servidor del proyecto, y existe solo porque en
 * iOS no hay forma de despertar una PWA cerrada sin Web Push. Todo lo demas corre en
 * el dispositivo.
 *
 * DESPLIEGUE
 *   supabase functions deploy dispatch-reminders --no-verify-jwt
 *   supabase secrets set VAPID_PUBLIC_KEY=...  VAPID_PRIVATE_KEY=...  VAPID_SUBJECT=mailto:tu@correo.com
 *
 * `--no-verify-jwt` porque quien llama es pg_cron con la clave de servicio en la
 * cabecera, no un usuario con sesion.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

interface PendingReminder {
  task_id: string;
  user_id: string;
  title: string;
  due_at: string | null;
  reminder_at: string;
  is_all_day: boolean;
  priority: 'low' | 'medium' | 'high';
}

interface Subscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:noreply@checklist.local';

Deno.serve(async (): Promise<Response> => {
  if (VAPID_PUBLIC_KEY === '' || VAPID_PRIVATE_KEY === '') {
    return json({ error: 'Faltan las llaves VAPID en los secretos de la funcion.' }, 500);
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: reminders, error } = await supabase.rpc('pending_reminders');

  if (error !== null) {
    return json({ error: `No se pudieron leer los recordatorios: ${error.message}` }, 500);
  }

  const pending = (reminders ?? []) as PendingReminder[];
  if (pending.length === 0) {
    return json({ processed: 0, delivered: 0 });
  }

  // Una sola consulta para todos los dispositivos implicados: con varios recordatorios
  // del mismo usuario en el mismo minuto, pedirlos uno a uno multiplicaria las llamadas.
  const userIds = [...new Set(pending.map((reminder) => reminder.user_id))];

  const { data: subscriptionRows } = await supabase
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .in('user_id', userIds);

  const byUser = new Map<string, Subscription[]>();
  for (const row of (subscriptionRows ?? []) as (Subscription & { user_id: string })[]) {
    const bucket = byUser.get(row.user_id) ?? [];
    bucket.push(row);
    byUser.set(row.user_id, bucket);
  }

  let delivered = 0;
  let failed = 0;
  const expiredSubscriptionIds: string[] = [];

  for (const reminder of pending) {
    const subscriptions = byUser.get(reminder.user_id) ?? [];

    const payload = JSON.stringify({
      title: reminder.priority === 'high' ? `Importante: ${reminder.title}` : reminder.title,
      body: buildBody(reminder),
      taskId: reminder.task_id,
      deepLink: `#/tarea/${reminder.task_id}`,
      tag: `task-reminder:${reminder.task_id}`,
    });

    const results = await Promise.allSettled(
      subscriptions.map((subscription) =>
        webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
          { TTL: 3600, urgency: 'high' },
        ),
      ),
    );

    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        delivered += 1;
        continue;
      }

      failed += 1;

      // 404 y 410 significan que el navegador tiro la suscripcion (app desinstalada,
      // permisos revocados). Reintentar sobre ella es basura permanente en la tabla.
      const statusCode = (result.reason as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        const stale = subscriptions[index];
        if (stale !== undefined) expiredSubscriptionIds.push(stale.id);
      }
    }

    // Se anota SIEMPRE, incluso si todos los envios fallaron: sin dispositivos
    // suscritos no hay nada que reintentar, y sin la anotacion el mismo recordatorio
    // se procesaria en bucle cada minuto durante los siguientes cinco.
    await supabase.from('reminder_dispatches').insert({
      task_id: reminder.task_id,
      reminder_at: reminder.reminder_at,
      delivered: results.filter((result) => result.status === 'fulfilled').length,
      failed: results.filter((result) => result.status === 'rejected').length,
    });
  }

  if (expiredSubscriptionIds.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', expiredSubscriptionIds);
  }

  return json({
    processed: pending.length,
    delivered,
    failed,
    prunedSubscriptions: expiredSubscriptionIds.length,
  });
});

const buildBody = (reminder: PendingReminder): string => {
  if (reminder.due_at === null) return 'Tienes un recordatorio pendiente.';

  const due = new Date(reminder.due_at);

  if (reminder.is_all_day) {
    return `Vence hoy, ${due.toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'long',
      timeZone: 'America/Santo_Domingo',
    })}.`;
  }

  return `Vence a las ${due.toLocaleTimeString('es-DO', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Santo_Domingo',
  })}.`;
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
