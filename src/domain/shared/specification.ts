/**
 * Patron Specification.
 *
 * Cada regla de filtrado ("vence hoy", "esta atrasada", "es de la categoria X") vive
 * como un objeto independiente, testeable por si solo y combinable con and/or/not.
 *
 * La alternativa seria repartir condiciones sueltas por los componentes de React;
 * entonces "que cuenta como atrasada" acabaria definido en cuatro sitios distintos y
 * con tres matices diferentes. Aqui se define una vez.
 */

export interface Specification<T> {
  isSatisfiedBy(candidate: T): boolean;
}

class AndSpecification<T> implements Specification<T> {
  constructor(private readonly specs: readonly Specification<T>[]) {}

  isSatisfiedBy(candidate: T): boolean {
    return this.specs.every((spec) => spec.isSatisfiedBy(candidate));
  }
}

class OrSpecification<T> implements Specification<T> {
  constructor(private readonly specs: readonly Specification<T>[]) {}

  isSatisfiedBy(candidate: T): boolean {
    return this.specs.some((spec) => spec.isSatisfiedBy(candidate));
  }
}

class NotSpecification<T> implements Specification<T> {
  constructor(private readonly spec: Specification<T>) {}

  isSatisfiedBy(candidate: T): boolean {
    return !this.spec.isSatisfiedBy(candidate);
  }
}

class PredicateSpecification<T> implements Specification<T> {
  constructor(private readonly predicate: (candidate: T) => boolean) {}

  isSatisfiedBy(candidate: T): boolean {
    return this.predicate(candidate);
  }
}

/** Envuelve una funcion suelta como Specification. */
export const spec = <T>(predicate: (candidate: T) => boolean): Specification<T> =>
  new PredicateSpecification(predicate);

/** Se cumple solo si TODAS se cumplen. Sin argumentos, se cumple siempre. */
export const and = <T>(...specs: readonly Specification<T>[]): Specification<T> =>
  new AndSpecification(specs);

/** Se cumple si AL MENOS UNA se cumple. Sin argumentos, no se cumple nunca. */
export const or = <T>(...specs: readonly Specification<T>[]): Specification<T> =>
  new OrSpecification(specs);

export const not = <T>(specification: Specification<T>): Specification<T> =>
  new NotSpecification(specification);

export const alwaysTrue = <T>(): Specification<T> => spec<T>(() => true);

export const alwaysFalse = <T>(): Specification<T> => spec<T>(() => false);

/** Aplica una specification como filtro de array. */
export const filterBy = <T>(items: readonly T[], specification: Specification<T>): T[] =>
  items.filter((item) => specification.isSatisfiedBy(item));
