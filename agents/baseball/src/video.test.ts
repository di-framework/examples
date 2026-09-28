import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatResponse, FakeChatModel } from '@di-framework/ai';
import { createBaseballAgent } from './agent.ts';
import { candidateCounts, observeFrames, watchVideo } from './video.ts';
import { extractFrames, inspectVideo, runMedia } from './video-frames.ts';
import type { VideoEvent, VideoObservation } from './video-schema.ts';

const directories: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'baseball-video-test-'));
  directories.push(path);
  return path;
}
afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});
const mediaTest = test.skipIf(!Bun.which('ffmpeg') || !Bun.which('ffprobe'));
async function fixture(duration = 2) {
  const path = join(await directory(), 'game with spaces.mp4');
  await runMedia([
    'ffmpeg',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=320x180:rate=10:duration=${duration}`,
    '-c:v',
    'mpeg4',
    path,
  ]);
  return path;
}
const frame = (time: number) => ({
  time,
  mimeType: 'image/jpeg',
  data: Buffer.from([255, 216, 255, 1]),
});
const scoreboard = {
  awayTeam: 'HOU',
  homeTeam: 'ATL',
  awayRuns: 1,
  homeRuns: 2,
  inning: 4,
  half: 'bottom' as const,
  outs: 1,
  balls: 0,
  strikes: 0,
  first: false,
  second: false,
  third: false,
};
function observation(): VideoObservation {
  return {
    scoreboard,
    scoreboardFrame: 2,
    broadcast: 'live',
    warnings: [],
    events: [
      {
        start: 0,
        end: 2,
        evidenceFrames: [0, 2],
        kind: 'home_run',
        presentation: 'live',
        batter: 'Olson',
        pitcher: 'Valdez',
        team: 'ATL',
        inning: 4,
        half: 'bottom',
        runsScored: 1,
        confidence: 'high',
        evidence: 'Ball clears the wall; score increases by one.',
        uncertainty: null,
        duplicateOf: null,
      },
    ],
  };
}
const inference = (result: unknown) =>
  new FakeChatModel(() => ChatResponse.of(JSON.stringify(result)));

test('video sends ordered images and timestamps, no tools, and bounded prior context', async () => {
  const model = new FakeChatModel((prompt) => {
    const system = prompt.messages.find((message) => message.messageType === 'system')!;
    expect(system.text).toContain('Sideline / parent-cam mode');
    expect(system.text).toContain('blue');
    const user = prompt.messages.find((message) => message.messageType === 'user')!;
    expect(user.text).toContain('[0,1,2]');
    expect(user.media.map((m) => m.data)).toEqual([frame(0).data, frame(1).data, frame(2).data]);
    expect(prompt.options?.outputSchema).toContain('duplicateOf');
    expect(prompt.options?.toolCallbacks).toBeUndefined();
    return ChatResponse.of(JSON.stringify(observation()), {
      model: 'test-vision',
    });
  });
  const result = await observeFrames(model, [frame(0), frame(1), frame(2)], 0, 3, [], undefined, {
    mode: 'sideline',
    priors: { teamColors: 'blue' },
  });
  expect(result.model).toBe('test-vision');
  expect(result.events[0]?.reviewRequired).toBe(true);
  expect(result.events[0]?.id).toBe('v0-1');
  expect(result.scoreboard?.homeRuns).toBe(2);
});

test('invalid timestamps, references, replay scoreboards, and malformed responses fail closed', async () => {
  const original = observation();
  const invalid: unknown[] = [
    { ...original, scoreboardFrame: 7 },
    { ...original, scoreboardFrame: null },
    { ...original, broadcast: 'replay' },
    { ...original, scoreboard: { ...scoreboard, outs: 9 } },
    ...[
      { start: -1 },
      { start: 2, end: 1 },
      { end: 3 },
      { evidenceFrames: [0, 1.5] },
      { duplicateOf: 'invented-event' },
      { evidenceFrames: [] },
    ].map((change) => ({
      ...original,
      events: [{ ...original.events[0], ...change }],
    })),
    { events: [] },
  ];
  for (const result of invalid)
    await expect(
      observeFrames(inference(result), [frame(0), frame(1), frame(2)], 0, 3),
    ).rejects.toThrow();
  await expect(
    observeFrames(new FakeChatModel(() => ChatResponse.of('not JSON')), [frame(0)], 0, 1),
  ).rejects.toThrow('valid JSON');
});

test('overlapping evidence is linked and replays/ambiguity never increment candidate counts', async () => {
  const result = await observeFrames(
    inference(observation()),
    [frame(0), frame(1), frame(2)],
    0,
    3,
  );
  const original = result.events[0]!;
  const repeated = {
    ...observation(),
    events: [{ ...observation().events[0]!, start: 1, evidenceFrames: [1, 2] }],
  };
  const overlap = await observeFrames(inference(repeated), [frame(1), frame(2)], 1, 3, [original]);
  expect(overlap.events[0]?.duplicateOf).toBe(original.id);
  const extras: VideoEvent[] = [
    {
      ...original,
      id: 'replay',
      presentation: 'replay',
      duplicateOf: original.id,
    },
    { ...original, id: 'uncertain', presentation: 'uncertain' },
    { ...original, id: 'low', confidence: 'low' },
    { ...original, id: 'unreadable', uncertainty: 'Ball landing unseen' },
  ];
  expect(candidateCounts([result, overlap, { ...result, events: extras }])).toEqual({
    home_run: 1,
  });
  const unresolved = { ...original, kind: 'pitch' as const };
  const resolved = { ...original, id: 'later', duplicateOf: unresolved.id };
  expect(candidateCounts([{ ...result, events: [unresolved, resolved] }])).toEqual({ home_run: 1 });
});

test('cancellation before video inference calls no model', async () => {
  const model = new FakeChatModel();
  await expect(observeFrames(model, [frame(0)], 0, 1, [], AbortSignal.abort())).rejects.toThrow();
  expect(model.calls).toHaveLength(0);
});

mediaTest(
  'actual decoder uses source PTS at a nonzero seek, carries bytes, and bounds windows',
  async () => {
    const path = await fixture();
    expect((await inspectVideo(path)).duration).toBe(2);
    const frames = await extractFrames(path, 0.25, 1, 2);
    expect(frames.map((f) => f.time)).toEqual([0.3, 0.8]);
    expect(frames[0]?.data.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
    await expect(extractFrames(path, 0, 21, 1)).rejects.toThrow('Invalid');
    await expect(extractFrames(path, 0, 1, 30)).rejects.toThrow('Invalid');
  },
);

mediaTest(
  'multiwindow video retains overlap, checkpoints coverage, and does not write stats',
  async () => {
    const path = await fixture(22);
    const model = new FakeChatModel((prompt) => {
      const user = prompt.messages[1]!;
      const times = JSON.parse(user.text!.split('timestamps:\n')[1]!.split('\n')[0]!) as number[];
      const second = times[0] === 16;
      if (second) expect(user.text).toContain('v0-1');
      return ChatResponse.of(
        JSON.stringify({
          ...observation(),
          scoreboardFrame: times.at(-1),
          events: [
            {
              ...observation().events[0],
              start: 18,
              end: 19,
              evidenceFrames: [18, 19],
              duplicateOf: second ? 'v0-1' : null,
            },
          ],
        }),
      );
    });
    const chat = new FakeChatModel((prompt) => {
      expect(JSON.stringify(prompt.messages)).toContain('Unverified video draft');
      expect(JSON.stringify(prompt.messages)).toContain('v0-1');
      return ChatResponse.of('Review the observed homer before recording any stats.');
    });
    const baseball = createBaseballAgent(chat, {
      visionModel: model,
      databasePath: ':memory:',
    });
    const checkpoints: number[] = [];
    try {
      const draft = await baseball.watchVideo(path, {
        duration: 'all',
        onProgress: (draft) => {
          checkpoints.push(draft.coverage.analyzedThrough);
        },
      });
      expect(checkpoints).toEqual([20, 22]);
      expect(draft.windows.map((window) => window.start)).toEqual([0, 16]);
      expect(draft.status).toBe('complete');
      expect(draft.candidateCounts).toEqual({ home_run: 1 });
      expect(draft.source).toMatch(/sampled-frame SHA-256 [a-f0-9]{64}$/);
      expect(chat.calls).toHaveLength(0);
      expect(baseball.store.listTeams()).toEqual([]);
      await baseball.agent.chat('What happened?');
      expect(baseball.store.listTeams()).toEqual([]);
    } finally {
      baseball.close();
    }
  },
  15_000,
);

mediaTest(
  'bad sources/options fail before inference, and cancellation stops between windows',
  async () => {
    const path = await fixture(22);
    const model = inference({
      scoreboard: null,
      scoreboardFrame: null,
      broadcast: 'unknown',
      events: [],
      warnings: [],
    });
    await expect(watchVideo(model, 'https://example.com/live.m3u8')).rejects.toThrow('local video');
    await expect(watchVideo(model, path, { start: 22 })).rejects.toThrow('before the end');
    await expect(watchVideo(model, path, { duration: -1 })).rejects.toThrow('duration');
    await expect(watchVideo(model, path, { fps: Infinity })).rejects.toThrow('fps');
    const fake = join(await directory(), 'fake.mp4');
    await writeFile(fake, 'not a video');
    await expect(watchVideo(model, fake)).rejects.toThrow('decoder failed');
    expect(model.calls).toHaveLength(0);
    const controller = new AbortController();
    const checkpoints: string[] = [];
    await expect(
      watchVideo(model, path, {
        duration: 'all',
        signal: controller.signal,
        onProgress: (draft) => {
          checkpoints.push(draft.status);
          controller.abort();
        },
      }),
    ).rejects.toThrow();
    expect(checkpoints).toEqual(['in_progress']);
    expect(model.calls).toHaveLength(1);
  },
  15_000,
);

mediaTest('decoder timeout terminates a stalled process', async () => {
  const before = performance.now();
  await expect(
    runMedia([process.execPath, '-e', 'setInterval(() => {}, 1000)'], undefined, 100),
  ).rejects.toThrow();
  expect(performance.now() - before).toBeLessThan(3000);
});

test('video CLI rejects output aliasing its input, preserves source, and rejects unrelated options', async () => {
  const path = join(await directory(), 'keep.mp4');
  await writeFile(path, 'unchanged');
  const run = async (args: string[]) => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'index.ts'), ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return {
      error: await new Response(child.stderr).text(),
      code: await child.exited,
    };
  };
  expect(await run(['--video', path, '--output', path])).toEqual({
    code: 1,
    error: 'Output must not overwrite the source video\n',
  });
  expect(await readFile(path, 'utf8')).toBe('unchanged');
  expect((await run(['--fps', '1'])).code).toBe(1);
});
