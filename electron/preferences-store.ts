import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DesktopPreferences } from '../src/shared/desktop-bridge';

/**
 * Preferencias del escritorio, en un JSON dentro de la carpeta de datos del usuario.
 *
 * Se guardan en el proceso PRINCIPAL y no en localStorage porque hacen falta ANTES de
 * que exista una ventana: "abrir minimizado" hay que saberlo en el momento de crearla,
 * y para entonces todavia no hay renderer que pueda leer localStorage.
 */
const FILE_NAME = 'desktop-preferences.json';

const DEFAULTS: DesktopPreferences = {
  launchAtLogin: false,
  startMinimized: false,
  /**
   * Cerrar manda a la bandeja en vez de salir. Es lo que permite que los
   * recordatorios sigan llegando con la ventana cerrada, que es todo el sentido de
   * tener una version de escritorio.
   */
  closeToTray: true,
};

const filePath = (): string => join(app.getPath('userData'), FILE_NAME);

export const readPreferences = (): DesktopPreferences => {
  try {
    const raw = readFileSync(filePath(), 'utf8');
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<DesktopPreferences>) };
  } catch {
    // No existe todavia, o quedo corrupto: en ambos casos valen los valores por defecto.
    return DEFAULTS;
  }
};

export const writePreferences = (patch: Partial<DesktopPreferences>): DesktopPreferences => {
  const next: DesktopPreferences = { ...readPreferences(), ...patch };

  try {
    writeFileSync(filePath(), JSON.stringify(next, null, 2), 'utf8');
  } catch (error) {
    console.error('[preferences] no se pudieron guardar', error);
  }

  // El arranque con el sistema lo gestiona Windows, no el archivo: hay que
  // sincronizarlo con el registro cada vez que cambia.
  if (patch.launchAtLogin !== undefined) {
    app.setLoginItemSettings({
      openAtLogin: patch.launchAtLogin,
      // Con `--hidden` arranca directo a la bandeja: nadie quiere una ventana
      // saltandole a la cara al encender la computadora.
      args: ['--hidden'],
    });
  }

  return next;
};
