import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type LiveCaptureSource = 'demo' | 'stream';

/** OBS-friendly live protocols (and SRT). Not http(s) VOD / MLB.TV pages. */
export function isLiveStreamUrl(url: string): boolean {
  return /^(rtsp|rtsps|rtmp|rtmps|srt):\/\//i.test(url.trim());
}

/**
 * Resolve a live stream URL: explicit arg wins, else LIVE_URL from the environment
 * (Bun loads agents/baseball/.env automatically when you `bun start` from that dir).
 */
export function resolveLiveUrl(explicit?: string | null): string | undefined {
  const fromExplicit = explicit?.trim();
  if (fromExplicit) return fromExplicit;
  const fromEnv = process.env.LIVE_URL?.trim();
  return fromEnv || undefined;
}

export type LiveCaptureOptions = {
  /**
   * demo = lavfi test pattern.
   * stream = pull RTSP/RTMP/SRT from OBS (or any compatible encoder).
   */
  source?: LiveCaptureSource;
  /** Required when source is stream — e.g. rtsp://127.0.0.1:8554/live */
  url?: string;
  /** Closed segment length in seconds (1–20). Default 5. */
  segmentSeconds?: number;
  /** Working directory for segment files. Created if missing. */
  directory?: string;
  signal?: AbortSignal;
};

export type LiveCapture = {
  readonly directory: string;
  readonly segmentSeconds: number;
  readonly source: LiveCaptureSource;
  readonly url?: string;
  /** Resolves when ffmpeg exits (after stop or failure). */
  readonly done: Promise<void>;
  stop(): Promise<void>;
};

function streamInputArgs(url: string): string[] {
  const trimmed = url.trim();
  if (!isLiveStreamUrl(trimmed)) {
    throw new Error(
      'Live stream URL must be rtsp://, rtmp://, or srt:// (OBS → spectator). Use --demo for a local test pattern.',
    );
  }
  const args = ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error'];
  if (/^rtsps?:\/\//i.test(trimmed)) {
    // TCP is far more reliable on Wi‑Fi sidelines than UDP.
    args.push('-rtsp_transport', 'tcp');
  }
  // Low latency; do not require a finished file.
  args.push('-fflags', 'nobuffer', '-flags', 'low_delay', '-i', trimmed);
  return args;
}

function buildCaptureArgs(options: {
  source: LiveCaptureSource;
  url?: string;
  segmentSeconds: number;
  directory: string;
}): string[] {
  const out = join(options.directory, 'seg_%05d.mp4');
  const encode = [
    '-an',
    '-sn',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-f',
    'segment',
    '-segment_time',
    String(options.segmentSeconds),
    '-reset_timestamps',
    '1',
    out,
  ];
  if (options.source === 'demo') {
    return [
      'ffmpeg',
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=10',
      ...encode,
    ];
  }
  if (!options.url) throw new Error('Live stream capture requires a URL');
  return [...streamInputArgs(options.url), ...encode];
}

/** List segment paths in order (seg_00000.mp4, …). */
export async function listSegments(directory: string): Promise<string[]> {
  const names = (await readdir(directory)).filter((name) => /^seg_\d{5}\.mp4$/.test(name)).sort();
  return names.map((name) => join(directory, name));
}

/** Wait until file size is unchanged across one poll interval (segment finalized). */
export async function waitForStableFile(
  path: string,
  signal?: AbortSignal,
  pollMs = 250,
): Promise<void> {
  let previous = -1;
  for (;;) {
    signal?.throwIfAborted();
    const info = await stat(path).catch(() => null);
    if (info && info.isFile() && info.size > 0 && info.size === previous) return;
    previous = info?.size ?? -1;
    await Bun.sleep(pollMs);
  }
}

/**
 * Start FFmpeg writing short mp4 segments from a demo pattern or OBS stream URL.
 * Call stop() or abort the signal; the child is always cleaned up.
 */
export async function startLiveCapture(options: LiveCaptureOptions = {}): Promise<LiveCapture> {
  options.signal?.throwIfAborted();
  const url = options.url?.trim();
  const source: LiveCaptureSource = options.source ?? (url ? 'stream' : 'demo');
  if (source === 'stream' && !url) {
    throw new Error(
      'Pass a stream URL (rtsp://… / rtmp://… / srt://…). Example: rtsp://127.0.0.1:8554/live',
    );
  }
  if (source === 'demo' && url) {
    throw new Error('Demo capture does not take a stream URL');
  }
  const segmentSeconds = options.segmentSeconds ?? 5;
  if (!Number.isFinite(segmentSeconds) || segmentSeconds < 1 || segmentSeconds > 20) {
    throw new Error('Live segment length must be 1–20 seconds');
  }
  const directory = options.directory ?? join(tmpdir(), `baseball-live-${crypto.randomUUID()}`);
  await mkdir(directory, { recursive: true });

  const args = buildCaptureArgs({
    source,
    url,
    segmentSeconds,
    directory,
  });

  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn(args, {
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'pipe',
    });
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw new Error(
      `Could not start ffmpeg for live capture. Install FFmpeg (ffmpeg and ffprobe).`,
      { cause: error },
    );
  }

  let stopping = false;
  const kill = () => {
    try {
      child.kill('SIGINT');
    } catch {
      /* already exited */
    }
  };

  const onAbort = () => {
    stopping = true;
    kill();
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) onAbort();

  const done = (async () => {
    const stderrChunks: Uint8Array[] = [];
    try {
      if (child.stderr) {
        for await (const chunk of child.stderr as ReadableStream<Uint8Array>) {
          stderrChunks.push(chunk);
          if (stderrChunks.reduce((n, c) => n + c.length, 0) > 64_000) break;
        }
      }
    } catch {
      /* ignore read errors on kill */
    }
    const code = await child.exited;
    options.signal?.removeEventListener('abort', onAbort);
    if (!stopping && code !== 0 && code !== null) {
      const stderr = Buffer.concat(stderrChunks).toString('utf8').slice(-1200);
      throw new Error(`Live capture failed (ffmpeg exit ${code})${stderr ? `: ${stderr}` : ''}`);
    }
  })();

  return {
    directory,
    segmentSeconds,
    source,
    ...(url ? { url } : {}),
    done,
    async stop() {
      stopping = true;
      kill();
      await Promise.race([done.catch(() => {}), Bun.sleep(1500)]);
      try {
        child.kill('SIGKILL');
      } catch {
        /* gone */
      }
      await done.catch(() => {});
    },
  };
}

/** Remove a live capture working directory (best-effort). */
export async function cleanupLiveCapture(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true }).catch(() => {});
}
