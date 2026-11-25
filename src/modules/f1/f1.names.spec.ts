import { describe, expect, it } from 'vitest';
import {
  formatPointsDelta,
  formatPositionDelta,
  getConstructorNameRu,
  getCountryCode,
  getCountryRu,
  getCircuitNameRu,
  getDriverNameRu,
  getRaceNameRu,
} from './f1.names';

describe('русские имена Ф1', () => {
  it('переводит известных пилотов и команды сезона 2026', () => {
    expect(getDriverNameRu('max_verstappen', 'Max Verstappen')).toBe('Макс Ферстаппен');
    expect(getDriverNameRu('arvid_lindblad', 'Arvid Lindblad')).toBe('Арвид Линдблад');
    expect(getConstructorNameRu('audi', 'Audi')).toBe('Ауди');
    expect(getConstructorNameRu('cadillac', 'Cadillac F1 Team')).toBe('Кадиллак');
  });

  it('оставляет неизвестные имена латиницей', () => {
    expect(getDriverNameRu('reserve_driver', 'Reserve Driver')).toBe('Reserve Driver');
    expect(getDriverNameRu(undefined, 'Запасной пилот')).toBe('Запасной пилот');
    expect(getConstructorNameRu('new_team', 'New Team')).toBe('New Team');
  });

  it('переводит этапы, трассы и страны сезона 2026', () => {
    expect(getRaceNameRu('Las Vegas Grand Prix')).toBe('Лас-Вегаса');
    expect(getRaceNameRu('Bahrain Grand Prix in Malaysia')).toBe('Бахрейна в Малайзии');
    expect(getCircuitNameRu('Autódromo José Carlos Pace')).toBe('Интерлагос');
    expect(getCountryRu('UK')).toBe('Великобритания');
    expect(getCountryCode('UK')).toBe('GB');
    expect(getCountryRu('UAE')).toBe('ОАЭ');
    expect(getCountryCode('UAE')).toBe('AE');
  });

  it('не выдумывает перевод для неизвестных этапов, трасс и стран', () => {
    expect(getRaceNameRu('New Grand Prix')).toBeUndefined();
    expect(getCircuitNameRu('New Circuit')).toBeUndefined();
    expect(getCountryRu('Nowhere')).toBeUndefined();
    expect(getCountryCode('Nowhere')).toBeUndefined();
  });
});

describe('форматирование дельты', () => {
  it('показывает рост, падение и отсутствие изменения позиции', () => {
    expect(formatPositionDelta(2)).toBe('▲ 2');
    expect(formatPositionDelta(-3)).toBe('▼ 3');
    expect(formatPositionDelta(0)).toBe('—');
    expect(formatPositionDelta(null)).toBe('—');
  });

  it('показывает знак изменения очков', () => {
    expect(formatPointsDelta(25)).toBe('+25');
    expect(formatPointsDelta(-10)).toBe('−10');
    expect(formatPointsDelta(0)).toBe('0');
    expect(formatPointsDelta(null)).toBe('—');
  });
});
