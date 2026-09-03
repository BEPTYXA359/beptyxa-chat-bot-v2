import { describe, expect, it } from 'vitest';
import { pluralRu } from './text.util';

describe('pluralRu', () => {
  it('возвращает форму для одной штуки', () => {
    expect(pluralRu(1, 'игра', 'игры', 'игр')).toBe('игра');
    expect(pluralRu(21, 'игра', 'игры', 'игр')).toBe('игра');
  });

  it('возвращает форму для 2–4 штук', () => {
    expect(pluralRu(2, 'игра', 'игры', 'игр')).toBe('игры');
    expect(pluralRu(4, 'игра', 'игры', 'игр')).toBe('игры');
    expect(pluralRu(22, 'игра', 'игры', 'игр')).toBe('игры');
  });

  it('возвращает форму для 5 и более', () => {
    expect(pluralRu(5, 'игра', 'игры', 'игр')).toBe('игр');
    expect(pluralRu(20, 'игра', 'игры', 'игр')).toBe('игр');
  });

  it('учитывает исключения 11–14', () => {
    expect(pluralRu(11, 'игра', 'игры', 'игр')).toBe('игр');
    expect(pluralRu(12, 'игра', 'игры', 'игр')).toBe('игр');
    expect(pluralRu(14, 'игра', 'игры', 'игр')).toBe('игр');
  });
});
