import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatResponse, FakeChatModel, toolCall, toolCallResponse } from '@di-framework/ai';
import { createBaseballAgent } from './agent.ts';
import { reportCsv } from './export.ts';
import type { Batting, GameInput } from './schema.ts';
import { battingStats, pitchingStats } from './stats.ts';
import { BaseballStore } from './store.ts';
import { baseballTools } from './tools.ts';

const paths: string[] = [];
const stores: BaseballStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});
const team = {
  teamId: 'owls-2026',
  name: 'Owls',
  season: '2026',
  division: 'Majors',
  inningsPerGame: 6 as const,
};
const player = {
  teamId: team.teamId,
  playerId: 'alex',
  name: 'Alex',
  number: '7',
  active: true,
  expectedRevision: null,
};
const query = { teamId: team.teamId, from: null, through: null };
const batting: Batting = {
  AB: 3,
  H: 2,
  doubles: 1,
  triples: 0,
  HR: 0,
  R: 1,
  RBI: 2,
  BB: 1,
  HBP: 0,
  SO: 1,
  SB: 1,
  CS: 0,
  SF: 0,
  SH: 0,
  CI: 0,
};
const game: GameInput = {
  teamId: team.teamId,
  gameId: 'foxes-1',
  date: '2026-09-12',
  opponent: 'Foxes',
  gameNumber: 1,
  runsFor: 5,
  runsAgainst: 3,
  source: 'Synthetic test scorebook',
  expectedRevision: null,
  correctionReason: null,
  lines: [
    {
      playerId: 'alex',
      batting,
      pitching: { outs: 7, H: 2, R: 1, ER: 1, BB: 1, HBP: 0, SO: 3 },
      fielding: { PO: 1, A: 2, E: 1 },
      pitchCount: 38,
    },
  ],
};
function setup(path?: string) {
  const store = new BaseballStore(path);
  stores.push(store);
  store.createTeam(team);
  store.savePlayer(player);
  return store;
}

test('calculates rates from cumulative opportunities, not averages of game averages', () => {
  const s = setup();
  s.saveGame(game);
  s.saveGame({
    ...game,
    gameId: 'foxes-2',
    date: '2026-09-13',
    runsFor: 1,
    runsAgainst: 2,
    lines: [
      {
        ...game.lines[0],
        batting: { ...batting, AB: 1, H: 0, doubles: 0, RBI: 0, BB: 0 },
        pitching: null,
        fielding: null,
        pitchCount: null,
      },
    ],
  });
  const r = s.report(query);
  expect(r.record).toEqual({
    games: 2,
    wins: 1,
    losses: 1,
    ties: 0,
    runsFor: 6,
    runsAgainst: 5,
  });
  expect(r.batting?.AVG).toBe(0.5); // 2 / 4, not (2/3 + 0/1) / 2
  expect(r.batting?.OBP).toBe(0.6);
  expect(r.batting?.SLG).toBe(0.75);
  expect(r.batting?.OPS).toBeCloseTo(1.35);
  expect(r.pitching?.IP).toBe('2.1');
  expect(r.pitching?.ERA).toBeCloseTo(18 / 7);
  expect(r.pitching?.WHIP).toBeCloseTo(9 / 7);
  expect(r.fielding?.FPCT).toBe(0.75);
  expect(r.players[0]?.coverage).toEqual({
    battingGames: 2,
    pitchingGames: 1,
    fieldingGames: 1,
    pitchCountGames: 1,
  });
});

test('handles walks, sacrifices, interference, and zero-denominator rates', () => {
  const b = {
    ...batting,
    AB: 0,
    H: 0,
    doubles: 0,
    SO: 0,
    BB: 1,
    HBP: 1,
    SF: 1,
    SH: 1,
    CI: 1,
  };
  expect(battingStats([b])).toMatchObject({
    PA: 5,
    TB: 0,
    AVG: null,
    OBP: 2 / 3,
    SLG: null,
    OPS: null,
  });
  expect(battingStats([])).toBeNull();
  expect(pitchingStats([{ outs: 0, ER: 1, R: 1, H: 1, BB: 1, HBP: 0, SO: 0 }], 6)).toMatchObject({
    IP: '0.0',
    ERA: null,
    WHIP: null,
  });
  expect(pitchingStats([game.lines[0]!.pitching!], 7)?.ERA).toBe(3);
  expect(pitchingStats([game.lines[0]!.pitching!], 9)?.ERA).toBeCloseTo(27 / 7);
});

