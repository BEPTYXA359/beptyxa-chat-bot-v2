import { describe, expect, it, vi } from 'vitest';
import type { F1SubscribersRepository } from './f1-subscribers.repository';
import type { F1Repository } from './f1.repository';
import { F1Service, F1StandingsNotReadyError } from './f1.service';
import type { JolpicaProvider } from './jolpica.provider';
import type {
  F1Calendar,
  F1CalendarRound,
  F1ResultEntry,
  F1SessionSchedule,
  F1StandingEntry,
  F1StandingsSnapshot,
} from './f1.types';

vi.mock('../../shared/logger', () => ({ logger: { warn: vi.fn() } }));

const resultEntry: F1ResultEntry = {
  position: 1,
  positionText: '1',
  driverId: 'norris',
  driverName: 'Lando Norris',
  driverNameRu: 'Ландо Норрис',
  constructorId: 'mclaren',
  constructorName: 'McLaren',
  constructorNameRu: 'Макларен',
  dnf: false,
};

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

const session = (
  round: number,
  kind: F1SessionSchedule['kind'],
  startsAt: string,
): F1SessionSchedule => ({
  id: `2026:${round}:${kind}`,
  season: 2026,
  round,
  kind,
  label: kind,
  startsAt,
  expectedEnd: new Date(Date.parse(startsAt) + 60 * 60_000).toISOString(),
});

const round = (
  number: number,
  raceStart: string,
  sessions?: F1SessionSchedule[],
): F1CalendarRound => ({
  season: 2026,
  round: number,
  raceName: `Grand Prix ${number}`,
  country: 'Country',
  circuitName: 'Circuit',
  startsAt: raceStart,
  sessions: sessions ?? [session(number, 'race', raceStart)],
});

const snapshot = (sessionId: string): F1StandingsSnapshot => ({
  sessionId,
  capturedAt: '2026-03-01T12:00:00.000Z',
  drivers: [],
  constructors: [],
});

const jolpicaRace = (season: number, date: string) => ({
  season: String(season),
  round: '1',
  raceName: `Grand Prix ${season}`,
  date,
  time: '10:00:00Z',
  Circuit: { circuitName: 'Circuit', Location: { country: 'Country' } },
});

const createService = ({
  calendar = { season: 2026, rounds: [round(1, '2026-03-01T10:00:00Z')] },
  cachedAt = new Date('2026-03-01T00:00:00Z'),
  now = new Date('2026-03-01T12:00:00Z'),
  raceEntries = [resultEntry],
  season = 2026,
}: {
  calendar?: F1Calendar;
  cachedAt?: Date;
  now?: Date;
  raceEntries?: F1ResultEntry[] | null;
  season?: number;
} = {}) => {
  const repository = {
    getCalendar: vi.fn().mockResolvedValue({ value: calendar, updatedAt: cachedAt }),
    saveCalendar: vi.fn().mockResolvedValue(undefined),
    getSessionResult: vi.fn().mockResolvedValue(null),
    saveSessionResult: vi.fn().mockResolvedValue(undefined),
    getStandingsSnapshot: vi.fn().mockResolvedValue(null),
    getLatestStandingsSnapshot: vi.fn().mockResolvedValue(snapshot('2026:1:qualifying')),
    saveStandingsSnapshot: vi.fn().mockResolvedValue(undefined),
  };
  const jolpica = {
    getCalendar: vi.fn().mockResolvedValue([]),
    getResults: vi.fn().mockResolvedValue(raceEntries),
    getDriverStandings: vi.fn().mockResolvedValue([]),
    getConstructorStandings: vi.fn().mockResolvedValue([]),
  };
  const subscribers = {
    getByChat: vi.fn().mockResolvedValue(null),
    upsert: vi.fn(),
  };
  const service = new F1Service(
    repository as unknown as F1Repository,
    subscribers as unknown as F1SubscribersRepository,
    jolpica as unknown as JolpicaProvider,
    { season, now: () => now },
  );
  return { service, repository, jolpica, subscribers, calendar };
};

