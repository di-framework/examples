import { expect, test } from 'bun:test';
import { createTerminalModel } from '@di-framework/tui/core';
import { draftToGameLog } from './game-log.ts';
import {
  type BaseballSession,
  runInteractive,
  runSpectatorInteractive,
  type SpectatorSession,
} from './interactive.ts';
import type { VideoDraft } from './video-schema.ts';

function sampleLog(): ReturnType<typeof draftToGameLog> {
  const draft: VideoDraft = {
    source: 'Video clip.mp4',
    reviewRequired: true,
    status: 'complete',
    coverage: {
      start: 0,
      requestedEnd: 120,
      analyzedThrough: 30,
      videoDuration: 120,
      fps: 1,
    },
    windows: [],
    candidateCounts: {},
    warnings: ['Sample warning'],
  };
  return draftToGameLog(draft, { mode: 'sideline' });
}

test('spectator routes /record with progress and recording summary', async () => {
  const previous = process.env.LIVE_URL;
  process.env.LIVE_URL = 'rtsp://127.0.0.1:8554/from-env';
  try {
    const model = createTerminalModel();
    const calls: string[] = [];
    let cleared = 0;
    const session: SpectatorSession = {
      agent: {
        async chat(message) {
          calls.push(message);
          return { content: 'reply' };
        },
      },
      clearHistory() {
        cleared++;
      },
      async record(path, options) {
        calls.push(`record:${path}`);
        await options?.onProgress?.({
          coverage: { analyzedThrough: 30, requestedEnd: 120 },
        } as Parameters<NonNullable<NonNullable<typeof options>['onProgress']>>[0]);
        return sampleLog();
      },
      async recordLive(options) {
        calls.push(`live:${options?.url ?? options?.source ?? 'stream'}`);
        await options?.onProgress?.({
          coverage: { analyzedThrough: 12, requestedEnd: 12 },
        } as Parameters<NonNullable<NonNullable<typeof options>['onProgress']>>[0]);
        return sampleLog();
      },
    };
    const statuses: (string | null)[] = [];
    model.subscribe(() => {
      statuses.push(model.getSnapshot().status);
    });
    for (const line of [
      '/record "game clip.mp4"',
      '/video sample.mp4',
      '/live demo',
      '/live rtsp://127.0.0.1:8554/live',
      '/live',
      '/record',
      '/clear',
      '/exit',
    ])
      model.submit(line);
    await runSpectatorInteractive(session, model.terminal);
    expect(calls).toEqual([
      'record:game clip.mp4',
      'record:sample.mp4',
      'live:demo',
      'live:rtsp://127.0.0.1:8554/live',
      'live:rtsp://127.0.0.1:8554/from-env',
    ]);
    expect(cleared).toBe(1);
    expect(statuses.some((s) => s?.includes('Recorded through'))).toBe(true);
    expect(statuses.some((s) => s?.includes('Live recorded through'))).toBe(true);
    const text = model
      .getSnapshot()
      .messages.map((entry) => entry.content)
      .join('\n');
    expect(text).toContain('Game recording');
    expect(text).toContain('not official statistics');
    expect(text).toContain('Usage: /record PATH');
    expect(text).toContain('Sample only');
  } finally {
    if (previous === undefined) delete process.env.LIVE_URL;
    else process.env.LIVE_URL = previous;
  }
});

test('legacy stats session still routes /photo and /video JSON drafts', async () => {
  const model = createTerminalModel();
  const calls: string[] = [];
  const session: BaseballSession = {
    agent: {
      async chat(message) {
        calls.push(message);
        return { content: 'reply' };
      },
    },
    clearHistory() {},
    async readPhoto(path, signal) {
      calls.push(`photo:${path}`);
      expect(signal).toBeInstanceOf(AbortSignal);
      return { draft: 'photo' };
    },
    async watchVideo(path, options) {
      calls.push(`video:${path}`);
      await options?.onProgress?.({
        coverage: { analyzedThrough: 30, requestedEnd: 120 },
      } as Parameters<NonNullable<NonNullable<typeof options>['onProgress']>>[0]);
      return { draft: 'video' };
    },
  };
  for (const line of ['/photo "score book.jpg"', "/video 'game clip.mp4'", '/exit'])
    model.submit(line);
  await runInteractive(session, model.terminal);
  expect(calls).toEqual(['photo:score book.jpg', 'video:game clip.mp4']);
  const text = model
    .getSnapshot()
    .messages.map((entry) => entry.content)
    .join('\n');
  expect(text).toContain('Draft only; no stats saved.');
  expect(text).toContain('Draft plays only; no stats saved.');
});

test('cancelled spectator record suppresses partial output', async () => {
  const model = createTerminalModel();
  for (const line of ['/record game.mp4', 'continue', '/exit']) model.submit(line);
  await runSpectatorInteractive(
    {
      agent: {
        async chat() {
          return { content: 'continued' };
        },
      },
      clearHistory() {},
      async record(_, options) {
        model.interrupt();
        expect(options?.signal?.aborted).toBe(true);
        return sampleLog();
      },
    },
    model.terminal,
  );
  const text = model
    .getSnapshot()
    .messages.map((entry) => entry.content)
    .join('\n');
  expect(text).toContain('Cancelled');
  expect(text).not.toContain('Game recording (complete)');
  expect(text).toContain('continued');
});
