import type { ZodType } from 'zod';

// Jolpica за Cloudflare отдаёт 403 «User agent not allowed» на дефолтный UA Node (undici):
// https://github.com/jolpica/jolpica-f1/discussions/386
const F1_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

interface F1HttpClientOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  minIntervalMs?: number;
  timeoutMs?: number;
}

export class F1HttpError extends Error {
  constructor(
    public readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status}: ${url}`);
    this.name = 'F1HttpError';
  }
}

export class F1HttpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;
  private lastRequestAt = Number.NEGATIVE_INFINITY;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: F1HttpClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.minIntervalMs = options.minIntervalMs ?? 300;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  request<T>(url: string, schema: ZodType<T>): Promise<T> {
    const result = this.queue.then(() => this.performRequest(url, schema));
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async performRequest<T>(url: string, schema: ZodType<T>): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const elapsed = this.now() - this.lastRequestAt;
      if (elapsed < this.minIntervalMs) await this.sleep(this.minIntervalMs - elapsed);
      this.lastRequestAt = this.now();

      const response = await this.fetchImpl(url, {
        headers: { Accept: 'application/json', 'User-Agent': F1_USER_AGENT },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (response.status === 429 && attempt === 0) {
        const retryAfter = Number(response.headers.get('Retry-After'));
        await this.sleep(
          Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : 15_000,
        );
        continue;
      }
      if (!response.ok) throw new F1HttpError(response.status, url);
      return schema.parse(await response.json());
    }

    throw new F1HttpError(429, url);
  }
}