describe('кэширование F1Service', () => {
  it('не обновляет календарь чаще одного раза в сутки', async () => {
    const { service, jolpica } = createService();
    await service.refreshCalendar();
    await service.refreshCalendar();
    expect(jolpica.getCalendar).not.toHaveBeenCalled();
  });

  it('обновляет календарь через сутки', async () => {
    const { service, jolpica, repository } = createService({
      cachedAt: new Date('2026-02-28T11:59:00Z'),
    });
    jolpica.getCalendar.mockResolvedValue([jolpicaRace(2026, '2026-03-01')]);
    await service.refreshCalendar();
    expect(jolpica.getCalendar).toHaveBeenCalledWith(2026);
    expect(repository.saveCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ season: 2026 }),
      2026,
    );
  });

  it('в межсезонье показывает прошлый сезон до старта первой сессии нового', async () => {
    const { service, jolpica, repository } = createService({
      season: 2027,
      cachedAt: new Date('2026-02-01T00:00:00Z'),
      now: new Date('2027-01-10T12:00:00Z'),
    });
    repository.getCalendar.mockResolvedValue(null);
    jolpica.getCalendar.mockImplementation((year: number) =>
      Promise.resolve([jolpicaRace(year, year === 2027 ? '2027-03-07' : '2026-03-08')]),
    );

    await expect(service.refreshCalendar()).resolves.toMatchObject({ season: 2026 });
    expect(jolpica.getCalendar).toHaveBeenCalledWith(2027);
    expect(jolpica.getCalendar).toHaveBeenCalledWith(2026);
    // в межсезонье прошлогодний календарь хранится под ключом текущего года
    expect(repository.saveCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ season: 2026 }),
      2027,
    );
  });

  it('переключается на новый сезон после старта его первой сессии', async () => {
    const { service, jolpica, repository } = createService({
      season: 2027,
      cachedAt: new Date('2026-02-01T00:00:00Z'),
      now: new Date('2027-03-07T12:00:00Z'),
    });
    repository.getCalendar.mockResolvedValue(null);
    jolpica.getCalendar.mockResolvedValue([jolpicaRace(2027, '2027-03-07')]);

    await expect(service.refreshCalendar()).resolves.toMatchObject({ season: 2027 });
    expect(jolpica.getCalendar).toHaveBeenCalledTimes(1);
  });

  it('при ошибке обновления возвращает устаревший календарь', async () => {
    const { service, jolpica, calendar } = createService({
      cachedAt: new Date('2026-02-01T00:00:00Z'),
    });
    jolpica.getCalendar.mockRejectedValue(new Error('network'));
    await expect(service.refreshCalendar()).resolves.toEqual(calendar);
  });

  it('больше не запрашивает сохранённый протокол', async () => {
    const { service, repository, jolpica } = createService();
    const race = session(1, 'race', '2026-03-01T10:00:00Z');
    repository.getSessionResult.mockResolvedValue({
      session: race,
      entries: [resultEntry],
      publishedAt: '2026-03-01T12:00:00Z',
    });
    await expect(service.getSessionResult(race)).resolves.toMatchObject({ entries: [resultEntry] });
    expect(jolpica.getResults).not.toHaveBeenCalled();
  });

  it('повторно запрашивает пустой протокол и не сохраняет его', async () => {
    const { service, repository, jolpica } = createService({ raceEntries: null });
    const race = session(1, 'race', '2026-03-01T10:00:00Z');
    await expect(service.getSessionResult(race)).resolves.toBeNull();
    await service.getSessionResult(race);
    expect(jolpica.getResults).toHaveBeenCalledTimes(2);
    expect(repository.saveSessionResult).not.toHaveBeenCalled();
  });
});

