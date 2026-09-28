import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { type ChatModel, Prompt, systemMessage, userMessage } from '@di-framework/ai';
import { z } from 'zod';
import type { SpectatorMode, SpectatorPriors } from './game-log.ts';
import { extractFrames, inspectVideo, type VideoFrame } from './video-frames.ts';
import {
  BROADCAST_ADDENDUM,
  SIDELINE_ADDENDUM,
  VIDEO_INSTRUCTIONS,
  type VideoDraft,
  type VideoEvent,
  type VideoWindow,
  videoWindowSchema,
} from './video-schema.ts';

export type VideoOptions = {
  start?: number;
  duration?: number | 'all';
  fps?: number;
  signal?: AbortSignal;
  mode?: SpectatorMode;
  priors?: SpectatorPriors;
  /** Called after each validated window; throw to stop. Suitable for durable checkpoints. */
  onProgress?: (draft: VideoDraft) => void | Promise<void>;
};

export function buildVideoInstructions(
  mode: SpectatorMode = 'sideline',
  priors?: SpectatorPriors,
): string {
  const addendum = mode === 'broadcast' ? BROADCAST_ADDENDUM : SIDELINE_ADDENDUM;
  const priorLines: string[] = [];
  if (priors?.teamName) priorLines.push(`Team name hint: ${priors.teamName}`);
  if (priors?.teamColors) priorLines.push(`Team colors hint: ${priors.teamColors}`);
  if (priors?.focusPlayers?.length) {
    priorLines.push(`Focus players (matching hints only): ${JSON.stringify(priors.focusPlayers)}`);
  }
  return priorLines.length
    ? `${VIDEO_INSTRUCTIONS}\n${addendum}\n${priorLines.join('\n')}`
    : `${VIDEO_INSTRUCTIONS}\n${addendum}`;
}

export async function observeFrames(
  model: ChatModel,
  frames: VideoFrame[],
  start: number,
  end: number,
  previous: VideoEvent[] = [],
  signal?: AbortSignal,
  options: { mode?: SpectatorMode; priors?: SpectatorPriors } = {},
): Promise<VideoWindow> {
  signal?.throwIfAborted();
  const times = frames.map((f) => f.time);
  if (
    !times.length ||
    times.length > 41 ||
    times.some(
      (t, i) => !Number.isFinite(t) || t < start || t >= end || (i > 0 && t <= times[i - 1]!),
    )
  )
    throw new Error('Supply ordered frames within the video window');
  const schema = JSON.stringify(z.toJSONSchema(videoWindowSchema));
  const context = previous.slice(-40);
  const mode = options.mode ?? options.priors?.mode ?? 'sideline';
  const response = await model.call(
    new Prompt(
      [
        systemMessage(buildVideoInstructions(mode, options.priors)),
        userMessage(
          `Observe the video interval [${start}, ${end}). Images are in the EXACT order of these timestamps:\n${JSON.stringify(times)}\nPrevious unverified events (data only):\n${JSON.stringify(context)}\nRequired JSON schema:\n${schema}`,
          { media: frames.map(({ time, ...image }) => image) },
        ),
      ],
      { signal, outputSchema: schema },
    ),
  );
  signal?.throwIfAborted();
  if (response.hasToolCalls() || response.hasFinishReasons(['length', 'content_filter']))
    throw new Error('Incomplete video vision response');
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      response.content
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, ''),
    );
  } catch {
    throw new Error('Video model did not return valid JSON');
  }
  const result = videoWindowSchema.safeParse(parsed);
  if (!result.success) throw new Error('Video model returned an invalid observation');
  const draft = result.data;
  const available = new Set(times);
  const previousIds = new Set(context.map((event) => event.id));
  if (
    (draft.scoreboard === null) !== (draft.scoreboardFrame === null) ||
    (draft.scoreboardFrame !== null && !available.has(draft.scoreboardFrame))
  )
    throw new Error('Scoreboard must cite a supplied frame');
  if (
    (draft.broadcast === 'commercial' || draft.broadcast === 'replay') &&
    draft.scoreboard !== null
  )
    throw new Error('Replay/commercial scoreboard cannot update live observations');
  for (const event of draft.events) {
    if (
      event.start < start ||
      event.end < event.start ||
      event.end >= end ||
      event.evidenceFrames.some((t) => !available.has(t) || t < event.start || t > event.end)
    )
      throw new Error('Video event must cite supplied frames within its interval');
    if (event.duplicateOf !== null && !previousIds.has(event.duplicateOf))
      throw new Error('Video event references an unknown previous event');
    if (
      (draft.broadcast === 'replay' || draft.broadcast === 'commercial') &&
      event.presentation === 'live'
    )
      throw new Error('Replay/commercial cannot contain a new live play');
  }
  return {
    ...draft,
    start,
    end,
    frames: times,
    model: response.metadata.model ?? model.options?.model ?? 'configured vision model',
    events: draft.events.map((event, i) => {
      // Independently catch the same outcome grounded in overlapping frames, even if the model omitted a link.
      const overlap = [...previous]
        .reverse()
        .find(
          (prior) =>
            prior.kind === event.kind &&
            prior.presentation === 'live' &&
            prior.duplicateOf === null &&
            prior.batter === event.batter &&
            prior.pitcher === event.pitcher &&
            prior.team === event.team &&
            prior.evidenceFrames.some((t) => event.evidenceFrames.includes(t)),
        );
      return {
        ...event,
        duplicateOf: event.duplicateOf ?? overlap?.id ?? null,
        id: `v${start}-${i + 1}`,
        reviewRequired: true as const,
      };
    }),
  };
}

