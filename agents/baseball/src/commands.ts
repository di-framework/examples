import type { ChatCommand } from '@di-framework/tui/core';
import type { GameLog } from './game-log.ts';
import { resolveLiveUrl } from './live-capture.ts';
import { formatRecordingSummary } from './review.ts';
import type { VideoOptions } from './video.ts';

export interface SpectatorCommandSession {
  record(path: string, options?: VideoOptions & { enhance?: boolean }): Promise<GameLog>;
  /** Optional short sample (defaults to first 2 minutes via duration override). */
  sample?(path: string, options?: VideoOptions): Promise<GameLog>;
  /** Live OBS stream or demo until cancelled (or maxSeconds). */
  recordLive?(options?: {
    source?: 'demo' | 'stream';
    url?: string;
    segmentSeconds?: number;
    fps?: number;
    maxSeconds?: number;
    signal?: AbortSignal;
    onProgress?: (log: GameLog) => void | Promise<void>;
  }): Promise<GameLog>;
}

function mediaPath(args: string, command: string): string {
  const path = args.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  if (!path.trim()) throw new Error(`Usage: ${command} PATH`);
  return path;
}

function clock(seconds: number): string {
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Spectator commands: record footage into a durable game log. */
export function createSpectatorCommands(session: SpectatorCommandSession): ChatCommand[] {
  return [
    {
      name: '/record',
      description: 'Record a full game file into a durable game log',
      arguments: 'PATH',
      async run(args, context) {
        const path = mediaPath(args, '/record');
        context.setStatus('Recording game footage…');
        const log = await session.record(path, {
          duration: 'all',
          signal: context.signal,
          onProgress: (draft) =>
            context.setStatus(
              `Recorded through ${clock(draft.coverage.analyzedThrough)} / ${clock(draft.coverage.requestedEnd)}`,
            ),
        });
        context.signal.throwIfAborted();
        context.write(formatRecordingSummary(log));
        context.write(
          'Game log recorded in memory for this session. Ask questions about it, or use --output / enhance from the CLI to persist layers.',
        );
      },
    },
    {
      name: '/video',
      description: 'Quick sample: record the first two minutes',
      arguments: 'PATH',
      async run(args, context) {
        const path = mediaPath(args, '/video');
        const run = session.sample ?? session.record;
        context.setStatus('Recording sample (first 2 minutes)…');
        const log = await run(path, {
          duration: 120,
          signal: context.signal,
          onProgress: (draft) =>
            context.setStatus(
              `Recorded through ${clock(draft.coverage.analyzedThrough)} / ${clock(draft.coverage.requestedEnd)}`,
            ),
        });
        context.signal.throwIfAborted();
        context.write(formatRecordingSummary(log));
        context.write(
          'Sample only. Use /record PATH for a finished file, or /live with an OBS RTSP URL.',
        );
      },
    },
    {
      name: '/live',
      description: 'Live capture from OBS (LIVE_URL / RTSP) or demo. Runs until cancelled.',
      arguments: '[demo | rtsp://…]',
      async run(args, context) {
        if (!session.recordLive) throw new Error('Live capture is unavailable in this session');
        const target = args.trim();
        const fromEnv = resolveLiveUrl();
        if (!target && !fromEnv) {
          throw new Error('Usage: /live demo   or   /live rtsp://…   or set LIVE_URL in .env');
        }
        const isDemo = target === 'demo';
        const url = isDemo ? undefined : resolveLiveUrl(target || undefined);
        context.setStatus(
          isDemo ? 'Live demo capture… (cancel to stop)' : `Live stream ${url}… (cancel to stop)`,
        );
        const log = await session.recordLive({
          source: isDemo ? 'demo' : 'stream',
          url,
          signal: context.signal,
          onProgress: (draft) =>
            context.setStatus(
              `Live recorded through ${clock(draft.coverage.analyzedThrough)} (lag ~1 segment)`,
            ),
        });
        context.signal.throwIfAborted();
        context.write(formatRecordingSummary(log));
        context.write(
          'Live session ended. Ask about the recording, or /record a file for offline footage.',
        );
      },
    },
  ];
}

/** @deprecated Prefer createSpectatorCommands for the spectator path. */
export function createBaseballCommands(session: {
  readPhoto?(path: string, signal?: AbortSignal): Promise<unknown>;
  watchVideo?(path: string, options?: VideoOptions): Promise<unknown>;
  record?(path: string, options?: VideoOptions & { enhance?: boolean }): Promise<GameLog>;
}): ChatCommand[] {
  if (session.record) {
    return createSpectatorCommands({
      record: session.record.bind(session),
      sample: session.record.bind(session),
      recordLive:
        'recordLive' in session &&
        typeof (session as SpectatorCommandSession).recordLive === 'function'
          ? (session as SpectatorCommandSession).recordLive!.bind(session)
          : undefined,
    });
  }
  // Legacy stats-agent media commands (photo + raw JSON video).
  return [
    {
      name: '/photo',
      description: 'Read a scorebook photo and review its draft',
      arguments: 'PATH',
      async run(args, context) {
        if (!session.readPhoto) throw new Error('Photo reading is unavailable in this session');
        const path = mediaPath(args, '/photo');
        context.setStatus('Reading scorebook image…');
        const draft = await session.readPhoto(path, context.signal);
        context.signal.throwIfAborted();
        context.write(JSON.stringify(draft, null, 2));
        context.write(
          'Draft only; no stats saved. Review the values, then provide corrections or ask to save them.',
        );
      },
    },
    {
      name: '/video',
      description: 'Watch recorded footage and review plays',
      arguments: 'PATH',
      async run(args, context) {
        const path = mediaPath(args, '/video');
        if (!session.watchVideo) throw new Error('Video analysis is unavailable in this session');
        context.setStatus('Watching recorded game footage…');
        const draft = await session.watchVideo(path, {
          signal: context.signal,
          onProgress: (draft) =>
            context.setStatus(
              `Analyzed through ${draft.coverage.analyzedThrough.toFixed(1)}s / ${draft.coverage.requestedEnd.toFixed(1)}s`,
            ),
        });
        context.signal.throwIfAborted();
        context.write(JSON.stringify(draft, null, 2));
        context.write(
          'Draft plays only; no stats saved. Review timestamps, replays, identities, and missing coverage before entering game stats.',
        );
      },
    },
  ];
}

export type BaseballCommandSession = {
  readPhoto(path: string, signal?: AbortSignal): Promise<unknown>;
  watchVideo?(path: string, options?: VideoOptions): Promise<unknown>;
};
