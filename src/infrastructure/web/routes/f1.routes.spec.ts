import { afterEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { telegramAuthHook } from '../middlewares/telegram-auth.middleware';
import { createChatAuthorizationHook } from '../middlewares/chat-authorization.middleware';
import { f1Routes } from './f1.routes';
import { F1NotFoundError } from '../../../modules/f1/f1.service';

const configMock = vi.hoisted(() => ({ BOT_TOKEN: 'test-bot-token', NODE_ENV: 'production' }));
vi.mock('../../../shared/config', () => ({ config: configMock }));
vi.mock('../../../shared/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function createInitData(): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 111, first_name: 'Test' }),
  });
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(configMock.BOT_TOKEN).digest();
  params.set('hash', crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex'));
  return params.toString();
}

const apps: FastifyInstance[] = [];
const createApp = async (membership: 'member' | 'not_member' = 'member') => {
  const service = {
    getOverview: vi.fn().mockResolvedValue({ season: 2026, rounds: [] }),
    getGrandPrix: vi.fn().mockResolvedValue({ season: 2026, round: 19, sessions: [] }),
    getSettings: vi.fn().mockResolvedValue({ enabled: false, fullProtocols: false, reminders: [] }),
    updateSettings: vi.fn().mockResolvedValue({
      enabled: true,
      fullProtocols: false,
      reminders: [5, 30],
    }),
  };
  const scheduler = { reconcile: vi.fn().mockResolvedValue(undefined) };
  const chatService = { checkUserIsMember: vi.fn().mockResolvedValue(membership) };
  const app = Fastify({ logger: false });
  app.addHook('preValidation', telegramAuthHook);
  app.addHook('preHandler', createChatAuthorizationHook(chatService as never));
  await app.register(f1Routes, {
    prefix: '/api/f1',
    f1Service: service as never,
    f1Scheduler: scheduler as never,
  });
  apps.push(app);
  return { app, service, scheduler, chatService };
};

const request = (url: string, method: 'GET' | 'PUT' = 'GET', payload?: unknown) => ({
  method,
  url,
  headers: { authorization: `Bearer ${createInitData()}` },
  ...(payload === undefined ? {} : { payload }),
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('F1 API', () => {
  it('отдаёт overview и полный протокол выбранного ГП', async () => {
    const { app, service } = await createApp();
    const overview = await app.inject(request('/api/f1/overview?chatId=111'));
    const grandPrix = await app.inject(request('/api/f1/gp/19?chatId=111'));
    expect(overview.statusCode).toBe(200);
    expect(grandPrix.statusCode).toBe(200);
    expect(service.getOverview).toHaveBeenCalled();
    expect(service.getGrandPrix).toHaveBeenCalledWith(19);
  });

  it('возвращает 400 на невалидный round и 404 на неизвестный этап', async () => {
    const { app, service } = await createApp();
    service.getGrandPrix.mockRejectedValue(new F1NotFoundError(99));
    expect((await app.inject(request('/api/f1/gp/nope'))).statusCode).toBe(400);
    expect((await app.inject(request('/api/f1/gp/99'))).statusCode).toBe(404);
  });

  it('читает и частично обновляет настройки, затем запускает reconcile', async () => {
    const { app, service, scheduler } = await createApp();
    const getResponse = await app.inject(request('/api/f1/settings/111'));
    const putResponse = await app.inject(
      request('/api/f1/settings/111', 'PUT', { enabled: true, reminders: [30, 5] }),
    );
    expect(getResponse.statusCode).toBe(200);
    expect(putResponse.statusCode).toBe(200);
    expect(service.updateSettings).toHaveBeenCalledWith(111, { enabled: true, reminders: [5, 30] });
    expect(scheduler.reconcile).toHaveBeenCalled();
  });

  it('возвращает сохранённые настройки, если перепланирование завершилось ошибкой', async () => {
    const { app, scheduler } = await createApp();
    scheduler.reconcile.mockRejectedValue(new Error('Agenda unavailable'));

    const response = await app.inject(
      request('/api/f1/settings/111', 'PUT', { enabled: true, reminders: [30] }),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ enabled: true, reminders: [5, 30] });
  });

  it('возвращает Zod details для некорректного body', async () => {
    const { app, service } = await createApp();
    const response = await app.inject(request('/api/f1/settings/111', 'PUT', { reminders: [0] }));
    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty('details');
    expect(service.updateSettings).not.toHaveBeenCalled();
  });
});

describe('авторизация path chatId', () => {
  it.each([222, -100])('запрещает чужой chatId %i', async (chatId) => {
    const { app, service } = await createApp('not_member');
    const response = await app.inject(request(`/api/f1/settings/${chatId}`));
    expect(response.statusCode).toBe(403);
    expect(service.getSettings).not.toHaveBeenCalled();
  });

  it('разрешает участнику группы и совпадающий личный chatId', async () => {
    const { app, service } = await createApp('member');
    expect((await app.inject(request('/api/f1/settings/-100'))).statusCode).toBe(200);
    expect((await app.inject(request('/api/f1/settings/111'))).statusCode).toBe(200);
    expect(service.getSettings).toHaveBeenCalledWith(-100);
    expect(service.getSettings).toHaveBeenCalledWith(111);
  });

  it('отклоняет несовпадающие path и query chatId', async () => {
    const { app, service } = await createApp();
    const response = await app.inject(request('/api/f1/settings/111?chatId=-100'));
    expect(response.statusCode).toBe(400);
    expect(service.getSettings).not.toHaveBeenCalled();
  });

  it('возвращает 400 на невалидный path chatId', async () => {
    const { app } = await createApp();
    expect((await app.inject(request('/api/f1/settings/nope'))).statusCode).toBe(400);
  });
});
