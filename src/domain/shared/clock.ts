/**
 * Puerto del reloj.
 *
 * El dominio nunca llama a `new Date()` ni a `Date.now()` directamente. Toda nocion
 * de "ahora" entra por aqui, lo que vuelve deterministas las pruebas de vencimientos,
 * recurrencias y rachas: basta inyectar un reloj fijo.
 */

/** Instante absoluto en milisegundos desde epoch. */
export type Timestamp = number;

/** Fecha de calendario sin hora, en formato `YYYY-MM-DD` y zona horaria local. */
export type CalendarDate = string;

export interface Clock {
  /** El instante actual. */
  now(): Date;
  /** El instante actual en milisegundos. */
  nowMs(): Timestamp;
  /** El dia de hoy en la zona horaria del usuario, como `YYYY-MM-DD`. */
  today(): CalendarDate;
  /** Identificador IANA de zona horaria, ej. `America/Santo_Domingo`. */
  timeZone(): string;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  nowMs(): Timestamp {
    return Date.now();
  }

  today(): CalendarDate {
    return toCalendarDate(new Date());
  }

  timeZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}

/** Reloj congelado para pruebas: el tiempo solo avanza si tu lo avanzas. */
export class FixedClock implements Clock {
  constructor(
    private current: Date,
    private readonly zone = 'America/Santo_Domingo',
  ) {}

  now(): Date {
    return new Date(this.current);
  }

  nowMs(): Timestamp {
    return this.current.getTime();
  }

  today(): CalendarDate {
    return toCalendarDate(this.current);
  }

  timeZone(): string {
    return this.zone;
  }

  /** Avanza el reloj. Devuelve `this` para poder encadenar en pruebas. */
  advanceBy(milliseconds: number): this {
    this.current = new Date(this.current.getTime() + milliseconds);
    return this;
  }

  setTo(date: Date): this {
    this.current = new Date(date);
    return this;
  }
}

/**
 * Convierte un Date a `YYYY-MM-DD` usando los componentes LOCALES.
 * `toISOString()` seria incorrecto aqui: a las 21:00 en Santo Domingo (UTC-4) ya
 * es el dia siguiente en UTC, y una tarea de hoy apareceria como de mañana.
 */
export const toCalendarDate = (date: Date): CalendarDate => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/** Interpreta `YYYY-MM-DD` como medianoche LOCAL, no UTC. */
export const fromCalendarDate = (value: CalendarDate): Date => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, 0, 0, 0, 0);
};

export const startOfLocalDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);

export const endOfLocalDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
