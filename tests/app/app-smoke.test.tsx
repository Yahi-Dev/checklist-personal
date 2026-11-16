import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { App } from '../../src/app/App';

/**
 * Prueba de humo del arranque completo.
 *
 * No comprueba marcado ni estilos: comprueba que la aplicacion ENTERA se levanta.
 * Monta `<App />` de verdad, lo que ejercita en una sola pasada la raiz de composicion,
 * los repositorios sobre IndexedDB (via `fake-indexeddb`), la sesion local, el
 * enrutador y la vista de Hoy.
 *
 * Es la unica prueba de interfaz del proyecto, y existe porque es la unica clase de
 * fallo que ni el compilador ni las pruebas unitarias pueden ver: un contenedor mal
 * cableado, un proveedor en el orden equivocado o un hook que revienta al montar
 * producen una pantalla en blanco con el codigo compilando y todo en verde.
 *
 * Sin `VITE_SUPABASE_URL` la app entra en modo local, asi que no hace falta red ni
 * credenciales.
 */
describe('arranque de la aplicacion', () => {
  it('monta y llega hasta la vista de Hoy', async () => {
    render(<App />);

    await waitFor(
      () => {
        expect(screen.getByRole('heading', { name: /hoy/i })).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    // La captura rapida es la puerta principal de la app: si no esta, no hay app.
    expect(screen.getByLabelText(/nueva tarea/i)).toBeInTheDocument();

    // Y la navegacion principal tiene que existir en las dos formas (lateral e inferior).
    expect(
      screen.getAllByRole('navigation', { name: /navegacion principal/i }).length,
    ).toBeGreaterThan(0);
  });

  /**
   * El tiempo limite se sube A PROPOSITO por encima del `waitFor` de dentro.
   *
   * Con los 5 s por defecto de vitest, el limite del test y el de la espera eran EL MISMO
   * numero, asi que no quedaba ni un milisegundo para montar la aplicacion entera ni para
   * teclear treinta caracteres: el test moria por arriba justo cuando la espera todavia
   * tenia margen. Se caia una vez de cada tres, y siempre parecia culpa del ultimo cambio
   * que hubiera tocado el arranque, porque cualquier nodo de mas lo empujaba al limite.
   *
   * Ahora el presupuesto es coherente: montar y escribir por su cuenta, y hasta 5 s de
   * espera POR ENCIMA de eso.
   */
  it('crea una tarea de verdad escribiendo en la captura rapida', async () => {
    const user = userEvent.setup();
    render(<App />);

    const input = await screen.findByLabelText(/nueva tarea/i);

    // Recorrido completo: analizador -> caso de uso -> repositorio -> IndexedDB ->
    // useLiveQuery -> repintado de la lista.
    await user.type(input, 'Probar la aplicacion hoy{Enter}');

    await waitFor(
      () => {
        expect(screen.getByText('Probar la aplicacion')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  }, 20_000);

  /**
   * La lupa de Hoy y lo completado hoy, de punta a punta.
   *
   * Lo completado hoy tiene que seguir en Hoy, plegado, sin depender de ningun ajuste: antes
   * colgaba de "Ver completadas", que empieza apagado y vive en cada dispositivo, y en un
   * telefono recien instalado lo hecho hoy desaparecia de la pantalla.
   */
  it('la lupa de Hoy filtra las tareas, y lo completado hoy sigue a la vista', async () => {
    const user = userEvent.setup();
    render(<App />);

    const input = await screen.findByLabelText(/nueva tarea/i);
    await user.type(input, 'Llamar a Raffy hoy{Enter}');
    await user.type(input, 'Pagar la luz hoy{Enter}');
    await screen.findByText('Llamar a Raffy', undefined, { timeout: 5000 });
    await screen.findByText('Pagar la luz', undefined, { timeout: 5000 });

    await user.click(screen.getByRole('button', { name: /buscar en hoy/i }));
    await user.type(screen.getByLabelText(/filtrar las tareas de hoy/i), 'RAFFY');
    await waitFor(() => {
      expect(screen.queryByText('Pagar la luz')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Llamar a Raffy')).toBeInTheDocument();

    // Escape cierra la lupa y vuelve todo.
    await user.keyboard('{Escape}');
    await screen.findByText('Pagar la luz', undefined, { timeout: 5000 });

    // Completar una: sale de lo pendiente y queda en «Completadas», plegada.
    await user.click(screen.getByRole('checkbox', { name: 'Completar Pagar la luz' }));
    const completed = await screen.findByRole(
      'button',
      { name: /completadas/i },
      { timeout: 5000 },
    );
    await user.click(completed);
    expect(
      await screen.findByRole('checkbox', { name: 'Reabrir Pagar la luz' }, { timeout: 5000 }),
    ).toBeInTheDocument();
  }, 30_000);
});
