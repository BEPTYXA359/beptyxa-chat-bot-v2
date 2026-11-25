import { z } from 'zod';
import { F1HttpClient } from './f1.http';
import { getConstructorNameRu, getDriverNameRu } from './f1.names';
import { normalizeJolpicaResults } from './f1.normalizer';
import type { F1ResultEntry, F1SessionKind, F1StandingEntry } from './f1.types';

const sessionTimeSchema = z.object({ date: z.string(), time: z.string() });
const driverSchema = z.object({
  driverId: z.string(),
  permanentNumber: z.string().optional(),
  code: z.string().optional(),
  givenName: z.string(),
  familyName: z.string(),
});
const constructorSchema = z.object({ constructorId: z.string(), name: z.string() });
const resultSchema = z.object({
  number: z.string().optional(),
  position: z.string(),
  positionText: z.string().optional(),
  points: z.string().optional(),
  Driver: driverSchema,
  Constructor: constructorSchema,
  laps: z.string().optional(),
  status: z.string().optional(),
  Time: z.object({ time: z.string() }).optional(),
  Q1: z.string().optional(),
  Q2: z.string().optional(),
  Q3: z.string().optional(),
});

export const jolpicaRaceSchema = z.object({
  season: z.string(),
  round: z.string(),
  raceName: z.string(),
  date: z.string(),
  time: z.string(),
  Circuit: z.object({
    circuitName: z.string(),
    Location: z.object({ country: z.string() }),
  }),
  FirstPractice: sessionTimeSchema.optional(),
  SecondPractice: sessionTimeSchema.optional(),
  ThirdPractice: sessionTimeSchema.optional(),
  SprintQualifying: sessionTimeSchema.optional(),
  Sprint: sessionTimeSchema.optional(),
  Qualifying: sessionTimeSchema.optional(),
  Results: z.array(resultSchema).optional(),
  QualifyingResults: z.array(resultSchema).optional(),
  SprintResults: z.array(resultSchema).optional(),
  SprintQualifyingResults: z.array(resultSchema).optional(),
});

export const jolpicaCalendarResponseSchema = z.object({
  MRData: z.object({ RaceTable: z.object({ Races: z.array(jolpicaRaceSchema) }) }),
});

const driverStandingsResponseSchema = z.object({
  MRData: z.object({
    StandingsTable: z.object({
      StandingsLists: z.array(
        z.object({
          DriverStandings: z.array(
            z.object({
              position: z.string(),
              points: z.string(),
              Driver: driverSchema,
            }),
          ),
        }),
      ),
    }),
  }),
});

const constructorStandingsResponseSchema = z.object({
  MRData: z.object({
    StandingsTable: z.object({
      StandingsLists: z.array(
        z.object({
          ConstructorStandings: z.array(
            z.object({
              position: z.string(),
              points: z.string(),
              Constructor: constructorSchema,
            }),
          ),
        }),
      ),
    }),
  }),
});

export type JolpicaRace = z.infer<typeof jolpicaRaceSchema>;
export type JolpicaResult = z.infer<typeof resultSchema>;

const RESULT_PATHS: Partial<Record<F1SessionKind, string>> = {
  sprintQualifying: 'sprintqualifying',
  sprint: 'sprint',
  qualifying: 'qualifying',
  race: 'results',
};

export class JolpicaProvider {
  constructor(private readonly http = new F1HttpClient({ minIntervalMs: 300 })) {}

  async getCalendar(season: number): Promise<JolpicaRace[]> {
    const response = await this.http.request(
      `https://api.jolpi.ca/ergast/f1/${season}/races.json`,
      jolpicaCalendarResponseSchema,
    );
    return response.MRData.RaceTable.Races;
  }

  async getResults(
    season: number,
    round: number,
    kind: F1SessionKind,
  ): Promise<F1ResultEntry[] | null> {
    const path = RESULT_PATHS[kind];
    if (!path) return null;
    const response = await this.http.request(
      `https://api.jolpi.ca/ergast/f1/${season}/${round}/${path}.json`,
      jolpicaCalendarResponseSchema,
    );
    const race = response.MRData.RaceTable.Races[0];
    return race ? normalizeJolpicaResults(race, kind) : null;
  }

  async getDriverStandings(season: number, round?: number): Promise<F1StandingEntry[]> {
    const suffix = round === undefined ? '' : `${round}/`;
    const response = await this.http.request(
      `https://api.jolpi.ca/ergast/f1/${season}/${suffix}driverstandings.json`,
      driverStandingsResponseSchema,
    );
    const standings = response.MRData.StandingsTable.StandingsLists[0]?.DriverStandings ?? [];
    return standings.map((entry) => ({
      id: entry.Driver.driverId,
      name: `${entry.Driver.givenName} ${entry.Driver.familyName}`,
      nameRu: getDriverNameRu(
        entry.Driver.driverId,
        `${entry.Driver.givenName} ${entry.Driver.familyName}`,
      ),
      position: Number(entry.position),
      previousPosition: null,
      positionDelta: null,
      points: Number(entry.points),
      pointsDelta: null,
    }));
  }

  async getConstructorStandings(season: number, round?: number): Promise<F1StandingEntry[]> {
    const suffix = round === undefined ? '' : `${round}/`;
    const response = await this.http.request(
      `https://api.jolpi.ca/ergast/f1/${season}/${suffix}constructorstandings.json`,
      constructorStandingsResponseSchema,
    );
    const standings = response.MRData.StandingsTable.StandingsLists[0]?.ConstructorStandings ?? [];
    return standings.map((entry) => ({
      id: entry.Constructor.constructorId,
      name: entry.Constructor.name,
      nameRu: getConstructorNameRu(entry.Constructor.constructorId, entry.Constructor.name),
      position: Number(entry.position),
      previousPosition: null,
      positionDelta: null,
      points: Number(entry.points),
      pointsDelta: null,
    }));
  }
}
