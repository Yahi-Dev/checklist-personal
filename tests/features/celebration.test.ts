import { describe, expect, it } from 'vitest';

import { celebrationKindFor } from '../../src/features/celebration/celebration';

/**
 * El clima de la celebracion.
 *
 * Es una sola funcion, pero decide QUE fiesta ve el usuario y que tono tiene el
 * aviso; equivocarla no rompe nada y sin embargo manda el mensaje contrario
 * ("tarde" cuando llego a tiempo). Por eso se fijan los tres casos y el borde.
 */
describe('el clima de la celebracion', () => {
  const AHORA = Date.parse('2026-08-05T15:00:00.000Z');

  it('a tiempo: fuegos de estrellas', () => {
    expect(celebrationKindFor({ dueAt: '2026-08-05T18:00:00.000Z' }, AHORA)).toBe('brillante');
  });

  it('vencida: amanecer', () => {
    expect(celebrationKindFor({ dueAt: '2026-08-05T09:00:00.000Z' }, AHORA)).toBe('amanecer');
  });

  it('sin fecha no hay tarde posible', () => {
    expect(celebrationKindFor({ dueAt: null }, AHORA)).toBe('brillante');
  });

  it('en el instante exacto del vencimiento todavia se llega a tiempo', () => {
    expect(celebrationKindFor({ dueAt: '2026-08-05T15:00:00.000Z' }, AHORA)).toBe('brillante');
  });
});
