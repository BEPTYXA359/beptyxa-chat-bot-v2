import { describe, expect, it } from 'vitest';
import {
  addDaysToDateString,
  addPeriod,
  diffDaysBetweenDateStrings,
  formatDateRu,
  getTzDateString,
  rollForwardPeriod,
} from './timezone.util';

describe('addPeriod', () => {
  it('прибавляет неделю', () => {
    expect(addPeriod('2026-01-05', 'week')).toBe('2026-01-12');
  });

  it('прибавляет месяц', () => {
    expect(addPeriod('2026-01-05', 'month')).toBe('2026-02-05');
  });

  it('клампит конец месяца: 31 января + месяц = 28 февраля', () => {
    expect(addPeriod('2026-01-31', 'month')).toBe('2026-02-28');
  });

  it('клампит конец месяца в високосный год: 31 января + месяц = 29 февраля', () => {
    expect(addPeriod('2028-01-31', 'month')).toBe('2028-02-29');
  });

  it('30 января + месяц = 28 февраля, а не 2 марта', () => {
    expect(addPeriod('2026-01-30', 'month')).toBe('2026-02-28');
  });

  it('31 марта + квартал = 30 июня', () => {
    expect(addPeriod('2026-03-31', 'quarter')).toBe('2026-06-30');
  });

  it('31 августа + полгода = 28 февраля следующего года', () => {
    expect(addPeriod('2026-08-31', 'half_year')).toBe('2027-02-28');
  });

  it('прибавляет год', () => {
    expect(addPeriod('2026-03-15', 'year')).toBe('2027-03-15');
  });

  it('29 февраля + год = 28 февраля невисокосного года', () => {
    expect(addPeriod('2028-02-29', 'year')).toBe('2029-02-28');
  });

  it('31 декабря + месяц = 31 января следующего года', () => {
    expect(addPeriod('2026-12-31', 'month')).toBe('2027-01-31');
  });
});

describe('rollForwardPeriod', () => {
  it('не двигает дату в будущем', () => {
    expect(rollForwardPeriod('2026-09-10', 'month', '2026-09-02')).toBe('2026-09-10');
  });

  it('не двигает дату, равную today', () => {
    expect(rollForwardPeriod('2026-09-02', 'month', '2026-09-02')).toBe('2026-09-02');
  });

  it('откатывает одну просроченную дату', () => {
    expect(rollForwardPeriod('2026-08-15', 'month', '2026-09-02')).toBe('2026-09-15');
  });

  it('откатывает сильно просроченную дату до будущего', () => {
    expect(rollForwardPeriod('2026-01-10', 'week', '2026-09-02')).toBe('2026-09-05');
  });

  it('якорный день «прилипает» к клэмпнутому: 31 января → 28 февраля → 28 марта', () => {
    expect(rollForwardPeriod('2026-01-31', 'month', '2026-04-01')).toBe('2026-04-28');
  });
});

describe('diffDaysBetweenDateStrings', () => {
  it('считает разницу', () => {
    expect(diffDaysBetweenDateStrings('2026-09-02', '2026-09-03')).toBe(1);
    expect(diffDaysBetweenDateStrings('2026-09-02', '2026-10-01')).toBe(29);
    expect(diffDaysBetweenDateStrings('2026-09-02', '2026-09-02')).toBe(0);
  });

  it('учитывает переход через год', () => {
    expect(diffDaysBetweenDateStrings('2026-12-31', '2027-01-01')).toBe(1);
  });
});

describe('addDaysToDateString', () => {
  it('прибавляет дни', () => {
    expect(addDaysToDateString('2026-09-30', 1)).toBe('2026-10-01');
  });
});

describe('getTzDateString', () => {
  it('переводит инстант в дату по МСК', () => {
    // 2026-09-02T21:30:00Z — это уже 3 сентября в Москве
    expect(getTzDateString(new Date('2026-09-02T21:30:00Z'), 'Europe/Moscow')).toBe('2026-09-03');
    // ...но ещё 2 сентября в UTC
    expect(getTzDateString(new Date('2026-09-02T21:30:00Z'), 'UTC')).toBe('2026-09-02');
  });
});

describe('formatDateRu', () => {
  it('форматирует дату по-русски без смещения таймзоны', () => {
    expect(formatDateRu('2026-09-14')).toBe('14 сентября');
  });
});
