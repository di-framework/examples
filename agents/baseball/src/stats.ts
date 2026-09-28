import type { Batting, Fielding, Game, Pitching, Player, Team } from './schema.ts';

const ratio = (n: number, d: number) => (d === 0 ? null : n / d);
export const innings = (outs: number) => `${Math.floor(outs / 3)}.${outs % 3}`;

function sum<T extends Record<string, number>>(rows: T[]): T | null {
  if (!rows.length) return null;
  const result = { ...rows[0] } as T;
  for (const row of rows.slice(1)) {
    for (const key of Object.keys(row) as (keyof T)[])
      result[key] = (result[key]! + row[key]!) as T[keyof T];
  }
  return result;
}

export function battingStats(rows: Batting[]) {
  const b = sum(rows);
  if (!b) return null;
  const TB = b.H + b.doubles + 2 * b.triples + 3 * b.HR;
  const OBP = ratio(b.H + b.BB + b.HBP, b.AB + b.BB + b.HBP + b.SF);
  const SLG = ratio(TB, b.AB);
  return {
    ...b,
    PA: b.AB + b.BB + b.HBP + b.SF + b.SH + b.CI,
    TB,
    AVG: ratio(b.H, b.AB),
    OBP,
    SLG,
    OPS: OBP === null || SLG === null ? null : OBP + SLG,
  };
}

export function pitchingStats(rows: Pitching[], basis: number) {
  const p = sum(rows);
  return (
    p && {
      ...p,
      IP: innings(p.outs),
      ERA: ratio(p.ER * basis * 3, p.outs),
      WHIP: ratio((p.BB + p.H) * 3, p.outs),
    }
  );
}

export function fieldingStats(rows: Fielding[]) {
  const f = sum(rows);
  return f && { ...f, FPCT: ratio(f.PO + f.A, f.PO + f.A + f.E) };
}

export function seasonReport(team: Team, roster: Player[], games: Game[]) {
  const activeGames = games.filter((game) => !game.voided);
  const summaries = roster.map((player) => {
    const entries = activeGames.flatMap((game) =>
      game.lines
        .filter((line) => line.playerId === player.playerId)
        .map((line) => ({ game, line })),
    );
    const batting = entries.flatMap(({ line }) => (line.batting ? [line.batting] : []));
    const pitching = entries.flatMap(({ line }) => (line.pitching ? [line.pitching] : []));
    const fielding = entries.flatMap(({ line }) => (line.fielding ? [line.fielding] : []));
    const pitches = entries.filter(({ line }) => line.pitchCount !== null);
    return {
      ...player,
      recordedGames: entries.length,
      coverage: {
        battingGames: batting.length,
        pitchingGames: pitching.length,
        fieldingGames: fielding.length,
        pitchCountGames: pitches.length,
      },
      batting: battingStats(batting),
      pitching: pitchingStats(pitching, team.inningsPerGame),
      fielding: fieldingStats(fielding),
      pitchCount: pitches.length
        ? pitches.reduce((sum, { line }) => sum + line.pitchCount!, 0)
        : null,
      pitchLog: pitches.map(({ game, line }) => ({
        date: game.date,
        gameId: game.gameId,
        opponent: game.opponent,
        pitchCount: line.pitchCount,
      })),
    };
  });
  const allLines = activeGames.flatMap((game) => game.lines);
  return {
    team,
    eraInnings: team.inningsPerGame,
    coverageNote:
      'Totals include recorded lines only. Missing categories and undefined rates are null; coverage is not proof of a complete scorebook.',
    record: {
      games: activeGames.length,
      wins: activeGames.filter((g) => g.runsFor > g.runsAgainst).length,
      losses: activeGames.filter((g) => g.runsFor < g.runsAgainst).length,
      ties: activeGames.filter((g) => g.runsFor === g.runsAgainst).length,
      runsFor: activeGames.reduce((n, g) => n + g.runsFor, 0),
      runsAgainst: activeGames.reduce((n, g) => n + g.runsAgainst, 0),
    },
    batting: battingStats(allLines.flatMap((line) => (line.batting ? [line.batting] : []))),
    pitching: pitchingStats(
      allLines.flatMap((line) => (line.pitching ? [line.pitching] : [])),
      team.inningsPerGame,
    ),
    fielding: fieldingStats(allLines.flatMap((line) => (line.fielding ? [line.fielding] : []))),
    players: summaries,
  };
}
