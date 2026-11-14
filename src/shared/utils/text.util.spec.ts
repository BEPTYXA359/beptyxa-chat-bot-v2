import { describe, expect, it } from 'vitest';
import { pluralRu, splitMessage } from './text.util';

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

describe('splitMessage', () => {
  it('жёстко ограничивает длину неразрывного текста', () => {
    const text = 'а'.repeat(950);
    const chunks = splitMessage(text, 100);

    expect(chunks.every((chunk) => chunk.length <= 100)).toBe(true);
    expect(chunks.join('')).toBe(text);
  });

  it('разбивает большой code block с повторным открытием и закрытием fence', () => {
    const text = `\`\`\`ts\n${'const value = 1;\n'.repeat(30)}\`\`\``;
    const chunks = splitMessage(text, 100);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 100)).toBe(true);
    expect(chunks.every((chunk) => chunk.startsWith('```ts\n'))).toBe(true);
    expect(chunks.every((chunk) => chunk.trimEnd().endsWith('```'))).toBe(true);
    expect(chunks.join('').match(/const value = 1;/g)).toHaveLength(30);
  });

  it('не оставляет незакрытый math block больше лимита', () => {
    const chunks = splitMessage(`$$\n${'x'.repeat(250)}\n$$`, 50);

    expect(chunks.every((chunk) => chunk.length <= 50)).toBe(true);
    expect(chunks.join('')).not.toContain('$$');
    expect(chunks.join('')).toContain('x'.repeat(250));
  });
});