describe('overview и протоколы ГП', () => {
  it('определяет последний ГП по протоколу и следующий этап по времени', async () => {
    const calendar = {
      season: 2026,
      rounds: [
        round(1, '2026-03-01T10:00:00Z'),
        round(2, '2026-03-08T10:00:00Z'),
        round(3, '2026-03-15T10:00:00Z'),
      ],
    };
    const { service, jolpica } = createService({ calendar });
    const overview = await service.getOverview();

    expect(overview.lastCompletedGp).toBe(1);
    expect(overview.rounds.map((item) => item.status)).toEqual(['completed', 'next', 'upcoming']);
    expect(overview.nextSession?.id).toBe('2026:2:race');
    expect(jolpica.getResults).toHaveBeenCalledTimes(1);
  });

  it('возвращает null для будущих протоколов и полный доступный протокол для прошлых', async () => {
    const sessions = [
      session(2, 'qualifying', '2026-03-07T10:00:00Z'),
      session(2, 'race', '2026-03-08T10:00:00Z'),
    ];
    const { service } = createService({
      calendar: { season: 2026, rounds: [round(2, '2026-03-08T10:00:00Z', sessions)] },
      cachedAt: new Date('2026-03-07T12:00:00Z'),
      now: new Date('2026-03-07T12:00:00Z'),
    });
    const grandPrix = await service.getGrandPrix(2);
    expect(grandPrix.sessions[0].results).toEqual([resultEntry]);
    expect(grandPrix.sessions[1].results).toBeNull();
  });

  it('выбрасывает domain 404 для неизвестного этапа', async () => {
    const { service } = createService();
    await expect(service.getGrandPrix(99)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('протоколы практик недоступны без источника и не дёргают Jolpica', async () => {
    const { service, jolpica, repository } = createService({ raceEntries: [resultEntry] });
    const practice = session(1, 'practice1', '2026-02-28T10:00:00Z');
    // в Mongo мог остаться протокол практики со времён OpenF1
    repository.getSessionResult.mockResolvedValue({
      session: practice,
      entries: [resultEntry],
      publishedAt: '2026-02-28T12:00:00Z',
    });

    await expect(service.getSessionResult(practice)).resolves.toBeNull();
    expect(jolpica.getResults).not.toHaveBeenCalled();
  });

  it('спринт-квалификация недоступна в Jolpica — отдаёт null без запроса', async () => {
    const { service, jolpica } = createService({ raceEntries: [resultEntry] });
    const sprintQualifying = session(2, 'sprintQualifying', '2026-03-07T08:00:00Z');

    await expect(service.getSessionResult(sprintQualifying)).resolves.toBeNull();
    expect(jolpica.getResults).not.toHaveBeenCalled();
  });

  it('обзор не падает, если кубок после последнего этапа ещё не готов', async () => {
    const calendar = {
      season: 2026,
      rounds: [round(1, '2026-03-01T10:00:00Z'), round(2, '2026-03-08T10:00:00Z')],
    };
    const { service, jolpica, repository } = createService({
      calendar,
      cachedAt: new Date('2026-03-08T00:00:00Z'),
      now: new Date('2026-03-08T12:00:00Z'),
    });
    repository.getLatestStandingsSnapshot.mockResolvedValue(null);
    jolpica.getDriverStandings.mockResolvedValue([standing('norris', 1, 100)]);

    const overview = await service.getOverview();

    expect(overview.lastCompletedGp).toBe(2);
    expect(overview.standings).toBeNull();
  });
});

describe('снапшоты кубков', () => {
  it('не использует прошлый ГП как baseline посреди спринт-уик-энда', async () => {
    const sessions = [
      session(2, 'sprintQualifying', '2026-03-07T08:00:00Z'),
      session(2, 'sprint', '2026-03-07T12:00:00Z'),
      session(2, 'race', '2026-03-08T10:00:00Z'),
    ];
    const { service, jolpica, repository } = createService({
      calendar: {
        season: 2026,
        rounds: [round(1, '2026-03-01T10:00:00Z'), round(2, '2026-03-08T10:00:00Z', sessions)],
      },
    });
    repository.getLatestStandingsSnapshot.mockResolvedValue(null);
    // кубок после раунда 1 — до спринта, актуальный — уже пересчитан
    jolpica.getDriverStandings.mockImplementation((_season: number, roundNumber?: number) =>
      Promise.resolve([standing('norris', 1, roundNumber === 1 ? 100 : 108)]),
    );

    const captured = await service.captureStandings(sessions[1]);
    expect(captured.drivers[0].pointsDelta).toBeNull();
    expect(jolpica.getDriverStandings).toHaveBeenCalledWith(2026);
    expect(jolpica.getDriverStandings).not.toHaveBeenCalledWith(2026, 2);
    expect(repository.saveStandingsSnapshot).toHaveBeenCalledWith(captured);
  });

  it('не сохраняет снапшот, пока Jolpica не обновил кубок после этапа', async () => {
    const { service, jolpica, repository } = createService();
    const race = session(2, 'race', '2026-03-08T10:00:00Z');
    repository.getLatestStandingsSnapshot.mockResolvedValue(null);
    // актуальный кубок совпадает с кубком после раунда 1 — Jolpica ещё не пересчитал его
    jolpica.getDriverStandings.mockResolvedValue([standing('norris', 1, 100)]);

    await expect(service.captureStandings(race)).rejects.toBeInstanceOf(F1StandingsNotReadyError);
    expect(repository.saveStandingsSnapshot).not.toHaveBeenCalled();
  });

  it('не создаёт повторный снапшот для той же сессии', async () => {
    const { service, jolpica, repository } = createService();
    const race = session(1, 'race', '2026-03-01T10:00:00Z');
    repository.getStandingsSnapshot.mockResolvedValue(snapshot(race.id));
    await service.captureStandings(race);
    expect(jolpica.getDriverStandings).not.toHaveBeenCalled();
    expect(repository.saveStandingsSnapshot).not.toHaveBeenCalled();
  });

  it('не использует снапшот будущей сессии при восстановлении пропущенной дельты', async () => {
    const { service, jolpica, repository } = createService();
    const previousRace = session(1, 'race', '2026-03-01T10:00:00Z');
    const qualifying = session(2, 'qualifying', '2026-03-07T10:00:00Z');
    const futureRace = session(2, 'race', '2026-03-08T10:00:00Z');
    const previousSnapshot: F1StandingsSnapshot = {
      ...snapshot(previousRace.id),
      capturedAt: previousRace.startsAt,
      drivers: [standing('norris', 2, 10)],
    };
    const futureSnapshot: F1StandingsSnapshot = {
      ...previousSnapshot,
      sessionId: futureRace.id,
      capturedAt: futureRace.startsAt,
      drivers: [{ ...previousSnapshot.drivers[0], position: 1, points: 50 }],
    };
    repository.getLatestStandingsSnapshot.mockImplementation((before?: string) =>
      Promise.resolve(before === qualifying.startsAt ? previousSnapshot : futureSnapshot),
    );
    jolpica.getDriverStandings.mockResolvedValue([standing('norris', 1, 20)]);

    const captured = await service.captureStandings(qualifying);

    expect(repository.getLatestStandingsSnapshot).toHaveBeenCalledWith(qualifying.startsAt, 2026);
    expect(captured.capturedAt).toBe(new Date(qualifying.startsAt).toISOString());
    expect(captured.drivers[0]).toMatchObject({ previousPosition: 2, pointsDelta: 10 });
  });

  it('не берёт baseline кубка из прошлого сезона', async () => {
    const { service, repository, jolpica } = createService();
    const seasonOpener: F1SessionSchedule = {
      id: '2027:1:race',
      season: 2027,
      round: 1,
      kind: 'race',
      label: 'Гонка',
      startsAt: '2027-03-07T10:00:00Z',
      expectedEnd: '2027-03-07T12:00:00Z',
    };
    const finale2026: F1StandingsSnapshot = {
      ...snapshot('2026:24:race'),
      capturedAt: '2026-12-06T12:00:00.000Z',
      drivers: [standing('norris', 1, 398)],
    };
    // финал прошлого сезона виден только без сезонного фильтра
    repository.getLatestStandingsSnapshot.mockImplementation((_before?: string, season?: number) =>
      Promise.resolve(season === undefined ? finale2026 : null),
    );
    jolpica.getDriverStandings.mockResolvedValue([standing('norris', 1, 25)]);

    const captured = await service.captureStandings(seasonOpener);

    expect(repository.getLatestStandingsSnapshot).toHaveBeenCalledWith(seasonOpener.startsAt, 2027);
    // дельты не должны срываться к финалу прошлого сезона
    expect(captured.drivers[0]).toMatchObject({ previousPosition: null, pointsDelta: null });
    expect(repository.saveStandingsSnapshot).toHaveBeenCalledWith(captured);
  });
});
