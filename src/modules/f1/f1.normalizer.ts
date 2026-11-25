import type { JolpicaRace, JolpicaResult } from './jolpica.provider';
import {
  getConstructorNameRu,
  getCountryCode,
  getCountryRu,
  getCircuitNameRu,
  getDriverNameRu,
  getRaceNameRu,
} from './f1.names';
import {
  F1_SESSION_LABELS,
  type F1Calendar,
  type F1CalendarRound,
  type F1ResultEntry,
  type F1SessionKind,
  type F1SessionSchedule,
} from './f1.types';

const SESSION_FIELDS: Array<{
  field:
    | 'FirstPractice'
    | 'SecondPractice'
    | 'ThirdPractice'
    | 'SprintQualifying'
    | 'Sprint'
    | 'Qualifying'
    | null;
  kind: F1SessionKind;
  durationMinutes: number;
}> = [
  { field: 'FirstPractice', kind: 'practice1', durationMinutes: 60 },
  { field: 'SecondPractice', kind: 'practice2', durationMinutes: 60 },
  { field: 'ThirdPractice', kind: 'practice3', durationMinutes: 60 },
  { field: 'SprintQualifying', kind: 'sprintQualifying', durationMinutes: 60 },
  { field: 'Sprint', kind: 'sprint', durationMinutes: 60 },
  { field: 'Qualifying', kind: 'qualifying', durationMinutes: 60 },
  { field: null, kind: 'race', durationMinutes: 120 },
];

const toIso = (date: string, time: string): string => new Date(`${date}T${time}`).toISOString();

export function mergeCalendar(jolpicaRounds: JolpicaRace[]): F1Calendar {
  const rounds = jolpicaRounds.map((race): F1CalendarRound => {
    const season = Number(race.season);
    const round = Number(race.round);
    const raceStartsAt = toIso(race.date, race.time);
    const sessions = SESSION_FIELDS.filter((session) =>
      session.field ? race[session.field] : true,
    ).map((definition): F1SessionSchedule => {
      const value = definition.field ? race[definition.field] : undefined;
      const startsAt = definition.field && value ? toIso(value.date, value.time) : raceStartsAt;
      return {
        id: `${season}:${round}:${definition.kind}`,
        season,
        round,
        kind: definition.kind,
        label: F1_SESSION_LABELS[definition.kind],
        raceName: race.raceName,
        startsAt,
        expectedEnd: new Date(
          Date.parse(startsAt) + definition.durationMinutes * 60_000,
        ).toISOString(),
      };
    });

    const raceNameRu = getRaceNameRu(race.raceName);
    const circuitNameRu = getCircuitNameRu(race.Circuit.circuitName);
    const countryRu = getCountryRu(race.Circuit.Location.country);
    const countryCode = getCountryCode(race.Circuit.Location.country);

    return {
      season,
      round,
      raceName: race.raceName,
      ...(raceNameRu ? { raceNameRu: `Гран-при ${raceNameRu}` } : {}),
      country: race.Circuit.Location.country,
      ...(countryRu ? { countryRu } : {}),
      ...(countryCode ? { countryCode } : {}),
      circuitName: race.Circuit.circuitName,
      ...(circuitNameRu ? { circuitNameRu } : {}),
      startsAt: raceStartsAt,
      sessions,
    };
  });

  return { season: rounds[0]?.season ?? 0, rounds };
}

const resultEntries = (race: JolpicaRace, kind: F1SessionKind): JolpicaResult[] | undefined => {
  if (kind === 'race') return race.Results;
  if (kind === 'qualifying') return race.QualifyingResults;
  if (kind === 'sprint') return race.SprintResults;
  if (kind === 'sprintQualifying') return race.SprintQualifyingResults;
  return undefined;
};

export function normalizeJolpicaResults(
  race: JolpicaRace,
  kind: F1SessionKind,
): F1ResultEntry[] | null {
  const results = resultEntries(race, kind);
  if (!results?.length) return null;

  return results.map((entry) => {
    const driverName = `${entry.Driver.givenName} ${entry.Driver.familyName}`;
    const position = Number.parseInt(entry.position, 10);
    const dnf =
      entry.positionText === 'R' || entry.status === 'Retired' || entry.status === 'Did not finish';
    return {
      position: Number.isFinite(position) ? position : null,
      positionText: entry.positionText ?? entry.position,
      driverId: entry.Driver.driverId,
      ...(entry.Driver.permanentNumber
        ? { driverNumber: Number(entry.Driver.permanentNumber) }
        : {}),
      ...(entry.Driver.code ? { driverCode: entry.Driver.code } : {}),
      driverName,
      driverNameRu: getDriverNameRu(entry.Driver.driverId, driverName),
      constructorId: entry.Constructor.constructorId,
      constructorName: entry.Constructor.name,
      constructorNameRu: getConstructorNameRu(
        entry.Constructor.constructorId,
        entry.Constructor.name,
      ),
      ...(entry.Time && position === 1 ? { time: entry.Time.time } : {}),
      ...(entry.Time && position !== 1 ? { gap: entry.Time.time } : {}),
      ...(entry.laps ? { laps: Number(entry.laps) } : {}),
      ...(entry.status ? { status: entry.status } : {}),
      ...(entry.points ? { points: Number(entry.points) } : {}),
      ...(kind === 'qualifying' || kind === 'sprintQualifying'
        ? { segments: [entry.Q1 ?? null, entry.Q2 ?? null, entry.Q3 ?? null] }
        : {}),
      dnf,
    };
  });
}
