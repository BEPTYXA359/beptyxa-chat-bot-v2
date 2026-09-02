export interface TzDateParts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

export type BillingPeriod = 'week' | 'month' | 'quarter' | 'half_year' | 'year';

export const MSK_TIMEZONE = 'Europe/Moscow';

/** Проверяет, что строка 'YYYY-MM-DD' — существующая дата (отсекает '2026-13-45') */
export function isRealDateString(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const instant = new Date(Date.UTC(y, m - 1, d));
  return (
    instant.getUTCFullYear() === y && instant.getUTCMonth() === m - 1 && instant.getUTCDate() === d
  );
}

export function getTzParts(instant: Date, timezone: string): TzDateParts {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const collected: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type === 'literal') continue;
    collected[part.type] = Number(part.value);
  }
  return {
    y: collected.year,
    m: collected.month,
    d: collected.day,
    h: collected.hour,
    mi: collected.minute,
    s: collected.second,
  };
}

export function getTzOffsetMs(instant: Date, timezone: string): number {
  const parts = getTzParts(instant, timezone);
  const wallAsUtc = Date.UTC(parts.y, parts.m - 1, parts.d, parts.h, parts.mi, parts.s);
  return wallAsUtc - instant.getTime();
}

export function wallClockInstant(
  day: number,
  month: number,
  year: number,
  hours: number,
  timezone: string,
): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, hours, 0, 0, 0);
  const offsetMs = getTzOffsetMs(new Date(wallAsUtc), timezone);
  return new Date(wallAsUtc - offsetMs);
}

/** Текущая дата в зоне как строка 'YYYY-MM-DD' */
export function todayDateString(timezone: string = MSK_TIMEZONE): string {
  return getTzDateString(new Date(), timezone);
}

export function getTzDateString(instant: Date, timezone: string): string {
  const parts = getTzParts(instant, timezone);
  return toDateString(parts.y, parts.m, parts.d);
}

export function toDateString(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** Разница в днях между датами 'YYYY-MM-DD' (b - a) */
export function diffDaysBetweenDateStrings(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function addDaysToDateString(dateStr: string, days: number): string {
  const instant = Date.parse(`${dateStr}T00:00:00Z`) + days * 86_400_000;
  return new Date(instant).toISOString().slice(0, 10);
}

/**
 * Прибавляет период к дате 'YYYY-MM-DD'.
 * Месячные периоды клампятся к концу месяца: 31 января + месяц = 28/29 февраля.
 */
export function addPeriod(dateStr: string, period: BillingPeriod): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  switch (period) {
    case 'week':
      return addDaysToDateString(dateStr, 7);
    case 'month':
      return normalizeDate(y, m + 1, d);
    case 'quarter':
      return normalizeDate(y, m + 3, d);
    case 'half_year':
      return normalizeDate(y, m + 6, d);
    case 'year':
      return normalizeDate(y + 1, m, d);
  }
}

/** Нормализует переполнение месяца (13 → январь следующего года) и клампит день к последнему дню месяца */
function normalizeDate(year: number, month: number, day: number): string {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInMonth);
  return new Date(Date.UTC(year, month - 1, clampedDay)).toISOString().slice(0, 10);
}

/** Откатывает дату вперёд по периоду, пока она не станет строго больше today */
export function rollForwardPeriod(dateStr: string, period: BillingPeriod, today: string): string {
  let current = dateStr;
  let guard = 0;
  while (current < today && guard < 1000) {
    current = addPeriod(current, period);
    guard++;
  }
  return current;
}

export function formatDateRu(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}
