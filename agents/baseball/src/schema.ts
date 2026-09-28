import { z } from 'zod';

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
const label = z.string().trim().min(1).max(160);
const count = z.number().int().min(0).max(1000);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value,
    'Use a real calendar date in YYYY-MM-DD format',
  );
export const battingSchema = z.strictObject({
  AB: count,
  H: count,
  doubles: count,
  triples: count,
  HR: count,
  R: count,
  RBI: count,
  BB: count,
  HBP: count,
  SO: count,
  SB: count,
  CS: count,
  SF: count,
  SH: count,
  CI: count,
});
export const pitchingSchema = z.strictObject({
  outs: count,
  H: count,
  R: count,
  ER: count,
  BB: count,
  HBP: count,
  SO: count,
});
export const fieldingSchema = z.strictObject({ PO: count, A: count, E: count });
export const lineSchema = z.strictObject({
  playerId: id,
  batting: battingSchema
    .nullable()
    .describe('Complete batting line, or null if not recorded. CI is catcher interference.'),
  pitching: pitchingSchema
    .nullable()
    .describe(
      'Complete pitching line, or null if not recorded. Store innings as outs: 2.1 IP = 7 outs.',
    ),
  pitchCount: count
    .nullable()
    .describe('Actual pitches thrown, independently of pitching stats; null means unknown.'),
  fielding: fieldingSchema.nullable().describe('Complete fielding line, or null if not recorded.'),
});
export const teamSchema = z.strictObject({
  teamId: id,
  name: label,
  season: label,
  division: label,
  inningsPerGame: z
    .union([z.literal(6), z.literal(7), z.literal(9)])
    .describe(
      'Explicit ERA basis for this team/season; ask the scorer, commonly 6 for younger divisions.',
    ),
});
export const playerSchema = z.strictObject({
  teamId: id,
  playerId: id,
  name: label,
  number: z.string().trim().max(8),
  active: z.boolean(),
  expectedRevision: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe('null to add; current revision to edit.'),
});
export const gameSchema = z.strictObject({
  teamId: id,
  gameId: id,
  date,
  opponent: label,
  gameNumber: z
    .number()
    .int()
    .min(1)
    .max(9)
    .describe('1 normally; 2 for the second game against this opponent on the same date.'),
  runsFor: count,
  runsAgainst: count,
  source: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe('Where these stats came from, e.g. coach postgame scorebook.'),
  lines: z.array(lineSchema).max(100),
  expectedRevision: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe('null to add; current revision to replace a full game.'),
  correctionReason: z.string().trim().min(1).max(500).nullable(),
});
export const teamQuerySchema = z.strictObject({ teamId: id });
export const gameQuerySchema = z.strictObject({ teamId: id, gameId: id });
export const reportSchema = z.strictObject({
  teamId: id,
  from: date.nullable().describe('Inclusive start date, or null for entire season.'),
  through: date.nullable().describe('Inclusive end date, or null for entire season.'),
});
export const voidSchema = z.strictObject({
  teamId: id,
  gameId: id,
  expectedRevision: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
});
export type Team = z.infer<typeof teamSchema>;
export type Player = Omit<z.infer<typeof playerSchema>, 'expectedRevision'> & {
  revision: number;
};
export type GameInput = z.infer<typeof gameSchema>;
export type Game = Omit<GameInput, 'expectedRevision' | 'correctionReason'> & {
  revision: number;
  voided: boolean;
};
export type Batting = z.infer<typeof battingSchema>;
export type Pitching = z.infer<typeof pitchingSchema>;
export type Fielding = z.infer<typeof fieldingSchema>;

export function validateGame(game: GameInput): void {
  const players = new Set<string>();
  for (const line of game.lines) {
    if (players.has(line.playerId)) throw new Error(`Duplicate player ${line.playerId} in game`);
    players.add(line.playerId);
    const b = line.batting;
    if (b && (b.H > b.AB || b.H + b.SO > b.AB || b.doubles + b.triples + b.HR > b.H))
      throw new Error(`Inconsistent batting counts for ${line.playerId}`);
    if (line.pitching && line.pitching.ER > line.pitching.R)
      throw new Error(`Earned runs exceed runs for ${line.playerId}`);
  }
  const runs = game.lines.reduce((sum, line) => sum + (line.batting?.R ?? 0), 0);
  const rbi = game.lines.reduce((sum, line) => sum + (line.batting?.RBI ?? 0), 0);
  const allowed = game.lines.reduce((sum, line) => sum + (line.pitching?.R ?? 0), 0);
  if (runs > game.runsFor || rbi > game.runsFor || allowed > game.runsAgainst)
    throw new Error('Player runs/RBI exceed the recorded final score');
}
