import { functionToolCallback } from '@di-framework/ai';
import { z } from 'zod';
import {
  gameQuerySchema,
  gameSchema,
  playerSchema,
  reportSchema,
  teamQuerySchema,
  teamSchema,
  voidSchema,
} from './schema.ts';
import type { BaseballStore } from './store.ts';

export function baseballTools(store: BaseballStore) {
  const tool = (
    name: string,
    description: string,
    schema: z.ZodType,
    call: (input: unknown) => unknown,
  ) =>
    functionToolCallback({
      name,
      description,
      inputSchema: z.toJSONSchema(schema),
      call: (input) => {
        try {
          return { ok: true, result: call(schema.parse(input)) };
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof z.ZodError
                ? error.issues
                    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
                    .join('; ')
                : error instanceof Error
                  ? error.message
                  : 'Stats operation failed',
          };
        }
      },
    });
  return [
    tool(
      'list_teams',
      'List saved teams and seasons. Use their IDs for other tools.',
      z.strictObject({}),
      () => store.listTeams(),
    ),
    tool(
      'create_team',
      'Create one team/season with an explicit ERA innings basis. Identical retries reuse the team.',
      teamSchema,
      (v) => store.createTeam(v),
    ),
    tool(
      'get_roster',
      'Read roster IDs, names, jersey numbers, active status, and current revisions.',
      teamQuerySchema,
      (v) => store.roster(v),
    ),
    tool(
      'save_player',
      'Add or update a player. A stable player ID preserves past stats after a name/number change. Set active=false to retire from the roster.',
      playerSchema,
      (v) => store.savePlayer(v),
    ),
    tool(
      'list_games',
      'Read saved game records including revisions and void status. Check before adding a game.',
      teamQuerySchema,
      (v) => store.listGames(v),
    ),
    tool(
      'get_game',
      'Read a game with all recorded lines before making a correction.',
      gameQuerySchema,
      (v) => store.getGame(v),
    ),
    tool(
      'save_game',
      'Save a final score and player lines. Null categories are unrecorded. Replaces the ENTIRE game on correction, so preserve every unaffected line. Records only user-supplied or confirmed stats. Requires current revision and a reason for corrections; restores a voided game when corrected.',
      gameSchema,
      (v) => store.saveGame(v),
    ),
    tool(
      'void_game',
      'Exclude a mistakenly recorded game from totals while retaining its history. Use only when the user requests removal.',
      voidSchema,
      (v) => store.voidGame(v),
    ),
    tool(
      'game_history',
      'Read every saved version and reason for a game correction or removal.',
      gameQuerySchema,
      (v) => store.history(v),
    ),
    tool(
      'season_report',
      'Calculate team record, player and team batting/pitching/fielding stats, coverage, and pitch logs from saved games. Optional inclusive date range. Null rates mean no denominator; never average per-game averages.',
      reportSchema,
      (v) => store.report(v),
    ),
  ];
}