test('records pitch counts independently and preserves missing categories', () => {
  const s = setup();
  s.savePlayer({ ...player, playerId: 'sam', name: 'Sam' });
  s.saveGame({
    ...game,
    lines: [
      {
        playerId: 'alex',
        batting: null,
        pitching: null,
        fielding: null,
        pitchCount: 24,
      },
    ],
  });
  const r = s.report(query);
  expect(r.batting).toBeNull();
  expect(r.players[0]).toMatchObject({
    pitchCount: 24,
    batting: null,
    pitching: null,
  });
  expect(r.players[1]).toMatchObject({
    recordedGames: 0,
    pitchCount: null,
    batting: null,
  });
  expect(r.players[0]?.pitchLog).toEqual([
    { date: game.date, gameId: game.gameId, opponent: 'Foxes', pitchCount: 24 },
  ]);
});

test('replaces whole games once, preserves history, voids, and restores', () => {
  const s = setup();
  s.saveGame(game);
  const corrected = {
    ...game,
    runsFor: 2,
    expectedRevision: 1,
    correctionReason: 'Scorebook correction',
  };
  expect(s.saveGame(corrected).revision).toBe(2);
  expect(s.report(query).record).toMatchObject({
    games: 1,
    losses: 1,
    runsFor: 2,
  });
  expect(s.report(query).batting?.AB).toBe(3);
  expect(() => s.saveGame(corrected)).toThrow('Revision conflict');
  const key = { teamId: team.teamId, gameId: game.gameId };
  s.voidGame({ ...key, expectedRevision: 2, reason: 'Wrong matchup' });
  expect(s.report(query).record.games).toBe(0);
  expect(s.report(query).batting).toBeNull();
  s.saveGame({
    ...corrected,
    expectedRevision: 3,
    correctionReason: 'Scorer confirmed original matchup',
  });
  expect(s.report(query).record.games).toBe(1);
  const history = s.history(key);
  expect(history.map((h) => h.revision)).toEqual([1, 2, 3, 4]);
  expect(history[0]?.game.runsFor).toBe(5);
  expect(history[2]?.game.voided).toBe(true);
});

test('rejects duplicate matches but supports doubleheaders and other seasons', () => {
  const s = setup();
  expect(s.createTeam(team)).toEqual(team);
  s.saveGame(game);
  expect(() => s.saveGame({ ...game, gameId: 'oops', opponent: ' FOXES ' })).toThrow(
    'already recorded',
  );
  s.saveGame({ ...game, gameId: 'doubleheader-2', gameNumber: 2 });
  expect(s.report(query).record.games).toBe(2);
  s.createTeam({ ...team, teamId: 'owls-2027', season: '2027' });
  expect(s.report({ ...query, teamId: 'owls-2027' }).record.games).toBe(0);
});

test('rejects bad scorebooks atomically and keeps existing revision intact', () => {
  const s = setup();
  const invalid = [
    { date: '2026-02-30' },
    { runsFor: -1 },
    { unknown: true },
    { lines: [game.lines[0], game.lines[0]] },
    { lines: [{ ...game.lines[0], playerId: 'missing' }] },
    { lines: [{ ...game.lines[0], batting: { ...batting, H: 4 } }] },
    { lines: [{ ...game.lines[0], batting: { ...batting, triples: 2 } }] },
    {
      lines: [{ ...game.lines[0], pitching: { ...game.lines[0]!.pitching, ER: 2 } }],
    },
    { lines: [{ ...game.lines[0], pitchCount: 12.5 }] },
    { lines: [{ ...game.lines[0], batting: { AB: 3, H: 2 } }] },
    { runsFor: 0 },
  ];
  for (const patch of invalid) expect(() => s.saveGame({ ...game, ...patch })).toThrow();
  expect(s.listGames({ teamId: team.teamId })).toHaveLength(0);
  s.saveGame(game);
  expect(() => s.saveGame({ ...game, expectedRevision: 1 })).toThrow('correction reason');
  expect(s.history({ teamId: team.teamId, gameId: game.gameId })).toHaveLength(1);
});

