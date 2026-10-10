import { request as httpsRequest } from 'node:https';
import { RUSSIAN_TRUSTED_ROOT_CA } from './russian-trusted-ca.const';

/**
 * tinkoff.ru отдаёт TLS-цепочку, окоренённую в НУЦ Минцифры (Russian Trusted Root CA),
 * которой нет в бандле Node — поэтому корневой сертификат задаём явно.
 * Вынесено в отдельный модуль, чтобы в тестах мокать запрос, а не node:https.
 */
export async function fetchTbankJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      { ca: RUSSIAN_TRUSTED_ROOT_CA, headers: { Accept: 'application/json' } },
      (res) => {
        const status = res.statusCode ?? 500;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          if (status >= 400) {
            reject(new Error(`HTTP error! status: ${status}`));
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(15_000, () => req.destroy(new Error('request timeout')));
    req.end();
  });
}
