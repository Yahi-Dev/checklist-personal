import { beforeEach, describe, expect, it } from 'vitest';

import type { TestHarness } from '../support/test-context';
import type { CurrentUser } from '../../src/application/ports/repositories';
import type { UserId } from '../../src/domain/shared/branded';

import { AdoptLocalDataUseCase } from '../../src/application/use-cases/sync/adopt-local-data';
import { brandId } from '../../src/domain/shared/branded';
import { CreateTaskUseCase } from '../../src/application/use-cases/task/task-commands';
import { DEFAULT_CATEGORIES } from '../../src/domain/category/category';
import { isErr, unwrap } from '../../src/domain/shared/result';
import {
  CreateCategoryUseCase,
  SeedDefaultCategoriesUseCase,
} from '../../src/application/use-cases/category/category-commands';
import { createTestHarness } from '../support/test-context';
import { HORARIO_2027_1 } from '../support/unibe-schedule-fixture';
import { ImportSchedulePdfUseCase } from '../../src/application/use-cases/schedule/import-schedule-pdf';

/**
 * El usuario ficticio con el que firma todo el modo local.
 *
 * OJO: coincide con el id de `TEST_USER`, que el arnes usa por defecto. No se puede
 * reutilizar aquel, porque adoptarse a uno mismo es justo el caso que el caso de uso
 * ignora a proposito. De ahi que estas pruebas monten su propio usuario "de la nube".
 */
const LOCAL_USER = brandId<UserId>('00000000-0000-4000-8000-000000000001');

/** Un usuario de Supabase de verdad: id aleatorio, nada que ver con el ficticio. */
const CLOUD_USER: CurrentUser = {
  id: brandId<UserId>('7f3c9a10-2b64-4d8e-9f01-5ac2e6b7d840'),
  email: 'yo@ejemplo.com',
  displayName: 'Yo',
};

const NOW = new Date('2026-08-03T12:00:00.000Z');

