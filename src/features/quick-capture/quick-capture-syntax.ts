/**
 * Referencia de la sintaxis que entiende la captura rapida.
 *
 * Vive en su propio archivo, y no junto al componente, por dos motivos: la pantalla de
 * Ajustes la consume sin necesitar el componente entero, y mezclar constantes con
 * componentes en un `.tsx` rompe el refresco rapido durante el desarrollo.
 *
 * La verdad de lo que se reconoce esta en `quick-capture-parser.ts` y en sus pruebas;
 * esta lista es la version legible de esas mismas reglas.
 */
export const QUICK_CAPTURE_SYNTAX: readonly { token: string; meaning: string }[] = [
  { token: 'mañana, hoy, el lunes, en 3 dias, 15/8, 15 de agosto', meaning: 'Fecha' },
  { token: 'a las 7, 6pm, 18:30, esta noche, al mediodia, en 2 horas', meaning: 'Hora' },
  { token: 'cada dia, cada 3 dias, cada lunes y miercoles, cada mes', meaning: 'Repeticion' },
  { token: '!alta  !media  !baja   (o  !!!  !!  !)', meaning: 'Prioridad' },
  { token: '#etiqueta', meaning: 'Etiqueta (se crea si no existe)' },
  { token: '@categoria', meaning: 'Categoria (se crea si no existe)' },
  { token: '*', meaning: 'Destacar' },
];
