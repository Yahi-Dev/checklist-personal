/**
 * Lectura del retorno de un enlace de correo.
 *
 * Cuando algo sale mal, Supabase no devuelve un error por la API: redirige al navegador
 * a la app con el motivo pegado en la URL. Sin este modulo, ese viaje termina en la
 * pantalla de acceso EXACTAMENTE igual que si el usuario hubiera entrado por su cuenta,
 * sin una sola palabra de que el enlace fallo ni de por que. Es el peor final posible
 * para un flujo que empieza en el correo: el usuario no sabe si reintentar, si pedir
 * otro enlace o si la cuenta quedo mal creada.
 *
 * El motivo llega por partida doble -en la query y en el fragmento- porque Supabase lo
 * pone en los dos sitios para servir tanto al flujo PKCE como al implicito. Se leen los
 * dos y gana el que traiga algo.
 */

export interface AuthCallbackError {
  /** Codigo de Supabase, util para depurar. */
  readonly code: string;
  /** Mensaje ya en español y accionable. */
  readonly message: string;
}

let captured: AuthCallbackError | null = null;

/**
 * Recoge el error de la URL y limpia la barra de direcciones. Se llama UNA vez desde
 * `main.tsx`, antes de montar React.
 *
 * El momento importa, y por dos motivos opuestos:
 *
 * TIENE QUE SER ANTES DE QUE MONTE EL ENRUTADOR. El enrutado es por hash, asi que un
 * `#error=access_denied&...` en la URL se interpreta como una ruta; como no existe, la
 * app enseña "Esta pagina no existe" en lugar de contar lo que paso. Limpiando antes,
 * el enrutador nunca llega a ver ese fragmento.
 *
 * PERO SOLO SE LIMPIA SI ES UN ERROR. Cuando el enlace funciona, la vuelta trae
 * `?code=...` y es Supabase quien tiene que leerlo (`detectSessionInUrl`) para canjearlo
 * por una sesion. Borrar la URL en ese caso romperia el unico camino que si funciona.
 */
export const captureAuthCallbackError = (): void => {
  captured = readAuthCallbackError();
  if (captured !== null) clearAuthCallbackFromUrl();
};

/** El error recogido al arrancar, si lo hubo. */
export const getAuthCallbackError = (): AuthCallbackError | null => captured;

export const readAuthCallbackError = (): AuthCallbackError | null => {
  const location = globalThis.location as Location | undefined;
  if (location === undefined) return null;

  const fromQuery = new URLSearchParams(location.search);
  // El fragmento puede ser `#error=...` (retorno de Supabase) o `#/hoy` (ruta de la
  // app). Solo interesa el primero, y `URLSearchParams` ignora lo que no sean pares.
  const fromHash = new URLSearchParams(location.hash.replace(/^#/u, ''));

  const pick = (key: string): string => fromHash.get(key) ?? fromQuery.get(key) ?? '';

  const error = pick('error');
  const code = pick('error_code');
  if (error === '' && code === '') return null;

  return { code: code === '' ? error : code, message: describe(code, pick('error_description')) };
};

/**
 * Borra el retorno de la barra de direcciones.
 *
 * Con `replaceState` y no navegando: asi no queda una entrada en el historial cuyo
 * "atras" devuelva al usuario al mismo error, y recargar la pagina no lo resucita.
 */
export const clearAuthCallbackFromUrl = (): void => {
  const location = globalThis.location as Location | undefined;
  if (location === undefined || (globalThis.history as History | undefined) === undefined) return;

  globalThis.history.replaceState(null, '', location.pathname);
};

/**
 * Traduce el codigo a algo que se pueda leer y sobre lo que se pueda actuar.
 *
 * `otp_expired` es el que mas se ve y el peor explicado por el mensaje original ("Email
 * link is invalid or has expired"), porque casi nunca es cuestion de tiempo: el enlace
 * es de UN SOLO USO y se gasta en el primer clic aunque el destino no llegue a cargar.
 * Si la primera vez el enlace apuntaba a un sitio equivocado, el segundo intento ya
 * encuentra el token gastado. Tambien lo gastan los antivirus de correo que abren los
 * enlaces antes que tu.
 */
const describe = (code: string, description: string): string => {
  switch (code) {
    case 'otp_expired':
      return (
        'Ese enlace ya no vale: son de un solo uso y caducan. Pide uno nuevo desde aqui ' +
        'y abrelo en cuanto llegue, en este mismo navegador.'
      );

    case 'access_denied':
      return 'Se cancelo el acceso o el enlace ya no era valido. Vuelve a intentarlo.';

    case 'email_not_confirmed':
      return 'Falta confirmar tu correo. Busca el mensaje de confirmacion en tu buzon.';

    case 'signup_disabled':
      return 'El registro esta desactivado en este proyecto.';

    case 'validation_failed':
      return 'La direccion de retorno no esta autorizada en Supabase. Revisa la lista de Redirect URLs.';

    default:
      return description.replaceAll('+', ' ').trim() || 'No se pudo completar el acceso.';
  }
};
