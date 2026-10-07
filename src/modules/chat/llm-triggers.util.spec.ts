import { describe, expect, it } from 'vitest';
import { ChatSettings, GPTProvider } from './chat.types';
import { detectLlmTrigger, getProviderTriggers } from './llm-triggers.util';

const settingsWith = (llmProviders: ChatSettings['llmProviders']): ChatSettings =>
  ({
    isOpenAiEnabled: true,
    isChatterboxEnabled: false,
    isStreamingEnabled: false,
    openAiModel: 'gpt-4o-mini',
    chatterboxChance: 0,
    llmProviders,
  }) as ChatSettings;

describe('getProviderTriggers', () => {
  it('возвращает стандартные слова без настроек', () => {
    expect(getProviderTriggers('OpenAi')).toEqual(['чатгпт', 'гпт', 'chatgpt', 'gpt']);
    expect(getProviderTriggers('Groq')).toEqual(['грок', 'groq']);
  });

  it('свой алиас заменяет стандартные слова', () => {
    const settings = settingsWith({ OpenAi: { alias: 'ИИ' } });
    expect(getProviderTriggers('OpenAi', settings)).toEqual(['ии']);
  });
});

describe('detectLlmTrigger', () => {
  it('распознаёт стандартные триггеры', () => {
    expect(detectLlmTrigger('чатгпт сколько лет вселенной')).toEqual({
      provider: 'OpenAi',
      prompt: 'сколько лет вселенной',
    });
    expect(detectLlmTrigger('ГРОК привет')).toEqual({ provider: 'Groq', prompt: 'привет' });
    expect(detectLlmTrigger('глм скажи анекдот')).toEqual({
      provider: 'Glm',
      prompt: 'скажи анекдот',
    });
    expect(detectLlmTrigger('Groq hi')).toEqual({ provider: 'Groq', prompt: 'hi' });
  });

  it('регистр и лишние пробелы не важны', () => {
    expect(detectLlmTrigger('  ДипСик   что такое депсик? ')).toEqual({
      provider: 'DeepSeek',
      prompt: 'что такое депсик?',
    });
  });

  it('распознаёт своё слово из настроек', () => {
    const settings = settingsWith({ Glm: { alias: 'мозг' } });
    expect(detectLlmTrigger('мозг кто ты', settings)).toEqual({
      provider: 'Glm',
      prompt: 'кто ты',
    });
  });

  it('алиас заменяет стандартные слова провайдера', () => {
    const settings = settingsWith({ OpenAi: { alias: 'гпт' } });
    expect(detectLlmTrigger('гпт привет', settings)).toEqual({
      provider: 'OpenAi',
      prompt: 'привет',
    });
    expect(detectLlmTrigger('чатгпт привет', settings)).toBeNull();
  });

  it('при пересечении слов побеждает более длинное', () => {
    // «грокк» (xAI) длиннее «грок» (Groq)
    expect(detectLlmTrigger('грокк привет')).toEqual({ provider: 'Xai', prompt: 'привет' });
    expect(detectLlmTrigger('грок привет')).toEqual({ provider: 'Groq', prompt: 'привет' });
  });

  it('триггер должен быть отдельным словом', () => {
    expect(detectLlmTrigger('гптшник ты', settingsWith({}))).toBeNull();
    expect(detectLlmTrigger('чатгптовский ответ')).toBeNull();
  });

  it('не срабатывает без текста после триггера', () => {
    expect(detectLlmTrigger('чатгпт')).toBeNull();
    expect(detectLlmTrigger('чатгпт ')).toBeNull();
  });

  it('не срабатывает на обычных сообщениях', () => {
    expect(detectLlmTrigger('привет, как дела?')).toBeNull();
    expect(detectLlmTrigger('гптшник ты')).toBeNull();
  });

  it('покрывает всех провайдеров из реестра', () => {
    const providers = new Set<GPTProvider>();
    for (const text of [
      'чатгпт т',
      'грок т',
      'глм т',
      'дипсик т',
      'гемини т',
      'клод т',
      'грокк т',
      'опенроутер т',
    ]) {
      const trigger = detectLlmTrigger(text);
      expect(trigger, text).not.toBeNull();
      providers.add(trigger!.provider);
    }
    expect(providers.size).toBe(8);
  });
});
