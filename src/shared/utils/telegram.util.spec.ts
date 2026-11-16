import { afterEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'development';
const { validateTelegramData } = await import('./telegram.util');

const BOT_TOKEN = 'test-bot-token';

function createInitData(authDate: number | string): string {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    user: JSON.stringify({ id: 111, first_name: 'Test' }),
  });
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

describe('validateTelegramData', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('принимает корректный свежий initData', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
    const initData = createInitData(Math.floor(Date.now() / 1000) - 60 * 60);

    expect(validateTelegramData(initData, BOT_TOKEN)).toBe(true);
  });

  it('отклоняет корректно подписанный, но устаревший initData', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
    const initData = createInitData(Math.floor(Date.now() / 1000) - 25 * 60 * 60);

    expect(validateTelegramData(initData, BOT_TOKEN)).toBe(false);
  });

  it('отклоняет initData без корректного auth_date', () => {
    const initData = createInitData('invalid');

    expect(validateTelegramData(initData, BOT_TOKEN)).toBe(false);
  });
});
