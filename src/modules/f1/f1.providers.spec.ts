import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { F1HttpClient, F1HttpError } from './f1.http';
import { jolpicaCalendarResponseSchema } from './jolpica.provider';

describe('F1HttpClient', () => {
  it('валидирует обязательные поля и игнорирует новые поля', async () => {
    const schema = z.object({ required: z.string() });
    const client = new F1HttpClient({
      fetchImpl: vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ required: 'ok', futureField: true }), { status: 200 }),
        ),
    });

    await expect(client.request('https://example.test', schema)).resolves.toEqual({
      required: 'ok',
    });
    expect(jolpicaCalendarResponseSchema.safeParse({ MRData: {} }).success).toBe(false);
  });

  it('задаёт таймаут HTTP-запроса', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const client = new F1HttpClient({
      fetchImpl: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
      timeoutMs: 1234,
    });

    await client.request('https://example.test', z.object({}));
    expect(timeout).toHaveBeenCalledWith(1234);
    timeout.mockRestore();
  });

  it('разносит запросы Jolpica минимум на 300 мс', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    let now = 0;
    const client = new F1HttpClient({
      fetchImpl: vi.fn().mockImplementation(() => {
        now += 100;
        return Promise.resolve(new Response('{}', { status: 200 }));
      }),
      now: () => now,
      sleep,
      minIntervalMs: 300,
    });

    await client.request('https://example.test/1', z.object({}));
    await client.request('https://example.test/2', z.object({}));
    expect(sleep).toHaveBeenCalledWith(200);
  });

  it('один раз повторяет 429 с учётом Retry-After', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    const client = new F1HttpClient({ fetchImpl, sleep, minIntervalMs: 0 });

    await expect(
      client.request('https://example.test', z.object({ ok: z.boolean() })),
    ).resolves.toEqual({ ok: true });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('представляется браузерным User-Agent — Jolpica блокирует дефолтный UA Node', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const client = new F1HttpClient({ fetchImpl });

    await client.request('https://example.test', z.object({}));

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Accept).toBe('application/json');
    expect(headers['User-Agent']).toMatch(/^Mozilla\/5\.0/);
  });

  it('не маскирует 500 как отсутствие результата', async () => {
    const client = new F1HttpClient({
      fetchImpl: vi.fn().mockResolvedValue(new Response('', { status: 500 })),
    });

    const error = await client
      .request('https://example.test', z.object({}))
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(F1HttpError);
    expect((error as F1HttpError).status).toBe(500);
  });
});
