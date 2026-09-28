import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createChatModel } from '@di-framework/ai';
import { createBaseballAgent } from './agent.ts';
import { CodexVisionModel } from './codex-vision.ts';
import { applyEnhancers, summaryLayer } from './enhance.ts';
import { reportCsv } from './export.ts';
import { draftToGameLog, parseGameLog } from './game-log.ts';
import { runInteractive, runSpectatorInteractive } from './interactive.ts';
import { recordLive } from './live.ts';
import { resolveLiveUrl } from './live-capture.ts';
import { formatRecordingSummary } from './review.ts';
import { createBaseballSpectator } from './spectator.ts';
import { BaseballStore } from './store.ts';
import { watchVideo } from './video.ts';
import { readScorebook } from './vision.ts';

export { createBaseballAgent } from './agent.ts';
export { CodexVisionModel } from './codex-vision.ts';
export type { Enhancer } from './enhance.ts';
export {
  applyEnhancers,
  enhancer,
  summaryLayer,
} from './enhance.ts';
export { reportCsv } from './export.ts';
export type { GameLog, SpectatorPriors } from './game-log.ts';
export { draftToGameLog, parseGameLog } from './game-log.ts';
export type { LiveRecordOptions } from './live.ts';
export { recordLive } from './live.ts';
export { isLiveStreamUrl, resolveLiveUrl } from './live-capture.ts';
export { formatRecordingSummary } from './review.ts';
export { createBaseballSpectator } from './spectator.ts';
export { BaseballStore } from './store.ts';
export { watchVideo } from './video.ts';
export type { VideoDraft, VideoEvent } from './video-schema.ts';
export { readScorebook } from './vision.ts';