describe('AdoptLocalDataUseCase', () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = createTestHarness(NOW, CLOUD_USER);
  });

  /** Reproduce el estado real: datos creados sin cuenta, con el usuario ficticio. */
  const createdInLocalMode = async (titles: readonly string[]) => {
    const create = new CreateTaskUseCase(harness.context);

    for (const title of titles) {
      const task = unwrap(await create.execute({ title }));
      await harness.tasks.save({ ...task, userId: LOCAL_USER });
    }
  };

  const adopt = () =>
    new AdoptLocalDataUseCase(harness.context).execute({ previousUserId: LOCAL_USER });

  it('adopta tambien el horario importado sin cuenta', async () => {
    // Sin este bloque, un horario importado en modo local se queda con el dueño ficticio
    // y las politicas de seguridad de Supabase lo rechazan fila por fila para siempre en
    // cuanto hay sesion. Es el mismo agujero que motivo este caso de uso, aplicado al
    // horario.
    harness.pdf.setItems(HORARIO_2027_1);
    await new ImportSchedulePdfUseCase(harness.context).execute({
      bytes: new Uint8Array([1, 2, 3]),
    });

    for (const subject of [...harness.subjects.items.values()]) {
      await harness.subjects.save({ ...subject, userId: LOCAL_USER });
    }
    for (const block of [...harness.scheduleBlocks.items.values()]) {
      await harness.scheduleBlocks.save({ ...block, userId: LOCAL_USER });
    }

    const result = unwrap(await adopt());

    expect(result.asignaturas).toBe(6);
    expect(result.clases).toBe(8);

    for (const subject of harness.subjects.items.values()) {
      expect(subject.userId).toBe(CLOUD_USER.id);
    }
    for (const block of harness.scheduleBlocks.items.values()) {
      expect(block.userId).toBe(CLOUD_USER.id);
    }
  });

  it('le cambia el dueño a las tareas creadas sin cuenta', async () => {
    await createdInLocalMode(['llamar a oriel', 'buscar empleo', 'actualizar mi LinkedIn']);

    const result = unwrap(await adopt());

    expect(result.tareas).toBe(3);
    for (const task of harness.tasks.items.values()) {
      expect(task.userId).toBe(CLOUD_USER.id);
    }
  });

  it('las deja encoladas para subir, que es el objetivo', async () => {
    await createdInLocalMode(['una tarea huerfana']);

    // El doble de repositorio no tiene cola, asi que se comprueba lo observable: la
    // tarea sale con el dueño nuevo y con la marca de tiempo movida, que es lo que hace
    // que el motor la considere pendiente.
    const before = [...harness.tasks.items.values()][0];
    await adopt();
    const after = [...harness.tasks.items.values()][0];

    expect(after?.userId).not.toBe(before?.userId);
    expect(after?.updatedAt).toBe(NOW.toISOString());
  });

  it('no toca las tareas que ya son del usuario de verdad', async () => {
    const mine = unwrap(await new CreateTaskUseCase(harness.context).execute({ title: 'mia' }));
    await createdInLocalMode(['huerfana']);

    const result = unwrap(await adopt());

    expect(result.tareas).toBe(1);
    expect(harness.tasks.items.get(mine.id)?.updatedAt).toBe(mine.updatedAt);
  });

  it('descarta las categorias por defecto intactas en vez de duplicarlas', async () => {
    await new SeedDefaultCategoriesUseCase(harness.context).execute();
    for (const category of [...harness.categories.items.values()]) {
      await harness.categories.save({ ...category, userId: LOCAL_USER });
    }

    const result = unwrap(await adopt());

    // Ni una sobrevive: el servidor ya tiene una con cada nombre y el indice unico
    // (usuario, nombre) rechazaria el duplicado, tumbando la subida de toda la tabla.
    expect(result.categoriasDescartadas).toBe(DEFAULT_CATEGORIES.length);
    expect(result.categorias).toBe(0);
    expect(harness.categories.items.size).toBe(0);
  });

  it('conserva una categoria propia, que si es dato del usuario', async () => {
    const mine = unwrap(
      await new CreateCategoryUseCase(harness.context).execute({ name: 'Oriontek' }),
    );
    await harness.categories.save({ ...mine, userId: LOCAL_USER });

    const result = unwrap(await adopt());

    expect(result.categorias).toBe(1);
    expect(harness.categories.items.get(mine.id)?.userId).toBe(CLOUD_USER.id);
  });

  it('conserva una categoria por defecto si alguna tarea la usa', async () => {
    await new SeedDefaultCategoriesUseCase(harness.context).execute();
    const category = [...harness.categories.items.values()][0];
    if (category === undefined) throw new Error('no se sembro ninguna categoria');

    await harness.categories.save({ ...category, userId: LOCAL_USER });

    const task = unwrap(
      await new CreateTaskUseCase(harness.context).execute({
        title: 'con categoria',
        categoryId: category.id,
      }),
    );
    await harness.tasks.save({ ...task, userId: LOCAL_USER });

    const result = unwrap(await adopt());

    // Descartarla dejaria la tarea apuntando a una categoria inexistente.
    expect(harness.categories.items.get(category.id)?.userId).toBe(CLOUD_USER.id);
    expect(result.categorias).toBe(1);
  });

  it('no hace nada si no hay nada huerfano', async () => {
    await new CreateTaskUseCase(harness.context).execute({ title: 'mia' });

    const result = unwrap(await adopt());

    expect(result).toEqual({
      tareas: 0,
      categorias: 0,
      etiquetas: 0,
      sesiones: 0,
      asignaturas: 0,
      clases: 0,
      notas: 0,
      asistencias: 0,
      categoriasDescartadas: 0,
    });
  });

  it('se niega a adoptar los datos del propio usuario', async () => {
    const result = unwrap(
      await new AdoptLocalDataUseCase(harness.context).execute({ previousUserId: CLOUD_USER.id }),
    );

    expect(result.tareas).toBe(0);
  });

  it('falla sin sesion, que es cuando no hay a quien adoptar', async () => {
    const anonymous = createTestHarness(NOW, null);

    expect(
      isErr(
        await new AdoptLocalDataUseCase(anonymous.context).execute({ previousUserId: LOCAL_USER }),
      ),
    ).toBe(true);
  });
});
