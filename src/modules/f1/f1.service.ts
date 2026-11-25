import type { F1SubscribersRepository } from './f1-subscribers.repository';
import { mergeCalendar } from './f1.normalizer';
import type { F1Repository } from './f1.repository';
import { buildStandingsSnapshot } from './f1.standings';
import {
  DEFAULT_F1_SETTINGS,
  f1SettingsSchema,
  updateF1SettingsSchema,
  type F1Calendar,
  type F1CalendarRound,
  type F1GrandPrix,
  type F1Overview,
  type F1SessionResult,
  type F1SessionSchedule,
  type F1Settings,
  type F1StandingEntry,
  type F1StandingsSnapshot,
  type UpdateF1Settings,
} from './f1.types';
import type { JolpicaProvider } from './jolpica.provider';
import { logger } from '../../shared/logger';

const CALENDAR_TTL_MS = 24 * 60 * 60_000;
const MOSCOW_YEAR = new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Europe/Moscow' });
// очки начисляются только в гонке и спринте — по ним и сверяем свежесть кубка
export const POINTS_SESSION_KINDS = new Set<F1SessionSchedule['kind']>(['race', 'sprint']);

const localization = (round: F1CalendarRound) => ({
  ...(round.raceNameRu ? { raceNameRu: round.raceNameRu } : {}),
  ...(round.countryRu ? { countryRu: round.countryRu } : {}),
  ...(round.countryCode ? { countryCode: round.countryCode } : {}),
  ...(round.circuitNameRu ? { circuitNameRu: round.circuitNameRu } : {}),
});

const sameStandings = (current: F1StandingEntry[], previous: F1StandingEntry[]): boolean =>
  current.length > 0 &&
  current.length === previous.length &&
  current.every((entry, index) => {
    const baseline = previous[index];
    return (
      entry.id === baseline.id &&
      entry.position === baseline.position &&
      entry.points === baseline.points
    );
  });

export class F1NotFoundError extends Error {
  readonly statusCode = 404;

  constructor(round: number) {
    super(`Этап Ф1 с раундом ${round} не найден`);
    this.name = 'F1NotFoundError';
  }
}

/** Jolpica опубликовал протокол, но ещё не пересчитал кубок — снапшот фиксировать рано */
export class F1StandingsNotReadyError extends Error {
  constructor(sessionId: string) {
    super(`Кубок после сессии ${sessionId} ещё не обновился в Jolpica`);
    this.name = 'F1StandingsNotReadyError';
  }
}

interface F1ServiceOptions {
  /** Переопределение сезона; по умолчанию — текущий год по Москве */
  season?: number;
  now?: () => Date;
}

export class F1Service {
  private readonly seasonOverride: number | undefined;
  private readonly now: () => Date;

  constructor(
    private readonly repository: F1Repository,
    private readonly subscribers: F1SubscribersRepository,
    private readonly jolpica: JolpicaProvider,
    options: F1ServiceOptions = {},
  ) {
    this.seasonOverride = options.season;
    this.now = options.now ?? (() => new Date());
  }

  get season(): number {
    return this.seasonOverride ?? Number(MOSCOW_YEAR.format(this.now()));
  }

  async refreshCalendar(): Promise<F1Calendar> {
    const season = this.season;
    const cached = await this.repository.getCalendar(season);
    if (cached && this.now().getTime() - cached.updatedAt.getTime() < CALENDAR_TTL_MS) {
      return cached.value;
    }

    try {
      let calendar = mergeCalendar(await this.jolpica.getCalendar(season));
      // календарь нового сезона появляется в Jolpica заранее: прошлый сезон
      // показываем до старта первой сессии нового
      if (!this.hasStarted(calendar)) {
        try {
          const previous = mergeCalendar(await this.jolpica.getCalendar(season - 1));
          if (this.hasStarted(previous) || calendar.rounds.length === 0) calendar = previous;
        } catch {
          // остаёмся на текущем сезоне
        }
      }
      await this.repository.saveCalendar(calendar, season);
      return calendar;
    } catch (error) {
      if (cached) return cached.value;
      throw error;
    }
  }

  private hasStarted(calendar: F1Calendar): boolean {
    const now = this.now().getTime();
    return calendar.rounds.some((round) =>
      round.sessions.some((session) => Date.parse(session.startsAt) <= now),
    );
  }

  async getSessionResult(
    session: F1SessionSchedule,
    forceRefresh = false,
  ): Promise<F1SessionResult | null> {
    // практики Jolpica не отдаёт, а спринт-квалификацию не поддерживает вовсе (400):
    // источников нет — не ходим в сеть и не отдаём устаревший кэш
    if (session.kind.startsWith('practice') || session.kind === 'sprintQualifying') return null;

    if (!forceRefresh) {
      const cached = await this.repository.getSessionResult(session.id);
      if (cached) return cached;
    }

    const entries = await this.jolpica.getResults(session.season, session.round, session.kind);
    if (!entries?.length) return null;
    const result: F1SessionResult = {
      session,
      entries,
      publishedAt: this.now().toISOString(),
    };
    await this.repository.saveSessionResult(result);
    return result;
  }

