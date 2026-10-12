import { afterEach, describe, expect, it, vi } from 'vitest';

// config мокаем, чтобы менять прокси-поля без пересборки .env (он парсится на импорте)
const configMock = vi.hoisted(() => ({
  GROQ_API_KEY: 'test-key',
  GROQ_MODEL: 'test-model',
  GROQ_BASE_URL: undefined as string | undefined,
  GROQ_PROXY_TOKEN: undefined as string | undefined,
  NODE_ENV: 'development',
}));

vi.mock('../../shared/config', () => ({ config: configMock }));

vi.mock('../../shared/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const groqCtorSpy = vi.hoisted(() => vi.fn());

vi.mock('groq-sdk', () => ({
  default: class GroqMock {
    constructor(options: unknown) {
      groqCtorSpy(options);
    }
  },
}));

const { GroqProvider } = await import('./groq.provider');

describe('GroqProvider', () => {
  afterEach(() => {
    groqCtorSpy.mockClear();
    configMock.GROQ_BASE_URL = undefined;
    configMock.GROQ_PROXY_TOKEN = undefined;
  });

  it('без GROQ_BASE_URL ходит напрямую на api.groq.com', () => {
    new GroqProvider();

    expect(groqCtorSpy).toHaveBeenCalledWith({ apiKey: 'test-key' });
  });

  it('с GROQ_BASE_URL идёт через прокси и добавляет X-Proxy-Token', () => {
    configMock.GROQ_BASE_URL = 'https://llm-proxy.example.workers.dev/groq';
    configMock.GROQ_PROXY_TOKEN = 'proxy-token';

    new GroqProvider();

    expect(groqCtorSpy).toHaveBeenCalledWith({
      apiKey: 'test-key',
      baseURL: 'https://llm-proxy.example.workers.dev/groq',
      defaultHeaders: { 'X-Proxy-Token': 'proxy-token' },
    });
  });

  it('без GROQ_PROXY_TOKEN заголовок не добавляется даже при прокси', () => {
    configMock.GROQ_BASE_URL = 'https://llm-proxy.example.workers.dev/groq';

    new GroqProvider();

    expect(groqCtorSpy).toHaveBeenCalledWith({
      apiKey: 'test-key',
      baseURL: 'https://llm-proxy.example.workers.dev/groq',
    });
  });
});
