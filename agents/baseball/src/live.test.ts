import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatResponse, FakeChatModel } from '@di-framework/ai';
import { recordLive } from './live.ts';
import {
  isLiveStreamUrl,
  listSegments,
  resolveLiveUrl,
  startLiveCapture,
  waitForStableFile,
} from './live-capture.ts';

const directories: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'baseball-live-test-'));
  directories.push(path);
  return path;
}
afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});

const mediaTest = test.skipIf(!Bun.which('ffmpeg') || !Bun.which('ffprobe'));

mediaTest(
  'demo capture writes stable mp4 segments',
  async () => {
    const dir = await directory();
    const capture = await startLiveCapture({
      source: 'demo',
      segmentSeconds: 2,
      directory: dir,
    });
    try {
      const deadline = Date.now() + 15_000;
      let segments: string[] = [];
      while (Date.now() < deadline) {
        segments = await listSegments(dir);
        if (segments.length >= 2) break;
        await Bun.sleep(200);
      }
      expect(segments.length).toBeGreaterThanOrEqual(2);
      await waitForStableFile(segments[0]!);
      expect((await Bun.file(segments[0]!).arrayBuffer()).byteLength).toBeGreaterThan(0);
    } finally {
      await capture.stop();
    }
  },
  20_000,
);

mediaTest(
  'recordLive demo observes closed segments into a complete game log',
  async () => {
    const model = new FakeChatModel(() =>
      ChatResponse.of(
        JSON.stringify({
          scoreboard: null,
          scoreboardFrame: null,
          broadcast: 'unknown',
          events: [],
          warnings: ['synthetic live window'],
        }),
        { model: 'live-test' },
      ),
    );
    const checkpoints: number[] = [];
    const log = await recordLive(model, {
      source: 'demo',
      segmentSeconds: 2,
      fps: 1,
      maxSeconds: 5,
      onProgress: (progress) => {
        checkpoints.push(progress.coverage.analyzedThrough);
      },
    });
    expect(log.status).toBe('complete');
    expect(log.source).toContain('Live demo');
    expect(log.windows.length).toBeGreaterThanOrEqual(1);
    expect(log.coverage.analyzedThrough).toBeGreaterThan(0);
    expect(checkpoints.length).toBeGreaterThanOrEqual(1);
    expect(model.calls.length).toBeGreaterThanOrEqual(1);
  },
  45_000,
);

mediaTest(
  'recordLive stops on abort and still returns a log',
  async () => {
    const model = new FakeChatModel(() =>
      ChatResponse.of(
        JSON.stringify({
          scoreboard: null,
          scoreboardFrame: null,
          broadcast: 'unknown',
          events: [],
          warnings: [],
        }),
      ),
    );
    const controller = new AbortController();
    const run = recordLive(model, {
      source: 'demo',
      segmentSeconds: 2,
      fps: 0.5,
      signal: controller.signal,
      onProgress: () => {
        controller.abort();
      },
    });
    const log = await run;
    expect(log.status).toBe('complete');
    expect(log.windows.length).toBeGreaterThanOrEqual(1);
  },
  45_000,
);

test('rejects non-stream URLs', async () => {
  expect(isLiveStreamUrl('rtsp://127.0.0.1/live')).toBe(true);
  expect(isLiveStreamUrl('rtmp://127.0.0.1/live/obs')).toBe(true);
  expect(isLiveStreamUrl('srt://127.0.0.1:9000')).toBe(true);
  expect(isLiveStreamUrl('https://example.com/game.m3u8')).toBe(false);
  await expect(
    startLiveCapture({ source: 'stream', url: 'https://example.com/x' }),
  ).rejects.toThrow(/rtsp/);
  await expect(startLiveCapture({ source: 'stream' })).rejects.toThrow(/URL/);
});

test('resolveLiveUrl prefers explicit over LIVE_URL env', () => {
  const previous = process.env.LIVE_URL;
  process.env.LIVE_URL = 'rtsp://env.example/live';
  try {
    expect(resolveLiveUrl()).toBe('rtsp://env.example/live');
    expect(resolveLiveUrl('rtmp://override/live')).toBe('rtmp://override/live');
    expect(resolveLiveUrl('  ')).toBe('rtsp://env.example/live');
  } finally {
    if (previous === undefined) delete process.env.LIVE_URL;
    else process.env.LIVE_URL = previous;
  }
});