  async getGrandPrix(roundNumber: number): Promise<F1GrandPrix> {
    const calendar = await this.refreshCalendar();
    const round = calendar.rounds.find((item) => item.round === roundNumber);
    if (!round) throw new F1NotFoundError(roundNumber);

    const sessions = [];
    for (const session of round.sessions) {
      const result =
        Date.parse(session.startsAt) <= this.now().getTime()
          ? await this.getSessionResult(session)
          : null;
      sessions.push({ ...session, results: result?.entries ?? null });
    }
    return {
      season: round.season,
      round: round.round,
      raceName: round.raceName,
      ...localization(round),
      country: round.country,
      circuitName: round.circuitName,
      sessions,
    };
  }

  async getOverview(): Promise<F1Overview> {
    const calendar = await this.refreshCalendar();
    const now = this.now().getTime();
    let lastCompletedGp: number | null = null;
    let lastCompletedSession: F1SessionSchedule | null = null;

    for (const round of calendar.rounds) {
      const race = round.sessions.find((session) => session.kind === 'race');
      if (!race || Date.parse(race.startsAt) > now) continue;
      const result = await this.getSessionResult(race);
      if (result) {
        lastCompletedGp = round.round;
        lastCompletedSession = race;
      }
    }

    const nextSession =
      calendar.rounds
        .flatMap((round) => round.sessions)
        .filter((session) => Date.parse(session.startsAt) > now)
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] ?? null;
    const nextRound = nextSession?.round;

    let standings = await this.repository.getLatestStandingsSnapshot();
    if (!standings && lastCompletedSession) {
      try {
        standings = await this.captureStandings(lastCompletedSession);
      } catch (error) {
        // кубок — необязательная часть обзора: календарь и протоколы открываются всегда
        logger.warn(
          { err: error, sessionId: lastCompletedSession.id },
          'Кубок после последнего этапа пока недоступен',
        );
      }
    }

    return {
      season: calendar.season,
      rounds: calendar.rounds.map((round) => ({
        round: round.round,
        raceName: round.raceName,
        ...localization(round),
        country: round.country,
        circuitName: round.circuitName,
        startsAt: round.startsAt,
        status:
          nextRound === undefined
            ? lastCompletedGp !== null && round.round <= lastCompletedGp
              ? 'completed'
              : 'upcoming'
            : round.round < nextRound
              ? 'completed'
              : round.round === nextRound
                ? 'next'
                : 'upcoming',
      })),
      standings,
      lastCompletedGp,
      nextSession,
    };
  }

  async captureStandings(
    session: F1SessionSchedule,
    { allowStaleStandings = false }: { allowStaleStandings?: boolean } = {},
  ): Promise<F1StandingsSnapshot> {
    const existing = await this.repository.getStandingsSnapshot(session.id);
    if (existing) return existing;

    const previous = await this.repository.getLatestStandingsSnapshot(
      session.startsAt,
      session.season,
    );
    let baseline: Pick<F1StandingsSnapshot, 'drivers' | 'constructors'> | null = previous;
    if (!baseline) {
      const previousRace = await this.getPreviousPublishedRace(session);
      if (previousRace) {
        const [drivers, constructors] = await Promise.all([
          this.jolpica.getDriverStandings(session.season, previousRace.round),
          this.jolpica.getConstructorStandings(session.season, previousRace.round),
        ]);
        baseline = { drivers, constructors };
      }
    }

    const [drivers, constructors] = await Promise.all([
      this.jolpica.getDriverStandings(session.season),
      this.jolpica.getConstructorStandings(session.season),
    ]);

    // протокол может опубликоваться раньше, чем Jolpica пересчитает кубок: сравниваем
    // актуальные standings с standings после предыдущего раунда и не фиксируем дельты
    // устаревшего кубка — снапшот хранится навсегда
    if (!allowStaleStandings && POINTS_SESSION_KINDS.has(session.kind) && session.round > 1) {
      const [previousDrivers, previousConstructors] = await Promise.all([
        this.jolpica.getDriverStandings(session.season, session.round - 1),
        this.jolpica.getConstructorStandings(session.season, session.round - 1),
      ]);
      if (
        sameStandings(drivers, previousDrivers) ||
        sameStandings(constructors, previousConstructors)
      ) {
        throw new F1StandingsNotReadyError(session.id);
      }
    }

    const snapshot = buildStandingsSnapshot(
      session.id,
      { drivers, constructors },
      baseline,
      new Date(session.startsAt),
    );
    await this.repository.saveStandingsSnapshot(snapshot);
    return snapshot;
  }

  private async getPreviousPublishedRace(
    session: F1SessionSchedule,
  ): Promise<F1SessionSchedule | null> {
    const calendar = await this.refreshCalendar();
    const sessions = calendar.rounds
      .flatMap((round) => round.sessions)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    const currentIndex = sessions.findIndex((item) => item.id === session.id);
    const previous = currentIndex > 0 ? sessions[currentIndex - 1] : undefined;
    if (!previous || previous.kind !== 'race' || previous.round !== session.round - 1) return null;
    return (await this.repository.getSessionResult(previous.id)) ? previous : null;
  }

  async getSettings(chatId: number): Promise<F1Settings> {
    const document = await this.subscribers.getByChat(chatId);
    return f1SettingsSchema.parse({ ...DEFAULT_F1_SETTINGS, ...document });
  }

  async updateSettings(chatId: number, patch: UpdateF1Settings): Promise<F1Settings> {
    const validPatch = updateF1SettingsSchema.parse(patch);
    const document = await this.subscribers.upsert(chatId, validPatch);
    if (!document) return this.getSettings(chatId);
    return f1SettingsSchema.parse({ ...DEFAULT_F1_SETTINGS, ...document });
  }
}
