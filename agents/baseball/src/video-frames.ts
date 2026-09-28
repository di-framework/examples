import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Bounded, cancellable subprocesses; file paths are argv values, never shell code. */
export async function runMedia(args: string[], signal?: AbortSignal, timeoutMs = 60_000) {
  const combined = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  combined.throwIfAborted();
  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn(args, {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch (error) {
    throw new Error(`Could not start ${args[0]}. Install FFmpeg (ffmpeg and ffprobe).`, {
      cause: error,
    });
  }
  const kill = () => child.kill('SIGKILL');
  combined.addEventListener('abort', kill, { once: true });
  if (combined.aborted) kill();
  const read = async (stream: ReadableStream<Uint8Array>) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        kill();
        throw new Error('Video decoder output exceeded 4 MiB');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  };
  try {
    const [stdout, stderr, code] = await Promise.all([
      read(child.stdout as ReadableStream<Uint8Array>),
      read(child.stderr as ReadableStream<Uint8Array>),
      child.exited,
    ]);
    combined.throwIfAborted();
    if (code !== 0) throw new Error(`Video decoder failed (${args[0]}): ${stderr.slice(-1200)}`);
    return { stdout, stderr };
  } finally {
    combined.removeEventListener('abort', kill);
    kill();
    await child.exited;
  }
}

export async function inspectVideo(input: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(input))
    throw new Error('Use a local video file; live streams and webpage URLs are not supported');
  const path = resolve(input);
  const info = await stat(path);
  if (!info.isFile() || info.size === 0) throw new Error('Choose a nonempty, regular video file');
  const { stdout } = await runMedia(
    [
      'ffprobe',
      '-v',
      'error',
      '-protocol_whitelist',
      'file',
      '-select_streams',
      'v:0',
      '-show_entries',
      'format=duration:stream=codec_type,width,height',
      '-of',
      'json',
      path,
    ],
    signal,
  );
  const parsed = JSON.parse(stdout);
  const duration = Number(parsed.format?.duration);
  if (
    !parsed.streams?.some((s: { codec_type: string }) => s.codec_type === 'video') ||
    !Number.isFinite(duration) ||
    duration <= 0
  )
    throw new Error('File must contain video with a known, positive duration');
  return { path, duration, bytes: info.size, modified: info.mtimeMs };
}

export type VideoFrame = { time: number; mimeType: string; data: Buffer };

/** Decode one bounded window, preserving selected source PTS rather than guessing frame times. */
export async function extractFrames(
  path: string,
  start: number,
  duration: number,
  fps: number,
  signal?: AbortSignal,
): Promise<VideoFrame[]> {
  if (
    ![start, duration, fps].every(Number.isFinite) ||
    start < 0 ||
    duration <= 0 ||
    duration > 20 ||
    fps < 0.5 ||
    fps > 2
  )
    throw new Error('Invalid video sampling window');
  const directory = await mkdtemp(join(tmpdir(), 'baseball-frames-'));
  try {
    const filter = `select='lt(t,${duration})*(isnan(prev_selected_t)+gte(t-prev_selected_t,${1 / fps - 0.00001}))',scale='min(1280,iw)':-2,showinfo`;
    const { stderr } = await runMedia(
      [
        'ffmpeg',
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'info',
        '-protocol_whitelist',
        'file',
        '-ss',
        String(start),
        '-i',
        path,
        '-t',
        String(duration),
        '-map',
        '0:v:0',
        '-an',
        '-sn',
        '-vf',
        filter,
        '-fps_mode',
        'vfr',
        '-frames:v',
        String(Math.ceil(duration * fps) + 1),
        '-q:v',
        '3',
        join(directory, '%04d.jpg'),
      ],
      signal,
    );
    const timestamps = [
      ...stderr.matchAll(
        /\[Parsed_showinfo_[^\]]*\]\s+n:\s*(\d+)\s+pts:\s*\S+\s+pts_time:([\d.e+-]+)/g,
      ),
    ];
    if (!timestamps.length || timestamps.length > Math.ceil(duration * fps) + 1)
      throw new Error('Video produced no usable timestamped frames');
    const frames: VideoFrame[] = [];
    let total = 0;
    for (const entry of timestamps) {
      signal?.throwIfAborted();
      const relative = Number(entry[2]);
      if (!Number.isFinite(relative) || relative < 0 || relative >= duration)
        throw new Error('Decoder returned an invalid frame timestamp');
      const data = await readFile(
        join(directory, `${String(Number(entry[1]) + 1).padStart(4, '0')}.jpg`),
      );
      total += data.length;
      if (total > 32 * 1024 * 1024) throw new Error('Video window images exceed 32 MiB');
      frames.push({
        time: Number((start + relative).toFixed(6)),
        mimeType: 'image/jpeg',
        data,
      });
    }
    return frames;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
