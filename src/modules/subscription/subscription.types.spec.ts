import { describe, expect, it } from 'vitest';
import { createSubscriptionSchema } from './subscription.types';

const validDto = {
  name: 'Netflix',
  cost: 9.99,
  currency: 'usd',
  period: 'month',
  nextPaymentDate: '2026-09-14',
};

describe('createSubscriptionSchema', () => {
  it('принимает валидную подписку и нормализует валюту', () => {
    const result = createSubscriptionSchema.safeParse(validDto);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe('USD');
      expect(result.data.remindDaysBefore).toBe(1);
      expect(result.data.notificationsEnabled).toBe(true);
      expect(result.data.status).toBe('active');
    }
  });

  it('отвергает несуществующую дату: 2026-13-45', () => {
    const result = createSubscriptionSchema.safeParse({
      ...validDto,
      nextPaymentDate: '2026-13-45',
    });
    expect(result.success).toBe(false);
  });

  it('отвергает 30 февраля', () => {
    const result = createSubscriptionSchema.safeParse({
      ...validDto,
      nextPaymentDate: '2026-02-30',
    });
    expect(result.success).toBe(false);
  });

  it('принимает 29 февраля високосного года', () => {
    const result = createSubscriptionSchema.safeParse({
      ...validDto,
      nextPaymentDate: '2028-02-29',
    });
    expect(result.success).toBe(true);
  });

  it('пустой service превращается в undefined, а не в 400', () => {
    const result = createSubscriptionSchema.safeParse({ ...validDto, service: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.service).toBeUndefined();
    }
  });

  it('верхний регистр цвета нормализуется', () => {
    const result = createSubscriptionSchema.safeParse({ ...validDto, color: '#e50914' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.color).toBe('#E50914');
    }
  });
});
