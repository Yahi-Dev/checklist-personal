import { afterEach, describe, expect, it } from 'vitest';

import {
  clearAuthCallbackFromUrl,
  readAuthCallbackError,
} from '../../src/infrastructure/supabase/auth-callback';

/**
 * Coloca una URL como si el navegador acabara de llegar a ella.
 *
 * `jsdom` no deja reasignar `location`, asi que se navega con `replaceState`, que es
 * justo lo que hace el navegador de verdad al volver de un enlace de correo.
 */
const land = (url: string): void => {
  globalThis.history.replaceState(null, '', url);
};

afterEach(() => {
  land('/');
});

describe('readAuthCallbackError', () => {
  it('no ve nada en una URL limpia', () => {
    land('/');
    expect(readAuthCallbackError()).toBeNull();
  });

  it('no confunde una ruta del enrutador por hash con un retorno de Supabase', () => {
    land('/#/hoy');
    expect(readAuthCallbackError()).toBeNull();
  });

  it('lee el error del fragmento, que es donde lo pone el flujo implicito', () => {
    land(
      '/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    );

    const result = readAuthCallbackError();

    expect(result?.code).toBe('otp_expired');
    // El mensaje original solo dice "invalido o caducado", que deja al usuario sin
    // saber que hacer. El nuestro explica que es de un solo uso y cual es el paso.
    expect(result?.message).toMatch(/un solo uso/i);
  });

  it('lee el error de la query, que es donde lo pone el flujo PKCE', () => {
    land('/?error=access_denied&error_code=otp_expired');
    expect(readAuthCallbackError()?.code).toBe('otp_expired');
  });

  it('sobrevive al caso real, con el motivo repetido en la query y en el fragmento', () => {
    land(
      '/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired' +
        '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=',
    );

    expect(readAuthCallbackError()?.code).toBe('otp_expired');
  });

  it('cae en el codigo generico cuando no viene `error_code`', () => {
    land('/?error=server_error&error_description=Algo+fallo');

    const result = readAuthCallbackError();

    expect(result?.code).toBe('server_error');
    // Los `+` de la codificacion de formulario tienen que salir como espacios.
    expect(result?.message).toBe('Algo fallo');
  });

  it('avisa de la lista blanca cuando Supabase rechaza el destino', () => {
    land('/?error_code=validation_failed');
    expect(readAuthCallbackError()?.message).toMatch(/Redirect URLs/i);
  });

  it('nunca deja al usuario sin mensaje', () => {
    land('/?error=raro_y_desconocido');

    const result = readAuthCallbackError();

    expect(result).not.toBeNull();
    expect(result?.message.length).toBeGreaterThan(0);
  });
});

describe('clearAuthCallbackFromUrl', () => {
  it('deja la URL sin rastro del error', () => {
    land('/?error=access_denied&error_code=otp_expired#error=access_denied');

    clearAuthCallbackFromUrl();

    expect(globalThis.location.search).toBe('');
    expect(globalThis.location.hash).toBe('');
    // Y una segunda lectura ya no encuentra nada: recargar no revive el error.
    expect(readAuthCallbackError()).toBeNull();
  });
});
