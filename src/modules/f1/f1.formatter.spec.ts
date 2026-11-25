import { describe, expect, it, vi } from 'vitest';
import { GrammyError, type Api } from 'grammy';
import { formatReminder, formatSessionMessage, sendF1RichWithFallback } from './f1.formatter';
import type {
  F1ResultEntry,
  F1SessionResult,
  F1StandingEntry,
  F1StandingsSnapshot,
} from './f1.types';

const entry = (position: number, overrides: Partial<F1ResultEntry> = {}): F1ResultEntry => ({
  position,
  positionText: String(position),
  driverId: position === 1 ? 'norris' : `driver_${position}`,
  driverName: position === 1 ? 'Lando Norris' : `Driver ${position}`,
  driverNameRu: position === 1 ? 'Ландо Норрис' : `Driver ${position}`,
  constructorId: 'mclaren',
  constructorName: 'McLaren',
  constructorNameRu: 'Макларен',
  time: position === 1 ? '1:30.000' : undefined,
  gap: position === 1 ? undefined : `+${position}.000`,
  dnf: false,
  ...overrides,
});

const result = (
  kind: F1SessionResult['session']['kind'],
  entries: F1ResultEntry[],
): F1SessionResult => ({
  session: {
    id: `2026:19:${kind}`,
    season: 2026,
    round: 19,
    kind,
    label: kind === 'race' ? 'Гонка' : 'Квалификация',
    raceName: 'Mexico City & <Grand Prix>',
    startsAt: '2026-11-01T20:00:00.000Z',
    expectedEnd: '2026-11-01T22:00:00.000Z',
  },
  entries,
  publishedAt: '2026-11-01T22:05:00.000Z',
});

const standing = (position: number): F1StandingEntry => ({
  id: `driver_${position}`,
  name: `Driver ${position}`,
  nameRu: `Driver ${position}`,
  position,
  previousPosition: position + 1,
  positionDelta: position === 1 ? 2 : -1,
  points: 100 - position,
  pointsDelta: position === 1 ? 25 : -3,
});

const standings: F1StandingsSnapshot = {
  sessionId: '2026:19:race',
  capturedAt: '2026-11-01T22:05:00.000Z',
  drivers: Array.from({ length: 12 }, (_, index) => standing(index + 1)),
  constructors: Array.from({ length: 11 }, (_, index) => standing(index + 1)),
};

