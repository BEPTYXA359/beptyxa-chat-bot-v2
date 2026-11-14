import crypto from 'crypto';
import { logger } from '../logger';

const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;
const MAX_CLOCK_SKEW_SECONDS = 60;

export const validateTelegramData = (initData: string, botToken: string): boolean => {
  try {
    const urlParams = new URLSearchParams(initData);

    const hash = urlParams.get('hash');
    const authDate = Number(urlParams.get('auth_date'));
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      !hash ||
      !Number.isInteger(authDate) ||
      authDate <= 0 ||
      nowSeconds - authDate > INIT_DATA_MAX_AGE_SECONDS ||
      authDate - nowSeconds > MAX_CLOCK_SKEW_SECONDS
    ) {
      return false;
    }

    urlParams.delete('hash');

    const dataCheckString = Array.from(urlParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();

    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest();

    const receivedHash = Buffer.from(hash, 'hex');
    return (
      calculatedHash.length === receivedHash.length &&
      crypto.timingSafeEqual(calculatedHash, receivedHash)
    );
  } catch (error) {
    logger.error({ err: error }, 'Ошибка при валидации данных Telegram');
    return false;
  }
};
