import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  type Game,
  gameQuerySchema,
  gameSchema,
  type Player,
  playerSchema,
  reportSchema,
  type Team,
  teamQuerySchema,
  teamSchema,
  validateGame,
  voidSchema,
} from './schema.ts';
import { seasonReport } from './stats.ts';

type Row = { payload: string };

/** SQLite transactions protect whole-game replacements and their revision history. */
export class BaseballStore {
  private db: Database;
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS players (
        team_id TEXT NOT NULL REFERENCES teams(id), id TEXT NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY (team_id, id)
      );
      CREATE TABLE IF NOT EXISTS games (
        team_id TEXT NOT NULL REFERENCES teams(id), id TEXT NOT NULL,
        date TEXT NOT NULL, opponent TEXT NOT NULL, game_number INTEGER NOT NULL,
        payload TEXT NOT NULL, PRIMARY KEY (team_id, id),
        UNIQUE (team_id, date, opponent, game_number)
      );
      CREATE TABLE IF NOT EXISTS revisions (
        team_id TEXT NOT NULL, game_id TEXT NOT NULL, revision INTEGER NOT NULL,
        reason TEXT NOT NULL, saved_at TEXT NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY (team_id, game_id, revision),
        FOREIGN KEY (team_id, game_id) REFERENCES games(team_id, id)
      );
    `);
  }

  close() {
    this.db.close();
  }

  listTeams(): Team[] {
    return (this.db.query('SELECT payload FROM teams ORDER BY id').all() as Row[]).map((row) =>
      JSON.parse(row.payload),
    );
  }

  createTeam(input: unknown): Team {
    const team = teamSchema.parse(input);
    return this.db
      .transaction(() => {
        const existing = this.db
          .query('SELECT payload FROM teams WHERE id = ?')
          .get(team.teamId) as Row | null;
        if (existing) {
          if (existing.payload === JSON.stringify(team)) return team;
          throw new Error('Team ID already exists; use a distinct ID for each team and season');
        }
        this.db.query('INSERT INTO teams VALUES (?, ?)').run(team.teamId, JSON.stringify(team));
        return team;
      })
      .immediate();
  }

  private team(teamId: string): Team {
    const row = this.db.query('SELECT payload FROM teams WHERE id = ?').get(teamId) as Row | null;
    if (!row) throw new Error(`Unknown team ${teamId}; list or create teams first`);
    return JSON.parse(row.payload);
  }

  roster(input: unknown): Player[] {
    const { teamId } = teamQuerySchema.parse(input);
    this.team(teamId);
    return (
      this.db
        .query('SELECT payload FROM players WHERE team_id = ? ORDER BY id')
        .all(teamId) as Row[]
    ).map((row) => JSON.parse(row.payload));
  }

  savePlayer(input: unknown): Player {
    const { expectedRevision, ...data } = playerSchema.parse(input);
    return this.db
      .transaction(() => {
        const roster = this.roster({ teamId: data.teamId });
        const old = roster.find((p) => p.playerId === data.playerId);
        this.checkRevision(old, expectedRevision);
        const player = { ...data, revision: (old?.revision ?? 0) + 1 };
        this.db
          .query(
            `INSERT INTO players VALUES (?, ?, ?)
        ON CONFLICT (team_id, id) DO UPDATE SET payload = excluded.payload`,
          )
          .run(player.teamId, player.playerId, JSON.stringify(player));
        return player;
      })
      .immediate();
  }

  listGames(input: unknown): Game[] {
    const { teamId } = teamQuerySchema.parse(input);
    this.team(teamId);
    return (
      this.db
        .query('SELECT payload FROM games WHERE team_id = ? ORDER BY date, game_number, id')
        .all(teamId) as Row[]
    ).map((row) => JSON.parse(row.payload));
  }

  getGame(input: unknown): Game {
    const { teamId, gameId } = gameQuerySchema.parse(input);
    const row = this.db
      .query('SELECT payload FROM games WHERE team_id = ? AND id = ?')
      .get(teamId, gameId) as Row | null;
    if (!row) throw new Error(`Unknown game ${gameId} for team ${teamId}`);
    return JSON.parse(row.payload);
  }

  saveGame(input: unknown): Game {
    const parsed = gameSchema.parse(input);
    validateGame(parsed);
    const { expectedRevision, correctionReason, ...data } = parsed;
    return this.db
      .transaction(() => {
        const roster = new Set(this.roster({ teamId: data.teamId }).map((p) => p.playerId));
        for (const line of data.lines) {
          if (!roster.has(line.playerId)) throw new Error(`Unknown roster player ${line.playerId}`);
        }
        const oldRow = this.db
          .query('SELECT payload FROM games WHERE team_id = ? AND id = ?')
          .get(data.teamId, data.gameId) as Row | null;
        const old: Game | undefined = oldRow ? JSON.parse(oldRow.payload) : undefined;
        this.checkRevision(old, expectedRevision);
        if (old && !correctionReason)
          throw new Error('A correction reason is required to replace a game');
        const opponentKey = data.opponent.toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
        const duplicate = this.db
          .query(
            `SELECT id FROM games
        WHERE team_id = ? AND date = ? AND opponent = ? AND game_number = ? AND id != ?`,
          )
          .get(data.teamId, data.date, opponentKey, data.gameNumber, data.gameId);
        if (duplicate)
          throw new Error(
            'This matchup is already recorded; correct its existing game ID or specify the doubleheader game number',
          );
        const game: Game = {
          ...data,
          revision: (old?.revision ?? 0) + 1,
          voided: false,
        };
        this.db
          .query(
            `INSERT INTO games VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (team_id, id) DO UPDATE SET date = excluded.date,
        opponent = excluded.opponent, game_number = excluded.game_number, payload = excluded.payload`,
          )
          .run(
            game.teamId,
            game.gameId,
            game.date,
            opponentKey,
            game.gameNumber,
            JSON.stringify(game),
          );
        this.revision(game, correctionReason ?? 'Initial scorebook entry');
        return game;
      })
      .immediate();
  }

  voidGame(input: unknown): Game {
    const { teamId, gameId, expectedRevision, reason } = voidSchema.parse(input);
    return this.db
      .transaction(() => {
        const old = this.getGame({ teamId, gameId });
        this.checkRevision(old, expectedRevision);
        if (old.voided) throw new Error('Game is already voided');
        const game = { ...old, revision: old.revision + 1, voided: true };
        this.db
          .query('UPDATE games SET payload = ? WHERE team_id = ? AND id = ?')
          .run(JSON.stringify(game), teamId, gameId);
        this.revision(game, reason);
        return game;
      })
      .immediate();
  }

  history(input: unknown) {
    const game = this.getGame(input);
    return this.db
      .query(
        `SELECT revision, reason, saved_at AS savedAt, payload FROM revisions
      WHERE team_id = ? AND game_id = ? ORDER BY revision`,
      )
      .all(game.teamId, game.gameId)
      .map((row) => {
        const r = row as {
          revision: number;
          reason: string;
          savedAt: string;
          payload: string;
        };
        return {
          revision: r.revision,
          reason: r.reason,
          savedAt: r.savedAt,
          game: JSON.parse(r.payload) as Game,
        };
      });
  }

  report(input: unknown) {
    const { teamId, from, through } = reportSchema.parse(input);
    if (from && through && from > through)
      throw new Error('Start date must be on or before end date');
    const games = this.listGames({ teamId }).filter(
      (g) => (!from || g.date >= from) && (!through || g.date <= through),
    );
    return {
      ...seasonReport(this.team(teamId), this.roster({ teamId }), games),
      from,
      through,
    };
  }

  private checkRevision(old: { revision: number } | undefined, expected: number | null) {
    if ((old?.revision ?? null) !== expected)
      throw new Error(
        `Revision conflict: current revision is ${old?.revision ?? 'new'}. Read the current record before saving; do not retry blindly.`,
      );
  }

  private revision(game: Game, reason: string) {
    this.db
      .query('INSERT INTO revisions VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        game.teamId,
        game.gameId,
        game.revision,
        reason,
        new Date().toISOString(),
        JSON.stringify(game),
      );
  }
}
