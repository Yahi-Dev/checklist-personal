#!/usr/bin/env node
/**
 * Genera el par de llaves VAPID para Web Push.
 *
 * VAPID (RFC 8292) es como el servicio de push del navegador -Apple, Google, Mozilla-
 * comprueba que quien manda la notificacion es de verdad tu servidor y no cualquiera
 * que haya interceptado el endpoint de suscripcion. Sin este par de llaves, el iPhone
 * no recibe ningun aviso con la app cerrada.
 *
 * Se usa `crypto` de Node en vez de la libreria `web-push` para no arrastrar una
 * dependencia que solo haria falta una vez en la vida del proyecto.
 *
 *   node scripts/generate-vapid-keys.mjs
 */
import { generateKeyPairSync } from 'node:crypto';

/** base64url: el alfabeto que exige la especificacion de Web Push. */
const toBase64Url = (buffer) =>
  buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Curva P-256 (prime256v1): la unica que admite Web Push.
const { publicKey, privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  publicKeyEncoding: { type: 'spki', format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'der' },
});

// La clave publica va en formato "uncompressed point" (65 bytes que empiezan por 0x04).
// En el DER de SPKI esos bytes son los ultimos 65.
const publicKeyRaw = publicKey.subarray(publicKey.length - 65);

// La privada son los 32 bytes del escalar, que en el PKCS#8 de P-256 estan en un
// desplazamiento fijo.
const privateKeyRaw = privateKey.subarray(36, 68);

const publicBase64 = toBase64Url(publicKeyRaw);
const privateBase64 = toBase64Url(privateKeyRaw);

console.log(`
Llaves VAPID generadas
======================

1) En tu archivo .env (la publica va al cliente):

   VITE_VAPID_PUBLIC_KEY=${publicBase64}

2) Como secretos de la Edge Function (la privada NUNCA sale del servidor):

   supabase secrets set VAPID_PUBLIC_KEY=${publicBase64}
   supabase secrets set VAPID_PRIVATE_KEY=${privateBase64}
   supabase secrets set VAPID_SUBJECT=mailto:tu@correo.com

Guardalas: si las pierdes, todos los dispositivos suscritos dejan de recibir
notificaciones y hay que volver a registrarlos uno a uno.
`);
