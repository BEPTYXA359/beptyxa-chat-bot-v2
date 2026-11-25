import type { F1StandingEntry, F1StandingsSnapshot } from './f1.types';

type Standings = Pick<F1StandingsSnapshot, 'drivers' | 'constructors'>;

const applyDelta = (
  current: F1StandingEntry[],
  previous: F1StandingEntry[] | undefined,
): F1StandingEntry[] => {
  const previousById = new Map(previous?.map((entry) => [entry.id, entry]));
  return current.map((entry) => {
    const baseline = previousById.get(entry.id);
    return {
      ...entry,
      previousPosition: baseline?.position ?? null,
      positionDelta: baseline ? baseline.position - entry.position : null,
      pointsDelta: baseline ? entry.points - baseline.points : null,
    };
  });
};

export function buildStandingsSnapshot(
  sessionId: string,
  current: Standings,
  previous: Standings | null,
  capturedAt = new Date(),
): F1StandingsSnapshot {
  return {
    sessionId,
    capturedAt: capturedAt.toISOString(),
    drivers: applyDelta(current.drivers, previous?.drivers),
    constructors: applyDelta(current.constructors, previous?.constructors),
  };
}