describe('formatSessionMessage', () => {
  it('озаглавливает известный этап по-русски, неизвестный — как в API', () => {
    const known = formatSessionMessage(
      {
        ...result('race', [entry(1)]),
        session: { ...result('race', []).session, raceName: 'Las Vegas Grand Prix' },
      },
      null,
      true,
    );
    const unknown = formatSessionMessage(result('race', [entry(1)]), null, true);
    expect(known.richHtml).toContain('<h1>ГП Лас-Вегаса — Гонка</h1>');
    expect(unknown.richHtml).toContain('<h1>ГП Mexico City &amp; &lt;Grand Prix&gt; — Гонка</h1>');
  });

  it('создаёт Rich-статью с заголовком, протоколом и двумя кубками', () => {
    const message = formatSessionMessage(result('qualifying', [entry(1)]), standings, true);
    expect(message.richHtml).toContain(
      '<h1>ГП Mexico City &amp; &lt;Grand Prix&gt; — Квалификация</h1>',
    );
    expect(message.richHtml).toContain('<table>');
    expect(message.richHtml).toContain('Кубок после этапа');
    expect(message.richHtml).toContain('Пилоты');
    expect(message.richHtml).toContain('Команды');
    expect(message.richHtml).toContain('▲ 2');
    expect(message.richHtml).toContain('+25');
    expect(message.richHtml).toContain('…и ещё 2');
  });

  it('в compact-гонке оставляет всех финишировавших и отдельную строку DNF', () => {
    const entries = [
      ...Array.from({ length: 12 }, (_, index) => entry(index + 1)),
      entry(13, { positionText: 'R', driverNameRu: 'Сошёл Пилот', status: 'Retired', dnf: true }),
    ];
    const message = formatSessionMessage(result('race', entries), null, false);
    expect(message.richHtml).toContain('Driver 12');
    expect(message.richHtml).not.toContain('>Сошёл Пилот<');
    expect(message.richHtml).toContain('DNF: Сошёл Пилот');
  });

  it('в compact-квале показывает топ-10, а в full — весь протокол', () => {
    const entries = Array.from({ length: 22 }, (_, index) => entry(index + 1));
    const compact = formatSessionMessage(result('qualifying', entries), null, false);
    const full = formatSessionMessage(result('qualifying', entries), null, true);
    expect(compact.richHtml).toContain('Driver 10');
    expect(compact.richHtml).not.toContain('Driver 11');
    expect(compact.richHtml).toContain('…и ещё 12');
    expect(full.richHtml).toContain('Driver 22');
  });

  it('разбивает HTML fallback без разрыва тегов и с частями не длиннее 4000', () => {
    const entries = Array.from({ length: 22 }, (_, index) =>
      entry(index + 1, { driverNameRu: `Очень Длинное Имя Пилота ${index + 1} `.repeat(12) }),
    );
    const message = formatSessionMessage(result('race', entries), standings, true);
    expect(message.fallbackHtml.length).toBeGreaterThan(1);
    for (const part of message.fallbackHtml) {
      expect(part.length).toBeLessThanOrEqual(4000);
      expect(part).toContain('<b>ГП Mexico City &amp; &lt;Grand Prix&gt; — Гонка</b>');
      expect((part.match(/<b>/g) ?? []).length).toBe((part.match(/<\/b>/g) ?? []).length);
    }
  });
});

describe('formatReminder', () => {
  it('показывает интервал и время МСК', () => {
    const race = result('race', []).session;
    expect(formatReminder(race, 30)).toContain('Гонка через 30 минут');
    expect(formatReminder(race, 30)).toContain('01.11.2026, 23:00 МСК');
  });

  it.each([
    [1, 'минуту'],
    [2, 'минуты'],
    [5, 'минут'],
    [21, 'минуту'],
    [22, 'минуты'],
    [25, 'минут'],
    [120, 'минут'],
  ])('склоняет интервал %i: %s', (minutes, word) => {
    expect(formatReminder(result('race', []).session, minutes)).toContain(
      `Гонка через ${minutes} ${word}`,
    );
  });
});

describe('sendF1RichWithFallback', () => {
  const message = { richHtml: '<h1>Заголовок</h1>', fallbackHtml: ['<b>Заголовок</b>'] };
  const telegramError = (status: number) =>
    new GrammyError(
      'error',
      { ok: false, error_code: status, description: 'error' },
      'sendRichMessage',
      {},
    );

  it('при 400 отправляет все HTML-части', async () => {
    const api = {
      sendRichMessage: vi.fn().mockRejectedValue(telegramError(400)),
      sendMessage: vi.fn().mockResolvedValue({}),
    };
    await sendF1RichWithFallback(
      api as unknown as Pick<Api, 'sendRichMessage' | 'sendMessage'>,
      123,
      {
        richHtml: message.richHtml,
        fallbackHtml: ['<b>1</b>', '<b>2</b>'],
      },
    );
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
    expect(api.sendMessage).toHaveBeenCalledWith(123, '<b>1</b>', { parse_mode: 'HTML' });
  });

  it.each([403, 500])('не делает fallback при Telegram %i', async (status) => {
    const api = {
      sendRichMessage: vi.fn().mockRejectedValue(telegramError(status)),
      sendMessage: vi.fn(),
    };
    await expect(
      sendF1RichWithFallback(
        api as unknown as Pick<Api, 'sendRichMessage' | 'sendMessage'>,
        123,
        message,
      ),
    ).rejects.toMatchObject({ error_code: status });
    expect(api.sendMessage).not.toHaveBeenCalled();
  });
});
