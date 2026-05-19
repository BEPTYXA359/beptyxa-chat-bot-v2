import crypto from 'crypto';
import { logger } from '../logger';

export const validateTelegramData = (initData: string, botToken: string): boolean => {
  try {
    const urlParams = new URLSearchParams(initData);

    const hash = urlParams.get('hash');
    if (!hash) return false;

    urlParams.delete('hash');

    const dataCheckString = Array.from(urlParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();

    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    return calculatedHash === hash;
  } catch (error) {
    logger.error({ err: error }, 'Ошибка при валидации данных Telegram');
    return false;
  }
};