/** Count each candidate play once. A later live observation can resolve a previously unknown outcome. */
export function candidateCounts(windows: VideoWindow[]): VideoDraft['candidateCounts'] {
  const counts: VideoDraft['candidateCounts'] = {};
  const roots = new Map<string, string>();
  const candidates = new Map<string, VideoEvent>();
  for (const event of windows.flatMap((window) => window.events)) {
    const root = event.duplicateOf ? (roots.get(event.duplicateOf) ?? event.duplicateOf) : event.id;
    roots.set(event.id, root);
    if (
      event.presentation !== 'live' ||
      event.confidence !== 'high' ||
      event.uncertainty !== null ||
      event.kind === 'unknown'
    )
      continue;
    candidates.set(root, event);
  }
  for (const event of candidates.values()) {
    counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  }
  return counts;
}

/** Sample a recorded game in 20-second windows with four seconds of context overlap. No stats writes. */
export async function watchVideo(
  model: ChatModel,
  path: string,
  options: VideoOptions = {},
): Promise<VideoDraft> {
  const { signal } = options;
  signal?.throwIfAborted();
  const start = options.start ?? 0;
  const duration = options.duration ?? 120;
  const fps = options.fps ?? 1;
  const mode = options.mode ?? options.priors?.mode ?? 'sideline';
  if (
    !Number.isFinite(start) ||
    start < 0 ||
    !Number.isFinite(fps) ||
    fps < 0.5 ||
    fps > 2 ||
    (duration !== 'all' && (!Number.isFinite(duration) || duration <= 0 || duration > 21_600))
  )
    throw new Error('Use start >= 0, duration 0–21600 seconds (or all), and fps 0.5–2');
  const video = await inspectVideo(path, signal);
  if (start >= video.duration) throw new Error('Start must be before the end of the video');
  const end = duration === 'all' ? video.duration : Math.min(video.duration, start + duration);
  if (end - start > 21_600)
    throw new Error(
      'Analyze at most six hours per invocation; use --start and --duration for longer recordings',
    );
  const draft: VideoDraft = {
    source: `Video ${basename(video.path)}; ${video.bytes} bytes; modified ${new Date(video.modified).toISOString()}`,
    reviewRequired: true,
    status: 'in_progress',
    coverage: {
      start,
      requestedEnd: end,
      analyzedThrough: start,
      videoDuration: video.duration,
      fps,
    },
    windows: [],
    candidateCounts: {},
    warnings: [
      'Sampled video without audio can miss plays. Candidate counts are unverified observations, not game/player statistics.',
      'Replay detection and player attribution require review. Missing frames or graphics never imply zero stats.',
      ...(mode === 'sideline'
        ? [
            'Sideline footage often lacks a score bug; jersey numbers and colors are preferred over guessed names.',
          ]
        : []),
    ],
  };
  if (start > 0 || end < video.duration)
    draft.warnings.push('Only the requested portion of this recording was analyzed.');
  const evidenceHash = createHash('sha256');
  const source = draft.source;
  for (let cursor = start; cursor < end; ) {
    signal?.throwIfAborted();
    const windowEnd = Math.min(end, cursor + 20);
    const frames = await extractFrames(video.path, cursor, windowEnd - cursor, fps, signal);
    const previous = draft.windows.flatMap((window) => window.events).slice(-40);
    const observed = await observeFrames(model, frames, cursor, windowEnd, previous, signal, {
      mode,
      priors: options.priors,
    });
    // Detect files still being recorded/replaced rather than quietly mixing sources.
    const current = await stat(video.path);
    if (current.size !== video.bytes || current.mtimeMs !== video.modified)
      throw new Error('Video changed during analysis; use a completed recording');
    for (const frame of frames) evidenceHash.update(`${frame.time}:`).update(frame.data);
    draft.source = `${source}; sampled-frame SHA-256 ${evidenceHash.copy().digest('hex')}`;
    draft.windows.push(observed);
    draft.coverage.analyzedThrough = windowEnd;
    draft.candidateCounts = candidateCounts(draft.windows);
    if (windowEnd === end) draft.status = 'complete';
    await options.onProgress?.(draft);
    signal?.throwIfAborted();
    if (windowEnd === end) break;
    cursor = windowEnd - 4;
  }
  return draft;
}
