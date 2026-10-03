import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { type PoseSample, parseOpenPoseDocument } from './body.ts';
import type { DiamondCalibration } from './measure.ts';

const pointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

const calibrationSchema = z.object({
  image: z.object({
    home: pointSchema,
    first: pointSchema,
    second: pointSchema,
    third: pointSchema,
  }),
});

const manifestSchema = z.array(
  z.object({
    file: z.string().min(1),
    time: z.number().finite().nonnegative(),
  }),
);

export function parseCalibration(value: unknown): DiamondCalibration {
  const parsed = calibrationSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      'Calibration must map image points { x, y } for home, first, second, and third',
    );
  return parsed.data;
}

/**
 * Load OpenPose JSON for one clip.
 * Prefer `times.json` entries `{ "file", "time" }`. Otherwise filenames like `1.5_keypoints.json`.
 */
export async function loadPoseDirectory(directory: string): Promise<PoseSample[]> {
  const root = resolve(directory);
  const info = await stat(root).catch(() => {
    throw new Error('Pose directory is missing');
  });
  if (!info.isDirectory()) throw new Error('Pose directory is missing');
  const manifestPath = join(root, 'times.json');
  const hasManifest = await stat(manifestPath)
    .then((file) => file.isFile())
    .catch(() => false);
  let entries: { file: string; time: number }[];
  if (hasManifest) {
    const parsed = manifestSchema.safeParse(JSON.parse(await readFile(manifestPath, 'utf8')));
    if (!parsed.success) throw new Error('times.json must list { file, time } entries');
    entries = parsed.data;
  } else {
    const names = await readdir(root);
    entries = names.flatMap((name) => {
      const match = /^(\d+(?:\.\d+)?)_keypoints\.json$/.exec(name);
      return match ? [{ file: name, time: Number(match[1]) }] : [];
    });
  }
  if (!entries.length) throw new Error('Pose directory has no OpenPose JSON frames');
  const samples: PoseSample[] = [];
  for (const entry of [...entries].sort((a, b) => a.time - b.time)) {
    const path = resolve(root, entry.file);
    if (path !== root && !path.startsWith(root + sep))
      throw new Error('Pose manifest file must stay inside the pose directory');
    const people = parseOpenPoseDocument(JSON.parse(await readFile(path, 'utf8')));
    samples.push({ time: entry.time, people });
  }
  return samples;
}

/** Run the OpenPose binary on a directory of frames. Writes BODY_25 JSON beside the images' names. */
export async function runOpenPose(options: {
  imageDirectory: string;
  outputDirectory: string;
  bin?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  extraArgs?: string[];
}) {
  const bin = options.bin ?? process.env.OPENPOSE_BIN ?? 'openpose';
  const imageDirectory = resolve(options.imageDirectory);
  const outputDirectory = resolve(options.outputDirectory);
  const images = await stat(imageDirectory).catch(() => {
    throw new Error('OpenPose image directory is missing');
  });
  if (!images.isDirectory()) throw new Error('OpenPose image directory is missing');
  await mkdir(outputDirectory, { recursive: true });
  const args = [
    bin,
    '--image_dir',
    imageDirectory,
    '--write_json',
    outputDirectory,
    '--display',
    '0',
    '--render_pose',
    '0',
    '--model_pose',
    'BODY_25',
    ...(options.extraArgs ?? []),
  ];
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  const combined = AbortSignal.any([
    AbortSignal.timeout(timeoutMs),
    ...(options.signal ? [options.signal] : []),
  ]);
  combined.throwIfAborted();
  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn(args, { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' });
  } catch (error) {
    throw new Error(`Could not start ${bin}. Install OpenPose and set OPENPOSE_BIN.`, {
      cause: error,
    });
  }
  const kill = () => child.kill('SIGKILL');
  combined.addEventListener('abort', kill, { once: true });
  if (combined.aborted) kill();
  try {
    const stderr = await readCapped(child.stderr as ReadableStream<Uint8Array>, kill);
    const code = await child.exited;
    combined.throwIfAborted();
    if (code !== 0)
      throw new Error(`OpenPose failed (${bin}): ${stderr.trim().slice(-1200) || `exit ${code}`}`);
  } finally {
    combined.removeEventListener('abort', kill);
    kill();
    await child.exited;
  }
}

async function readCapped(stream: ReadableStream<Uint8Array>, kill: () => void) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) {
      kill();
      throw new Error('OpenPose log exceeded 2 MiB');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
