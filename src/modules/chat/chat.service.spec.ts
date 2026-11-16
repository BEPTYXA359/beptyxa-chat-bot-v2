import { describe, expect, it, vi } from 'vitest';
import type { Bot } from 'grammy';
import type { ChatRepository } from './chat.repository';
import type { OpenAiProvider } from '../../infrastructure/llm/openai.provider';
import type { GroqProvider } from '../../infrastructure/llm/groq.provider';
import type { CryptoService } from '../../shared/services/crypto.service';
import type { LlmUsageService } from '../llm-usage/llm-usage.service';
import type { BotContext } from '../../bot/bot.types';

process.env.NODE_ENV = 'development';
const { ChatService } = await import('./chat.service');

function createService(getChatMember: ReturnType<typeof vi.fn>) {
  const bot = { api: { getChatMember } } as unknown as Bot<BotContext>;
  return new ChatService(
    {} as ChatRepository,
    {} as OpenAiProvider,
    {} as GroqProvider,
    {} as CryptoService,
    {} as LlmUsageService,
    bot,
  );
}

describe('ChatService.checkUserIsMember', () => {
  it('разрешает обычного участника группы', async () => {
    const service = createService(vi.fn().mockResolvedValue({ status: 'member' }));

    await expect(service.checkUserIsMember(-100, 111)).resolves.toBe('member');
  });

  it('разрешает ограниченного пользователя только при is_member=true', async () => {
    const service = createService(
      vi.fn().mockResolvedValue({ status: 'restricted', is_member: true }),
    );

    await expect(service.checkUserIsMember(-101, 111)).resolves.toBe('member');
  });

  it('различает покинувшего чат пользователя и ошибку проверки', async () => {
    const leftService = createService(vi.fn().mockResolvedValue({ status: 'left' }));
    const unavailableService = createService(
      vi.fn().mockRejectedValue(new Error('bot is not an administrator')),
    );

    await expect(leftService.checkUserIsMember(-102, 111)).resolves.toBe('not_member');
    await expect(unavailableService.checkUserIsMember(-103, 111)).resolves.toBe('unavailable');
  });
});
