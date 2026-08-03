import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './app/styles/global.css';

import { App } from './app/App';
import { registerServiceWorker } from './service-worker/register';

/**
 * Punto de entrada.
 *
 * `StrictMode` monta y desmonta cada componente dos veces en desarrollo. Es molesto,
 * pero es exactamente lo que hace falta en una app con suscripciones a Realtime, a
 * eventos del sistema y a temporizadores: cualquier `useEffect` que no limpie lo suyo
 * se manifiesta aqui, y no en produccion como una fuga que crece con las horas.
 */
const container = document.getElementById('root');

if (container === null) {
  throw new Error('No se encontro el elemento #root en index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// El service worker solo se registra en la build web: en Electron no aporta nada y
// entorpece la carga desde file://.
if (import.meta.env.VITE_TARGET !== 'electron') {
  registerServiceWorker();
}
