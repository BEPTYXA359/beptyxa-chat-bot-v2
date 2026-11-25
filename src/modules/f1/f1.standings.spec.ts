import { describe, expect, it } from 'vitest';
import { buildStandingsSnapshot } from './f1.standings';
import type { F1StandingEntry } from './f1.types';

const standing = (id: string, position: number, points: number): F1StandingEntry => ({
  id,
  name: id,
  nameRu: id,
  position,
  previousPosition: null,
  positionDelta: null,
  points,
  pointsDelta: null,
});

describe('buildStandingsSnapshot', () => {
  it('считает позиции и очки относительно предыдущей завершённой сессии', () => {
    const snapshot = buildStandingsSnapshot(
      '2026:20:race',
      {
        drivers: [standing('norris', 1, 110), standing('verstappen', 2, 100)],
        constructors: [standing('mclaren', 1, 200)],
      },
      {
        drivers: [standing('verstappen', 1, 105), standing('norris', 2, 85)],
        constructors: [standing('mclaren', 2, 190)],
      },
      new Date('2026-03-15T09:00:00Z'),
    );

    expect(snapshot.drivers[0]).toMatchObject({
      previousPosition: 2,
      positionDelta: 1,
      pointsDelta: 25,
    });
    expect(snapshot.drivers[1]).toMatchObject({ positionDelta: -1, pointsDelta: -5 });
    expect(snapshot.constructors[0]).toMatchObject({ positionDelta: 1, pointsDelta: 10 });
    expect(snapshot.capturedAt).toBe('2026-03-15T09:00:00.000Z');
  });

  it('оставляет дельту новых участников неизвестной и игнорирует выбывших', () => {
    const snapshot = buildStandingsSnapshot(
      '2026:20:qualifying',
      { drivers: [standing('new_driver', 1, 0)], constructors: [] },
      { drivers: [standing('retired_driver', 1, 50)], constructors: [] },
    );

    expect(snapshot.drivers[0]).toMatchObject({
      previousPosition: null,
      positionDelta: null,
      pointsDelta: null,
    });
  });

  it('не выдумывает нулевую дельту при отсутствии baseline', () => {
    const snapshot = buildStandingsSnapshot(
      '2026:20:sprint',
      { drivers: [standing('norris', 1, 110)], constructors: [] },
      null,
    );
    expect(snapshot.drivers[0].positionDelta).toBeNull();
    expect(snapshot.drivers[0].pointsDelta).toBeNull();
  });
});