async function checkpointJson(output: string, value: unknown) {
  await mkdir(dirname(output), { recursive: true });
  const temporary = join(dirname(output), `.${basename(output)}.${crypto.randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
}

function numberOption(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  if (!value.trim() || !Number.isFinite(Number(value)))
    throw new Error('Video options must be finite numbers');
  return Number(value);
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      args: Bun.argv.slice(2),
      allowPositionals: false,
      options: {
        help: { type: 'boolean', short: 'h' },
        data: { type: 'string' },
        report: { type: 'string' },
        export: { type: 'string' },
        photo: { type: 'string' },
        video: { type: 'string' },
        record: { type: 'string' },
        live: { type: 'boolean' },
        demo: { type: 'boolean' },
        url: { type: 'string' },
        segment: { type: 'string' },
        'max-seconds': { type: 'string' },
        enhance: { type: 'string' },
        with: { type: 'string' },
        start: { type: 'string' },
        duration: { type: 'string' },
        fps: { type: 'string' },
        output: { type: 'string' },
        stats: { type: 'boolean' },
        mode: { type: 'string' },
      },
    });
    if (values.help) {
      console.log(`Usage: bun start
       bun start --live [--url rtsp://…] [--segment 5] [--max-seconds N]
                 [--fps 0.5..2] [--output live.json] [--mode sideline|broadcast]
       bun start --live --demo [--max-seconds N]   # lavfi test pattern, no OBS
       bun start --record path/to/game.mp4 [--output game.json] [--duration all|SECONDS]
                 [--start SECONDS] [--fps 0.5..2] [--mode sideline|broadcast]
       bun start --enhance path/to/game.json [--with summary] [--output game.json]
       bun start --video path/to/game.mp4   # short observer sample (default 120s)
       bun start --stats                    # legacy season-tracker chat
       bun start --photo|--report|--export  # legacy helpers

Spectator records observations into a durable game log (not a season book).
--live pulls an OBS RTSP/RTMP/SRT URL (LIVE_URL in .env, or --url) into short segments until Ctrl+C.
--record defaults to the full finished file. ffmpeg/ffprobe required. Codex sign-in for vision.
Add models later: bun start --enhance game.json --with summary`);
    } else {
      const mode = values.mode === 'broadcast' ? 'broadcast' : ('sideline' as const);
      if (values.mode && values.mode !== 'sideline' && values.mode !== 'broadcast')
        throw new Error('--mode must be "sideline" or "broadcast"');
      const exclusive = [
        values.report,
        values.export,
        values.photo,
        values.video,
        values.record,
        values.enhance,
        values.live ? true : undefined,
      ].filter((v) => v !== undefined);
      if (exclusive.length > 1)
        throw new Error(
          'Choose one of --live, --record, --enhance, --video, --photo, --report, or --export',
        );
      if (
        !values.video &&
        !values.record &&
        !values.live &&
        [values.start, values.duration, values.fps].some((v) => v !== undefined)
      )
        throw new Error(
          '--start/--duration require --record or --video; --fps also allowed with --live',
        );
      if (values.output && !values.video && !values.record && !values.enhance && !values.live)
        throw new Error('--output requires --live, --record, --video, or --enhance');
      if ((values.demo || values.url || values.segment || values['max-seconds']) && !values.live)
        throw new Error('--demo, --url, --segment, and --max-seconds require --live');
      if (values.live && !values.demo && !resolveLiveUrl(values.url))
        throw new Error('Live capture needs LIVE_URL in .env, --url rtsp://…, or --demo');

      const databasePath = resolve(
        values.data ?? resolve(import.meta.dir, '../data/baseball.sqlite'),
      );
      const teamId = values.report ?? values.export;

      if (values.live) {
        const output = values.output ? resolve(values.output) : undefined;
        const controller = new AbortController();
        const cancel = () => controller.abort();
        process.on('SIGINT', cancel);
        try {
          const log = await recordLive(new CodexVisionModel({ model: process.env.VISION_MODEL }), {
            source: values.demo ? 'demo' : 'stream',
            url: values.demo ? undefined : resolveLiveUrl(values.url),
            segmentSeconds: values.segment ? numberOption(values.segment, 5) : undefined,
            fps: values.fps ? numberOption(values.fps, 1) : undefined,
            maxSeconds: values['max-seconds'] ? numberOption(values['max-seconds'], 30) : undefined,
            mode,
            signal: controller.signal,
            onProgress: async (progress) => {
              if (output) await checkpointJson(output, progress);
              console.error(
                `Live recorded ${progress.coverage.analyzedThrough.toFixed(1)}s (Ctrl+C to stop)`,
              );
            },
          });
          if (output) await checkpointJson(output, log);
          console.log(formatRecordingSummary(log));
          if (!output) console.log(JSON.stringify(log, null, 2));
        } finally {
          process.off('SIGINT', cancel);
        }
      } else if (values.record) {
        const input = await realpath(values.record);
        const output = values.output ? resolve(values.output) : undefined;
        if (output && (await realpath(output).catch(() => output)) === input)
          throw new Error('Output must not overwrite the source video');
        const controller = new AbortController();
        const cancel = () => controller.abort();
        process.on('SIGINT', cancel);
        try {
          const vision = new CodexVisionModel({
            model: process.env.VISION_MODEL,
          });
          const result = await watchVideo(vision, input, {
            start: numberOption(values.start, 0),
            duration:
              values.duration === undefined || values.duration === 'all'
                ? 'all'
                : numberOption(values.duration, 120),
            fps: numberOption(values.fps, 1),
            mode,
            signal: controller.signal,
            onProgress: async (draft) => {
              const log = draftToGameLog(draft, { mode });
              if (output) await checkpointJson(output, log);
              console.error(
                `Recorded ${draft.coverage.analyzedThrough.toFixed(1)}s / ${draft.coverage.requestedEnd.toFixed(1)}s`,
              );
            },
          });
          const log = draftToGameLog(result, { mode });
          if (output) await checkpointJson(output, log);
          console.log(formatRecordingSummary(log));
          if (!output) console.log(JSON.stringify(log, null, 2));
        } finally {
          process.off('SIGINT', cancel);
        }
      } else if (values.enhance) {
        const path = resolve(values.enhance);
        const output = resolve(values.output ?? path);
        const withId = values.with ?? 'summary';
        if (withId !== 'summary') throw new Error('Supported --with values: "summary"');
        const log = parseGameLog(JSON.parse(await readFile(path, 'utf8')));
        const chat = createChatModel({
          provider: 'openai',
          auth: 'subscription',
        });
        const enhanced = await applyEnhancers(log, [summaryLayer(chat)]);
        await checkpointJson(output, enhanced);
        console.log(formatRecordingSummary(enhanced));
      } else if (values.video) {
        const input = await realpath(values.video);
        const output = values.output ? resolve(values.output) : undefined;
        if (output && (await realpath(output).catch(() => output)) === input)
          throw new Error('Output must not overwrite the source video');
        const controller = new AbortController();
        const cancel = () => controller.abort();
        process.on('SIGINT', cancel);
        try {
          const result = await watchVideo(
            new CodexVisionModel({ model: process.env.VISION_MODEL }),
            input,
            {
              start: numberOption(values.start, 0),
              duration: values.duration === 'all' ? 'all' : numberOption(values.duration, 120),
              fps: numberOption(values.fps, 1),
              mode,
              signal: controller.signal,
              onProgress: async (draft) => {
                if (output) await checkpointJson(output, draftToGameLog(draft, { mode }));
                console.error(
                  `Analyzed ${draft.coverage.analyzedThrough.toFixed(1)}s / ${draft.coverage.requestedEnd.toFixed(1)}s; draft plays require review.`,
                );
              },
            },
          );
          console.log(JSON.stringify(draftToGameLog(result, { mode }), null, 2));
        } finally {
          process.off('SIGINT', cancel);
        }
      } else if (values.photo) {
        const model = new CodexVisionModel({
          model: process.env.VISION_MODEL,
        });
        console.log(JSON.stringify(await readScorebook(model, values.photo), null, 2));
      } else if (teamId) {
        const store = new BaseballStore(databasePath);
        try {
          const report = store.report({ teamId, from: null, through: null });
          process.stdout.write(
            values.export ? reportCsv(report) : JSON.stringify(report, null, 2) + '\n',
          );
        } finally {
          store.close();
        }
      } else if (values.stats) {
        const baseball = createBaseballAgent(
          createChatModel({ provider: 'openai', auth: 'subscription' }),
          { databasePath },
        );
        try {
          await runInteractive(baseball);
        } finally {
          baseball.close();
        }
      } else {
        const chat = createChatModel({
          provider: 'openai',
          auth: 'subscription',
        });
        const spectator = createBaseballSpectator({
          chatModel: chat,
          visionModel: new CodexVisionModel({
            model: process.env.VISION_MODEL,
          }),
          priors: { mode },
          enhancers: [summaryLayer(chat)],
        });
        await runSpectatorInteractive({
          agent: spectator.agent,
          clearHistory: () => spectator.clearHistory(),
          record: (path, options) => spectator.record(path, options),
          sample: (path, options) =>
            spectator.record(path, {
              ...options,
              duration: options?.duration ?? 120,
            }),
          recordLive: (options) => spectator.recordLive(options),
        });
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
