import type { IsoDateTime } from '../task/value-objects/iso-date-time';
import type { Result } from '../shared/result';
import type { TagId, UserId } from '../shared/branded';
import { DomainErrors } from '../shared/domain-error';
import { err, ok } from '../shared/result';

/**
 * Etiqueta: clasificacion transversal, muchas por tarea.
 *
 * Se guarda tambien `slug` (minusculas y sin acentos) porque es la clave por la que
 * se detectan duplicados: "Urgente" y "urgente" deben ser la misma etiqueta.
 */
export interface Tag {
  readonly id: TagId;
  readonly userId: UserId;
  readonly name: string;
  readonly slug: string;
  readonly color: string;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly deletedAt: IsoDateTime | null;
}

export const TAG_NAME_MAX_LENGTH = 40;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const toTagSlug = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');

export interface CreateTagInput {
  readonly id: TagId;
  readonly userId: UserId;
  readonly name: string;
  readonly now: IsoDateTime;
  readonly color?: string;
}

export const createTag = (input: CreateTagInput): Result<Tag> => {
  const name = input.name.replace(/\s+/gu, ' ').trim();

  if (name.length === 0) {
    return err(DomainErrors.validation('La etiqueta necesita un nombre.', { field: 'name' }));
  }

  if (name.length > TAG_NAME_MAX_LENGTH) {
    return err(
      DomainErrors.validation(`El nombre no puede pasar de ${TAG_NAME_MAX_LENGTH} caracteres.`, {
        field: 'name',
      }),
    );
  }

  const slug = toTagSlug(name);
  if (slug.length === 0) {
    return err(
      DomainErrors.validation('El nombre debe tener al menos una letra o un numero.', {
        field: 'name',
      }),
    );
  }

  const color = (input.color ?? '#64748b').toLowerCase();
  if (!HEX_COLOR.test(color)) {
    return err(
      DomainErrors.validation('El color debe ir en formato hexadecimal.', { field: 'color' }),
    );
  }

  return ok({
    id: input.id,
    userId: input.userId,
    name,
    slug,
    color,
    createdAt: input.now,
    updatedAt: input.now,
    deletedAt: null,
  });
};

export const renameTag = (tag: Tag, name: string, now: IsoDateTime): Result<Tag> => {
  const normalized = name.replace(/\s+/gu, ' ').trim();
  const slug = toTagSlug(normalized);

  if (slug.length === 0) {
    return err(
      DomainErrors.validation('El nombre debe tener al menos una letra o un numero.', {
        field: 'name',
      }),
    );
  }

  return ok({ ...tag, name: normalized, slug, updatedAt: now });
};

export const softDeleteTag = (tag: Tag, now: IsoDateTime): Tag => ({
  ...tag,
  deletedAt: now,
  updatedAt: now,
});
