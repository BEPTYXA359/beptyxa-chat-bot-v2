import { afterEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import type { WebServer } from './fastify.server';

const configMock = vi.hoisted(() => ({
  BOT_TOKEN: 'test-bot-token',
  NODE_ENV: 'production',
  PORT: 3000,
}));

vi.mock('../../shared/config', () => ({ config: configMock }));
vi.mock('../../shared/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { WebServer: Server } = await import('./fastify.server');

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
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

const servers: WebServer[] = [];

async function createServer(membership: 'member' | 'not_member' | 'unavailable') {
  const chatService = {
    checkUserIsMember: vi.fn().mockResolvedValue(membership),
    checkUserIsAdmin: vi.fn().mockResolvedValue(false),
  };
  const reminderService = {
    getActiveReminders: vi.fn().mockResolvedValue([]),
    deleteReminder: vi.fn().mockResolvedValue(undefined),
  };
  const server = new Server(
    chatService as never,
    reminderService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  await server.init();
  servers.push(server);
  return { server, reminderService };
}

function authorizedRequest(url: string, method: 'GET' | 'DELETE' = 'GET') {
  return {
    method,
    url,
    headers: { authorization: `Bearer ${createInitData()}` },
  };
}

describe('авторизация chatId в Mini App', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.stop()));
  });

  it('не возвращает записи чужого личного чата', async () => {
    const { server, reminderService } = await createServer('member');

    const response = await server.app.inject(authorizedRequest('/api/reminders?chatId=222'));

    expect(response.statusCode).toBe(403);
    expect(reminderService.getActiveReminders).not.toHaveBeenCalled();
  });

  it('разрешает личные записи без chatId, как их запрашивает миниапп', async () => {
    const { server, reminderService } = await createServer('member');

    const response = await server.app.inject(authorizedRequest('/api/reminders'));

    expect(response.statusCode).toBe(200);
    expect(reminderService.getActiveReminders).toHaveBeenCalledWith(111);
  });

  it('не возвращает записи группы пользователю, который в ней не состоит', async () => {
    const { server, reminderService } = await createServer('not_member');

    const response = await server.app.inject(authorizedRequest('/api/reminders?chatId=-100'));

    expect(response.statusCode).toBe(403);
    expect(reminderService.getActiveReminders).not.toHaveBeenCalled();
  });

  it('разрешает участнику группы без предварительного требования администраторства бота', async () => {
    const { server, reminderService } = await createServer('member');

    const response = await server.app.inject(authorizedRequest('/api/reminders?chatId=-100'));

    expect(response.statusCode).toBe(200);
    expect(reminderService.getActiveReminders).toHaveBeenCalledWith(-100);
  });

  it('объясняет, что делать, если Telegram не позволяет проверить участника', async () => {
    const { server } = await createServer('unavailable');

    const response = await server.app.inject(authorizedRequest('/api/reminders?chatId=-100'));

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toContain('администратором');
  });

  it('передаёт chatId при удалении напоминания', async () => {
    const { server, reminderService } = await createServer('member');
    const id = '507f1f77bcf86cd799439011';

    const response = await server.app.inject(
      authorizedRequest(`/api/reminders/${id}?chatId=-100`, 'DELETE'),
    );

    expect(response.statusCode).toBe(200);
    expect(reminderService.deleteReminder).toHaveBeenCalledWith(id, -100);
  });
});
