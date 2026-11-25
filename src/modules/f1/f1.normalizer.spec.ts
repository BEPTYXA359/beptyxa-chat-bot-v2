import { describe, expect, it } from 'vitest';
import { jolpicaRaceSchema, type JolpicaRace } from './jolpica.provider';
import { mergeCalendar, normalizeJolpicaResults } from './f1.normalizer';

const raceFixture = (sessions: Record<string, unknown> = {}): JolpicaRace =>
  jolpicaRaceSchema.parse({
    season: '2026',
    round: '2',
    raceName: 'Chinese Grand Prix',
    date: '2026-03-15',
    time: '07:00:00Z',
    Circuit: { circuitName: 'Shanghai', Location: { country: 'China' } },
    ...sessions,
  });

describe('mergeCalendar', () => {
  it('строит обычный этап с расчётным временем окончания сессий', () => {
    const calendar = mergeCalendar([
      raceFixture({
        FirstPractice: { date: '2026-03-13', time: '03:00:00Z' },
        SecondPractice: { date: '2026-03-13', time: '07:00:00Z' },
        ThirdPractice: { date: '2026-03-14', time: '03:00:00Z' },
        Qualifying: { date: '2026-03-14', time: '07:00:00Z' },
      }),
    ]);

    expect(calendar.rounds[0].sessions.map((session) => session.kind)).toEqual([
      'practice1',
      'practice2',
      'practice3',
      'qualifying',
      'race',
    ]);
    expect(calendar.rounds[0].sessions.at(-1)).toMatchObject({
      startsAt: '2026-03-15T07:00:00.000Z',
      expectedEnd: '2026-03-15T09:00:00.000Z',
    });
    expect(calendar.rounds[0].sessions[0].expectedEnd).toBe('2026-03-13T04:00:00.000Z');
    expect(calendar.rounds[0].sessions[0].openF1SessionKey).toBeUndefined();
  });

  it('добавляет русские названия этапа, трассы и страны с кодом флага', () => {
    const calendar = mergeCalendar([
      raceFixture({
        Circuit: {
          circuitName: 'Shanghai International Circuit',
          Location: { country: 'China' },
        },
      }),
    ]);

    expect(calendar.rounds[0]).toMatchObject({
      raceNameRu: 'Гран-при Китая',
      circuitNameRu: 'Шанхай',
      countryRu: 'Китай',
      countryCode: 'CN',
    });
    expect(calendar.rounds[0].sessions[0].raceName).toBe('Chinese Grand Prix');
  });

  it('без известных названий остаётся на английских из API', () => {
    const calendar = mergeCalendar([
      raceFixture({
        raceName: 'New Grand Prix',
        Circuit: { circuitName: 'New Circuit', Location: { country: 'Nowhere' } },
      }),
    ]);

    expect(calendar.rounds[0]).not.toHaveProperty('raceNameRu');
    expect(calendar.rounds[0]).not.toHaveProperty('circuitNameRu');
    expect(calendar.rounds[0]).not.toHaveProperty('countryRu');
    expect(calendar.rounds[0]).not.toHaveProperty('countryCode');
  });

  it('определяет спринт по фактическим полям Jolpica', () => {
    const calendar = mergeCalendar([
      raceFixture({
        SprintQualifying: { date: '2026-03-13', time: '07:00:00Z' },
        Sprint: { date: '2026-03-14', time: '03:00:00Z' },
        Qualifying: { date: '2026-03-14', time: '07:00:00Z' },
      }),
    ]);

    expect(calendar.rounds[0].sessions.map((session) => session.kind)).toEqual([
      'sprintQualifying',
      'sprint',
      'qualifying',
      'race',
    ]);
  });

  it('без дополнительных полей оставляет только гонку', () => {
    const calendar = mergeCalendar([raceFixture()]);

    expect(calendar.rounds[0].sessions.map((session) => session.kind)).toEqual(['race']);
  });
});

describe('normalizeJolpicaResults', () => {
  it('сохраняет DNF без времени финиша', () => {
    const race = raceFixture({
      Results: [
        {
          number: '14',
          position: '22',
          positionText: 'R',
          points: '0',
          Driver: { driverId: 'alonso', givenName: 'Fernando', familyName: 'Alonso' },
          Constructor: { constructorId: 'aston_martin', name: 'Aston Martin' },
          laps: '5',
          status: 'Retired',
        },
      ],
    });

    expect(normalizeJolpicaResults(race, 'race')).toEqual([
      expect.objectContaining({
        positionText: 'R',
        driverNameRu: 'Фернандо Алонсо',
        constructorNameRu: 'Астон Мартин',
        dnf: true,
      }),
    ]);
    expect(normalizeJolpicaResults(race, 'race')?.[0]).not.toHaveProperty('time');
  });

  it('сохраняет сегменты квалификации', () => {
    const race = raceFixture({
      QualifyingResults: [
        {
          number: '1',
          position: '1',
          points: '0',
          Driver: { driverId: 'norris', givenName: 'Lando', familyName: 'Norris' },
          Constructor: { constructorId: 'mclaren', name: 'McLaren' },
          Q1: '1:30.000',
          Q2: '1:29.500',
          Q3: '1:29.000',
        },
      ],
    });

    expect(normalizeJolpicaResults(race, 'qualifying')?.[0]).toMatchObject({
      positionText: '1',
      segments: ['1:30.000', '1:29.500', '1:29.000'],
    });
  });

  it('возвращает null для неопубликованного протокола', () => {
    expect(normalizeJolpicaResults(raceFixture(), 'race')).toBeNull();
    expect(normalizeJolpicaResults(raceFixture({ Results: [] }), 'race')).toBeNull();
  });
});
