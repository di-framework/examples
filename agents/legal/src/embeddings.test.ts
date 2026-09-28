import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EmbeddingClient } from '../.agents/plugins/legal/mcp/embedding-client.ts';
import {
  ARTIFACTS,
  CourtListenerEmbedder,
  DIMENSIONS,
  MAX_LENGTH,
  MODEL,
  MODEL_REVISION,
  poolAndNormalize,
  QUERY_PREFIX,
  sha256,
  validateManifest,
} from '../.agents/plugins/legal/mcp/embeddings.ts';

test('masked pooling ignores padding and returns unit length vectors', () => {
  const hidden = new Float32Array(DIMENSIONS * 3);
  hidden[0] = 3;
  hidden[DIMENSIONS + 1] = 4;
  hidden[2 * DIMENSIONS] = 1e10;
  const vector = poolAndNormalize(hidden, [1, 3, DIMENSIONS], [1, 1, 0]);
  expect(vector[0]).toBeCloseTo(0.6);
  expect(vector[1]).toBeCloseTo(0.8);
  expect(Math.hypot(...vector)).toBeCloseTo(1);
  expect(() => poolAndNormalize(hidden, [1, 3, DIMENSIONS], [0, 0, 0])).toThrow('empty');
  expect(() => poolAndNormalize(hidden, [1, 2, DIMENSIONS], [1, 1, 0])).toThrow('shape');
  hidden[0] = NaN;
  expect(() => poolAndNormalize(hidden, [1, 3, DIMENSIONS], [1, 1, 0])).toThrow('finite');
});

test('bundle identity pins the vector space and the actual 8192 token limit', () => {
  const manifest = {
    model: MODEL,
    revision: MODEL_REVISION,
    dimensions: DIMENSIONS,
    maxLength: MAX_LENGTH,
    pooling: 'masked-mean',
    normalize: true,
    queryPrefix: QUERY_PREFIX,
    sha256: Object.fromEntries(ARTIFACTS.map((name) => [name, 'a'.repeat(64)])),
  };
  expect(() => validateManifest(manifest)).not.toThrow();
  for (const change of [
    { revision: 'main' },
    { model: 'another/embedder' },
    { maxLength: 512 },
    { queryPrefix: '' },
    { pooling: 'cls' },
    { normalize: false },
    { sha256: {} },
  ]) {
    expect(() => validateManifest({ ...manifest, ...change })).toThrow('Incompatible');
  }
});

test('unverified, stale, or damaged bundles fail before the ONNX runtime loads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'legal-onnx-'));
  try {
    await expect(CourtListenerEmbedder.load(directory)).rejects.toThrow('missing');
    const manifest = JSON.stringify({
      model: MODEL,
      revision: MODEL_REVISION,
      dimensions: DIMENSIONS,
      maxLength: MAX_LENGTH,
      pooling: 'masked-mean',
      normalize: true,
      queryPrefix: QUERY_PREFIX,
      sha256: Object.fromEntries(ARTIFACTS.map((name) => [name, 'a'.repeat(64)])),
    });
    await writeFile(join(directory, 'manifest.json'), manifest);
    await expect(CourtListenerEmbedder.load(directory)).rejects.toThrow('parity verification');
    await writeFile(
      join(directory, 'verified.json'),
      JSON.stringify({ passed: true, manifestSha256: 'old' }),
    );
    await expect(CourtListenerEmbedder.load(directory)).rejects.toThrow('stale');
    await writeFile(
      join(directory, 'verified.json'),
      JSON.stringify({ passed: true, manifestSha256: sha256(manifest) }),
    );
    await writeFile(join(directory, 'model.onnx'), 'wrong bytes');
    await expect(CourtListenerEmbedder.load(directory)).rejects.toThrow('checksum mismatch');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// A real Bun worker exercises message transfer, termination, reuse, and recovery without downloading weights.
const fixture = new URL('./fixtures/embedding-worker.ts', import.meta.url).href;
test('embedding worker reuses a session, preserves literal text, and recovers after cancellation', async () => {
  let spawned = 0;
  const client = new EmbeddingClient(() => {
    spawned++;
    return new Worker(fixture);
  });
  try {
    expect(await client.embed('$(literal) `quoted`')).toEqual([1, 19]);
    expect(await client.embed('second')).toEqual([2, 6]);
    expect(spawned).toBe(1);
    await expect(client.embed('hang', AbortSignal.timeout(50))).rejects.toThrow();
    expect(await client.embed('recovered')).toEqual([1, 9]);
    expect(spawned).toBe(2);
    const controller = new AbortController();
    controller.abort();
    await expect(client.embed('never run', controller.signal)).rejects.toThrow();
    expect(spawned).toBe(2);
  } finally {
    client.close();
  }
  await expect(client.embed('closed')).rejects.toThrow('closed');
});

test('queued embedding requests serialize and worker errors and timeouts recover', async () => {
  const client = new EmbeddingClient(() => new Worker(fixture), 500);
  try {
    expect(await Promise.all([client.embed('one'), client.embed('two')])).toEqual([
      [1, 3],
      [2, 3],
    ]);
    const failure = await client.embed('error').catch((error) => error);
    expect(failure.message).toBe('fixture failed');
    expect(await client.embed('okay')).toEqual([1, 4]);
    await expect(client.embed('hang')).rejects.toThrow();
    expect(await client.embed('okay')).toEqual([1, 4]);
  } finally {
    client.close();
  }
});

test('cancelling a queued request leaves the active request intact; close releases both', async () => {
  const client = new EmbeddingClient(() => new Worker(fixture));
  const active = client.embed('hang').catch((error) => error);
  const controller = new AbortController();
  const queued = client.embed('queued', controller.signal).catch((error) => error);
  controller.abort(new Error('queued cancelled'));
  expect((await queued).message).toBe('queued cancelled');
  client.close();
  expect((await active).message).toBe('Embedding client is closed');
});
