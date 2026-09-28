import { z } from 'zod';
import type { VideoDraft } from './video-schema.ts';
import { playKinds } from './video-schema.ts';

export const GAME_LOG_VERSION = 1 as const;

export type SpectatorMode = 'sideline' | 'broadcast';

export type FocusPlayer = { name?: string; number?: string };

/** Optional context that biases observation without inventing plays. */
export type SpectatorPriors = {
  teamName?: string;
  teamColors?: string;
  focusPlayers?: FocusPlayer[];
  mode?: SpectatorMode;
};

export type GameLogEnhancement = {
  id: string;
  model: string;
  at: string;
  notes?: string;
  data: Record<string, unknown>;
};

/** Durable recording of what a spectator observed. Not an official scorebook. */
export type GameLog = VideoDraft & {
  version: typeof GAME_LOG_VERSION;
  mode: SpectatorMode;
  priors?: SpectatorPriors;
  enhancements: GameLogEnhancement[];
};

const focusPlayerSchema = z
  .strictObject({
    name: z.string().min(1).max(80).optional(),
    number: z.string().min(1).max(8).optional(),
  })
  .refine((p) => p.name !== undefined || p.number !== undefined, {
    message: 'name or number required',
  });

export const spectatorPriorsSchema = z.strictObject({
  teamName: z.string().min(1).max(120).optional(),
  teamColors: z.string().min(1).max(120).optional(),
  focusPlayers: z.array(focusPlayerSchema).max(40).optional(),
  mode: z.enum(['sideline', 'broadcast']).optional(),
});

export const gameLogEnhancementSchema = z.strictObject({
  id: z.string().min(1).max(80),
  model: z.string().min(1).max(160),
  at: z.string().min(1).max(40),
  notes: z.string().min(1).max(2000).optional(),
  data: z.record(z.string(), z.unknown()),
});

/** Accept VideoDraft-shaped JSON plus optional spectator fields (forward-compatible). */
export function parseGameLog(value: unknown): GameLog {
  if (!value || typeof value !== 'object') throw new Error('Game log must be an object');
  const raw = value as Record<string, unknown>;
  if (raw.reviewRequired !== true) throw new Error('Game log must set reviewRequired');
  if (raw.status !== 'in_progress' && raw.status !== 'complete')
    throw new Error('Invalid game log status');
  if (typeof raw.source !== 'string' || !raw.source) throw new Error('Game log requires source');
  if (!raw.coverage || typeof raw.coverage !== 'object')
    throw new Error('Game log requires coverage');
  if (!Array.isArray(raw.windows)) throw new Error('Game log requires windows');
  if (!Array.isArray(raw.warnings)) throw new Error('Game log requires warnings');
  const version = raw.version === undefined ? GAME_LOG_VERSION : raw.version;
  if (version !== GAME_LOG_VERSION)
    throw new Error(`Unsupported game log version: ${String(version)}`);
  const mode = raw.mode === 'broadcast' ? 'broadcast' : 'sideline';
  const priors = raw.priors === undefined ? undefined : spectatorPriorsSchema.parse(raw.priors);
  const enhancements =
    raw.enhancements === undefined ? [] : z.array(gameLogEnhancementSchema).parse(raw.enhancements);
  const candidateCounts = raw.candidateCounts ?? {};
  if (typeof candidateCounts !== 'object' || candidateCounts === null)
    throw new Error('Invalid candidateCounts');
  for (const key of Object.keys(candidateCounts as object)) {
    if (!(playKinds as readonly string[]).includes(key))
      throw new Error(`Unknown play kind: ${key}`);
  }
  return {
    ...(raw as unknown as VideoDraft),
    version: GAME_LOG_VERSION,
    mode,
    ...(priors ? { priors } : {}),
    enhancements,
  };
}

export function draftToGameLog(
  draft: VideoDraft,
  options: {
    mode?: SpectatorMode;
    priors?: SpectatorPriors;
    enhancements?: GameLogEnhancement[];
  } = {},
): GameLog {
  const mode = options.mode ?? options.priors?.mode ?? 'sideline';
  return {
    ...draft,
    version: GAME_LOG_VERSION,
    mode,
    ...(options.priors ? { priors: options.priors } : {}),
    enhancements: options.enhancements ?? [],
  };
}

export function appendEnhancement(log: GameLog, enhancement: GameLogEnhancement): GameLog {
  return { ...log, enhancements: [...log.enhancements, enhancement] };
}
