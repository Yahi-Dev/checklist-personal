import type { DesktopBridge } from '../../shared/desktop-bridge';
import type { PlatformKind, PlatformService } from '../../application/ports/services';
import type { Result } from '../../domain/shared/result';

import { err, ok } from '../../domain/shared/result';
import { toDomainError } from '../../domain/shared/domain-error';

/**
 * Detecta donde corre la app y adapta las capacidades que dependen del sistema.
 *
 * Todas las diferencias entre plataformas se concentran aqui. Sin este puerto, la
 * interfaz acabaria salpicada de `if (window.desktop)` y de comprobaciones de
 * `userAgent`, y añadir Android obligaria a buscarlas una por una.
 */
export class BrowserPlatformService implements PlatformService {
  readonly kind: PlatformKind;
  readonly isDesktop = false;
  readonly isStandalone: boolean;
  readonly supportsNativeNotifications: boolean;
  /**
   * Falso siempre en web. Los recordatorios por ubicacion necesitan geolocalizacion en
   * segundo plano, y ningun navegador la ofrece: `watchPosition` se detiene en cuanto
   * la pestaña pasa a segundo plano. Solo una app nativa puede hacerlo.
   */
  readonly supportsBackgroundGeolocation = false;

  constructor() {
    this.isStandalone = detectStandalone();
    this.kind = detectPlatformKind(this.isStandalone);
    this.supportsNativeNotifications = typeof Notification !== 'undefined';
  }

  async openExternal(url: string): Promise<void> {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  /** En web "guardar archivo" es disparar una descarga con un enlace sintetico. */
  async saveFile(fileName: string, contents: string, mimeType: string): Promise<Result<void>> {
    try {
      const blob = new Blob([contents], { type: mimeType });
      const url = URL.createObjectURL(blob);

      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      // Liberar de inmediato cancelaria la descarga en algunos navegadores.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      return ok(undefined);
    } catch (cause) {
      return err(toDomainError(cause, 'No se pudo guardar el archivo.'));
    }
  }

  async pickFile(accept: string): Promise<Result<string | null>> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;

      input.onchange = () => {
        const file = input.files?.[0];
        if (file === undefined) {
          resolve(ok(null));
          return;
        }

        const reader = new FileReader();

        reader.onload = () => {
          // `readAsText` siempre produce string; el tipo admite ArrayBuffer porque el
          // mismo lector sirve para `readAsArrayBuffer`.
          const contents = typeof reader.result === 'string' ? reader.result : '';
          resolve(ok(contents));
        };

        reader.onerror = () =>
          resolve(err(toDomainError(reader.error, 'No se pudo leer el archivo.')));

        reader.readAsText(file);
      };

      // Sin seleccion no se dispara ningun evento: se resuelve con null al cancelar.
      input.oncancel = () => resolve(ok(null));
      input.click();
    });
  }
}

export class ElectronPlatformService implements PlatformService {
  readonly kind: PlatformKind = 'electron';
  readonly isDesktop = true;
  readonly isStandalone = true;
  readonly supportsNativeNotifications = true;
  readonly supportsBackgroundGeolocation = false;

  constructor(private readonly bridge: DesktopBridge) {}

  async openExternal(url: string): Promise<void> {
    await this.bridge.shell.openExternal(url);
  }

  async saveFile(fileName: string, contents: string): Promise<Result<void>> {
    try {
      await this.bridge.files.save(fileName, contents);
      return ok(undefined);
    } catch (cause) {
      return err(toDomainError(cause, 'No se pudo guardar el archivo.'));
    }
  }

  async pickFile(accept: string): Promise<Result<string | null>> {
    try {
      const extensions = accept
        .split(',')
        .map((entry) => entry.trim().replace(/^\./u, ''))
        .filter((entry) => entry.length > 0 && !entry.includes('/'));

      const contents = await this.bridge.files.open([
        { name: 'Respaldo', extensions: extensions.length > 0 ? extensions : ['json'] },
      ]);

      return ok(contents);
    } catch (cause) {
      return err(toDomainError(cause, 'No se pudo abrir el archivo.'));
    }
  }
}

const detectStandalone = (): boolean => {
  if (typeof window === 'undefined') return false;

  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // Propiedad no estandar de Safari en iOS: es la unica forma de saber si la PWA se
    // abrio desde la pantalla de inicio, cosa de la que depende el permiso de push.
    (window.navigator as { standalone?: boolean }).standalone === true
  );
};

const detectPlatformKind = (isStandalone: boolean): PlatformKind => {
  if (typeof navigator === 'undefined') return 'web';

  const agent = navigator.userAgent;

  if (/iphone|ipad|ipod/iu.test(agent)) return isStandalone ? 'ios-pwa' : 'web';
  if (/android/iu.test(agent)) return isStandalone ? 'android-pwa' : 'web';

  return 'web';
};
