import type { CategoryId, UserId } from '../shared/branded';
import type { IsoDateTime } from '../task/value-objects/iso-date-time';
import type { Result } from '../shared/result';
import { DomainErrors } from '../shared/domain-error';
import { err, ok } from '../shared/result';

/**
 * Categoria: la clasificacion PRINCIPAL de una tarea, y solo puede haber una.
 * Para clasificaciones cruzadas ("urgente", "esperando respuesta") estan las etiquetas.
 */
export interface Category {
  readonly id: CategoryId;
  readonly userId: UserId;
  readonly name: string;
  /** Color hex `#rrggbb` en minusculas. */
  readonly color: string;
  /** Nombre del icono de lucide, ej. `briefcase`. */
  readonly icon: string;
  readonly position: number;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly deletedAt: IsoDateTime | null;
}

export const CATEGORY_NAME_MAX_LENGTH = 60;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Paleta por defecto: contraste comprobado sobre fondo claro y oscuro. */
export const CATEGORY_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#0ea5e9',
  '#64748b',
] as const;

export const CATEGORY_ICONS = [
  'briefcase',
  'house',
  'heart-pulse',
  'graduation-cap',
  'dumbbell',
  'wallet',
  'shopping-cart',
  'plane',
  'code',
  'book-open',
  'users',
  'sparkles',
] as const;

export interface CreateCategoryInput {
  readonly id: CategoryId;
  readonly userId: UserId;
  readonly name: string;
  readonly now: IsoDateTime;
  readonly color?: string;
  readonly icon?: string;
  readonly position?: number;
}

export const createCategory = (input: CreateCategoryInput): Result<Category> => {
  const name = input.name.replace(/\s+/gu, ' ').trim();

  if (name.length === 0) {
    return err(DomainErrors.validation('La categoria necesita un nombre.', { field: 'name' }));
  }

  if (name.length > CATEGORY_NAME_MAX_LENGTH) {
    return err(
      DomainErrors.validation(
        `El nombre no puede pasar de ${CATEGORY_NAME_MAX_LENGTH} caracteres.`,
        { field: 'name' },
      ),
    );
  }

  const color = (input.color ?? CATEGORY_COLORS[0]).toLowerCase();
  if (!HEX_COLOR.test(color)) {
    return err(
      DomainErrors.validation('El color debe ir en formato hexadecimal, ej. #6366f1.', {
        field: 'color',
      }),
    );
  }

  return ok({
    id: input.id,
    userId: input.userId,
    name,
    color,
    icon: input.icon ?? CATEGORY_ICONS[0],
    position: input.position ?? 0,
    createdAt: input.now,
    updatedAt: input.now,
    deletedAt: null,
  });
};

export interface UpdateCategoryPatch {
  readonly name?: string;
  readonly color?: string;
  readonly icon?: string;
  readonly position?: number;
}

export const updateCategory = (
  category: Category,
  patch: UpdateCategoryPatch,
  now: IsoDateTime,
): Result<Category> => {
  const name = patch.name === undefined ? category.name : patch.name.replace(/\s+/gu, ' ').trim();

  if (name.length === 0) {
    return err(DomainErrors.validation('La categoria necesita un nombre.', { field: 'name' }));
  }

  if (name.length > CATEGORY_NAME_MAX_LENGTH) {
    return err(
      DomainErrors.validation(
        `El nombre no puede pasar de ${CATEGORY_NAME_MAX_LENGTH} caracteres.`,
        { field: 'name' },
      ),
    );
  }

  const color = (patch.color ?? category.color).toLowerCase();
  if (!HEX_COLOR.test(color)) {
    return err(
      DomainErrors.validation('El color debe ir en formato hexadecimal, ej. #6366f1.', {
        field: 'color',
      }),
    );
  }

  return ok({
    ...category,
    name,
    color,
    icon: patch.icon ?? category.icon,
    position: patch.position ?? category.position,
    updatedAt: now,
  });
};

export const softDeleteCategory = (category: Category, now: IsoDateTime): Category => ({
  ...category,
  deletedAt: now,
  updatedAt: now,
});

/** Categorias que se siembran en el primer arranque, para no empezar en blanco. */
export const DEFAULT_CATEGORIES: readonly {
  name: string;
  color: string;
  icon: string;
}[] = [
  { name: 'Personal', color: '#6366f1', icon: 'house' },
  { name: 'Trabajo', color: '#0ea5e9', icon: 'briefcase' },
  { name: 'Salud', color: '#22c55e', icon: 'heart-pulse' },
  { name: 'Cursos', color: '#f97316', icon: 'graduation-cap' },
  { name: 'Finanzas', color: '#eab308', icon: 'wallet' },
];
