import { createHash } from 'node:crypto';
import type { ChatModel } from '@di-framework/ai';
import {
  draftToGameLog,
  type GameLog,
  type SpectatorMode,
  type SpectatorPriors,
} from './game-log.ts';
import {
  cleanupLiveCapture,
  type LiveCaptureSource,
  listSegments,
  resolveLiveUrl,
  startLiveCapture,
  waitForStableFile,
} from './live-capture.ts';
import { candidateCounts, observeFrames } from './video.ts';
import { extractFrames, inspectVideo } from './video-frames.ts';
import type { VideoDraft, VideoEvent } from './video-schema.ts';

export type LiveRecordOptions = {
  source?: LiveCaptureSource;
  /** OBS (or other) stream URL: rtsp://, rtmp://, or srt:// */
  url?: string;
  /** Segment length seconds (1–20). Default 5. */
  segmentSeconds?: number;
  /** Sample rate inside each segment. Default 1. */
  fps?: number;
  /** Stop after this many seconds of observed timeline (demos/tests). */
  maxSeconds?: number;
  /** Keep segment files after stop. Default false. */
  keepSegments?: boolean;
  directory?: string;
  mode?: SpectatorMode;
  priors?: SpectatorPriors;
  signal?: AbortSignal;
  onProgress?: (log: GameLog) => void | Promise<void>;
};

/**
 * Capture live video as short segments and observe each closed segment into a GameLog.
 * Abort the signal (or hit maxSeconds) to stop; remaining finalized segments are drained.
 */
export async function recordLive(
  model: ChatModel,
  options: LiveRecordOptions = {},
): Promise<GameLog> {
  const fps = options.fps ?? 1;
  const mode = options.mode ?? options.priors?.mode ?? 'sideline';
  const maxSeconds = options.maxSeconds;
  if (
    maxSeconds !== undefined &&
    (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 21_600)
  ) {
    throw new Error('Live maxSeconds must be in (0, 21600] when set');
  }
  if (!Number.isFinite(fps) || fps < 0.5 || fps > 2) {
    throw new Error('Use fps 0.5–2');
  }

  const url = resolveLiveUrl(options.url);
  const capture = await startLiveCapture({
    source: options.source ?? (url ? 'stream' : undefined),
    url,
    segmentSeconds: options.segmentSeconds,
    directory: options.directory,
    signal: options.signal,
  });

  const draft: VideoDraft = {
    source: capture.url
      ? `Live stream ${capture.url}; segments in ${capture.directory}`
      : `Live ${capture.source} capture; segments in ${capture.directory}`,
    reviewRequired: true,
    status: 'in_progress',
    coverage: {
      start: 0,
      requestedEnd: maxSeconds ?? 0,
      analyzedThrough: 0,
      videoDuration: 0,
      fps,
    },
    windows: [],
    candidateCounts: {},
    warnings: [
      'Live capture pulls an OBS (or compatible) RTSP/RTMP/SRT stream into short segments; analysis lags by about one segment.',
      'Sampled video without audio can miss plays. Observations are not official statistics.',
      ...(mode === 'sideline'
        ? [
            'Sideline footage often lacks a score bug; jersey numbers and colors are preferred over guessed names.',
          ]
        : []),
    ],
  };

  const evidenceHash = createHash('sha256');
  let sessionOffset = 0;
  let nextIndex = 0;
  let stopRequested = false;

  const requestStop = async () => {
    if (stopRequested) return;
    stopRequested = true;
    await capture.stop();
  };

  const publish = async () => {
    if (maxSeconds === undefined) {
      draft.coverage.requestedEnd = Math.max(
        draft.coverage.requestedEnd,
        draft.coverage.analyzedThrough,
      );
    }
    const log = draftToGameLog(draft, { mode, priors: options.priors });
    await options.onProgress?.(log);
    return log;
  };

  const observeSegment = async (path: string) => {
    options.signal?.throwIfAborted();
    await waitForStableFile(path, options.signal);
    const info = await inspectVideo(path, options.signal);
    const duration = Math.min(info.duration, 20);
    if (duration <= 0.05) return;
    const windowStart = sessionOffset;
    const localFrames = await extractFrames(path, 0, duration, fps, options.signal);
    const frames = localFrames.map((frame) => ({
      ...frame,
      time: Number((windowStart + frame.time).toFixed(6)),
    }));
    if (!frames.length) {
      sessionOffset = windowStart + duration;
      return;
    }
    const end = Math.max(windowStart + duration, frames.at(-1)!.time + 0.001);
    const previous: VideoEvent[] = draft.windows.flatMap((window) => window.events).slice(-40);
    const observed = await observeFrames(
      model,
      frames,
      windowStart,
      end,
      previous,
      options.signal,
      { mode, priors: options.priors },
    );
    for (const frame of frames) evidenceHash.update(`${frame.time}:`).update(frame.data);
    draft.windows.push(observed);
    draft.coverage.analyzedThrough = end;
    draft.coverage.videoDuration = end;
    draft.candidateCounts = candidateCounts(draft.windows);
    draft.source = capture.url
      ? `Live stream ${capture.url}; segments in ${capture.directory}; ` +
        `sampled-frame SHA-256 ${evidenceHash.copy().digest('hex')}`
      : `Live ${capture.source} capture; segments in ${capture.directory}; ` +
        `sampled-frame SHA-256 ${evidenceHash.copy().digest('hex')}`;
    sessionOffset = end;
    await publish();
  };

  try {
    while (true) {
      if (options.signal?.aborted) await requestStop();
      if (maxSeconds !== undefined && sessionOffset >= maxSeconds) {
        await requestStop();
      }

      const segments = await listSegments(capture.directory);
      const captureExited = stopRequested;

      while (nextIndex < segments.length) {
        const ready = nextIndex + 1 < segments.length || captureExited;
        if (!ready) break;
        await observeSegment(segments[nextIndex]!);
        nextIndex += 1;
        if (maxSeconds !== undefined && sessionOffset >= maxSeconds) {
          await requestStop();
          break;
        }
      }

      if (stopRequested) {
        await capture.done.catch(() => {});
        const finalSegments = await listSegments(capture.directory);
        while (nextIndex < finalSegments.length) {
          if (options.signal?.aborted) break;
          if (maxSeconds !== undefined && sessionOffset >= maxSeconds) break;
          try {
            await observeSegment(finalSegments[nextIndex]!);
          } catch (error) {
            if (options.signal?.aborted) break;
            throw error;
          }
          nextIndex += 1;
        }
        break;
      }

      await Bun.sleep(200);
    }

    draft.status = 'complete';
    if (maxSeconds === undefined) {
      draft.coverage.requestedEnd = draft.coverage.analyzedThrough;
    } else {
      draft.coverage.requestedEnd = maxSeconds;
    }
    return await publish();
  } catch (error) {
    // Ctrl+C / cancel: keep whatever segments were already observed.
    if (options.signal?.aborted) {
      draft.status = 'complete';
      draft.coverage.requestedEnd = maxSeconds ?? draft.coverage.analyzedThrough;
      return await publish();
    }
    throw error;
  } finally {
    await capture.stop().catch(() => {});
    if (!options.keepSegments) await cleanupLiveCapture(capture.directory);
  }
}
