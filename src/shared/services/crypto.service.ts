import crypto from 'crypto';
import { config } from '../config';

const ALGORITHM = 'aes-256-cbc';

export class CryptoService {
  public encrypt(text: string): string {
    const iv = crypto.randomBytes(16);

    const key = Buffer.from(config.ENCRYPTION_KEY, 'utf-8');

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return `${iv.toString('hex')}:${encrypted}`;
  }

  public decrypt(text: string): string {
    const [ivHex, encryptedText] = text.split(':');

    if (!ivHex || !encryptedText) {
      throw new Error('Неверный формат зашифрованной строки');
    }

    const iv = Buffer.from(ivHex, 'hex');
    const key = Buffer.from(config.ENCRYPTION_KEY, 'utf-8');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
