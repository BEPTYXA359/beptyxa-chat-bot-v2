import { describe, expect, it } from 'vitest';
import { cleanSteamName, stripGameNamePrefix } from './names.util';

describe('stripGameNamePrefix', () => {
  it('отрезает название игры с дефисом-разделителем', () => {
    expect(stripGameNamePrefix('Game Name - Deluxe Edition', 'Game Name')).toBe('Deluxe Edition');
    expect(stripGameNamePrefix('Counter-Strike 2 - Prime Status Upgrade', 'Counter-Strike 2')).toBe(
      'Prime Status Upgrade',
    );
  });

  it('отрезает название игры с двоеточием-разделителем', () => {
    expect(stripGameNamePrefix('Game Name: Deluxe Edition', 'Game Name')).toBe('Deluxe Edition');
  });

  it('срабатывает, когда Steam выбросил двоеточие и добавил ™', () => {
    expect(
      stripGameNamePrefix('Batman™ Arkham Knight Deluxe Edition', 'Batman: Arkham Knight'),
    ).toBe('Deluxe Edition');
  });

  it('не зависит от типа апострофа', () => {
    expect(
      stripGameNamePrefix('Sid Meier’s Civilization VI Bundle', "Sid Meier's Civilization VI"),
    ).toBe('Bundle');
  });

  it('понимает en-dash и длинное тире как разделители', () => {
    expect(stripGameNamePrefix('Game Name – Deluxe', 'Game Name')).toBe('Deluxe');
    expect(stripGameNamePrefix('Game Name — Deluxe', 'Game Name')).toBe('Deluxe');
  });

  it('не путает дефис внутри названия игры', () => {
    expect(stripGameNamePrefix('Half-Life 2: Update Tool', 'Half-Life 2')).toBe('Update Tool');
  });

  it('оставляет имя как есть, если название игры не в начале', () => {
    expect(stripGameNamePrefix('Valve Complete Pack', 'Left 4 Dead 2')).toBe('Valve Complete Pack');
  });

  it('возвращает пустую строку, если имя целиком совпало с названием игры', () => {
    expect(stripGameNamePrefix('Game Name', 'Game Name')).toBe('');
    expect(stripGameNamePrefix('Game Name®', 'Game Name™')).toBe('');
  });
});

describe('cleanSteamName', () => {
  it('убирает ®™© и выравнивает апострофы и тире', () => {
    expect(cleanSteamName('Sid Meier’s  Civilization® VI™')).toBe("Sid Meier's Civilization VI");
    expect(cleanSteamName('Имя – Издание')).toBe('Имя - Издание');
  });
});