test('persists across connections and rejects stale writers', () => {
  const path = mkdtempSync(join(tmpdir(), 'baseball-test-'));
  paths.push(path);
  const filename = join(path, 'stats.sqlite');
  const first = setup(filename);
  first.saveGame(game);
  const second = new BaseballStore(filename);
  stores.push(second);
  expect(second.report(query).batting?.H).toBe(2);
  first.saveGame({
    ...game,
    runsFor: 6,
    expectedRevision: 1,
    correctionReason: 'Added missed run',
  });
  expect(() =>
    second.saveGame({
      ...game,
      expectedRevision: 1,
      correctionReason: 'Stale edit',
    }),
  ).toThrow('Revision conflict');
  expect(second.report(query).record.runsFor).toBe(6);
});

test('keeps retired player history and filters dates inclusively', () => {
  const s = setup();
  s.saveGame(game);
  s.savePlayer({
    ...player,
    name: 'Alex J.',
    active: false,
    expectedRevision: 1,
  });
  expect(s.report({ ...query, from: game.date, through: game.date }).players[0]).toMatchObject({
    name: 'Alex J.',
    active: false,
    recordedGames: 1,
  });
  expect(s.report({ ...query, from: '2026-09-13' }).record.games).toBe(0);
  expect(() => s.report({ ...query, from: '2026-09-13', through: game.date })).toThrow(
    'Start date',
  );
});

test('CSV includes coverage, correct ERA basis, null blanks, and escaped names', () => {
  const s = setup();
  s.savePlayer({ ...player, name: '=SUM(1,2) "Alex"', expectedRevision: 1 });
  const csv = reportCsv(s.report(query));
  expect(csv).toContain('"ERA_6"');
  expect(csv).toContain('"battingGames"');
  expect(csv).toContain('"\'=SUM(1,2) ""Alex"""');
  expect(csv).not.toContain('undefined');
  expect(csv).not.toContain('null');
});

test('tool runtime validation returns actionable errors without changing data', async () => {
  const s = setup();
  const save = baseballTools(s).find((tool) => tool.toolDefinition.name === 'save_game')!;
  const response = JSON.parse(await save.call(JSON.stringify({ ...game, runsFor: 'five' })));
  expect(response.ok).toBe(false);
  expect(response.error).toContain('runsFor');
  expect(s.report(query).record.games).toBe(0);
});

test('real DI Framework tool loop saves a game and reads calculated season stats', async () => {
  let calls = 0;
  const model = new FakeChatModel((prompt) => {
    expect(prompt.getSystemMessage().text).toContain('missing counts');
    if (calls++ === 0) return toolCallResponse([toolCall('save', 'save_game', game)]);
    if (calls === 2) {
      expect(JSON.stringify(prompt.messages)).toContain('revision');
      return toolCallResponse([toolCall('report', 'season_report', query)]);
    }
    expect(JSON.stringify(prompt.messages)).toContain('0.6666666666666666');
    return ChatResponse.of('Saved. Alex is 2 for 3; Owls are 1–0.');
  });
  const baseball = createBaseballAgent(model, { databasePath: ':memory:' });
  try {
    baseball.store.createTeam(team);
    baseball.store.savePlayer(player);
    const response = await baseball.agent.chat(
      'Record these confirmed postgame stats and show the season report.',
    );
    expect(response.content).toBe('Saved. Alex is 2 for 3; Owls are 1–0.');
    expect(baseball.store.report(query).record.wins).toBe(1);
    expect(model.calls).toHaveLength(3);
    baseball.clearHistory();
    expect(baseball.store.report(query).record.games).toBe(1);
  } finally {
    baseball.close();
  }
});
