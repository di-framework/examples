import { afterEach, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ModelBuilder } from '../src/build.ts';
import type { ModelSpec } from '../src/spec.ts';
import { fixture } from './helpers.ts';

const temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});
const raw = {
  name: 'fixture',
  task: 'classification',
  datasetPath: 'rows.jsonl',
  datasetRevision: 'v1',
  source: { kind: 'mlp', hidden: [4] },
  inputSize: 2,
  outputSize: 1,
  outputEncoding: 'logits',
  learningRates: [0.01, 0.02],
  target: { metric: 'accuracy', value: 0.95 },
};

test('selects using validation only, reports unmet test targets, and never overwrites a build', async () => {
  const f = await fixture();
  temporary.push(f.root);
  await f.run.store.write(
    'rows.jsonl',
    Array.from({ length: 60 }, (_, i) =>
      JSON.stringify({ id: String(i), features: [i, i % 4], label: i % 2 }),
    ).join('\n'),
  );
  const measurements: { path: string; ids: string[] }[] = [];
  const builder = new ModelBuilder(f.run, {
    native: async (_run, request) => {
      if (request.action === 'inspect')
        return JSON.stringify({
          inputs: ['input'],
          outputs: ['output'],
          weights: ['W'],
        });
      if (request.action === 'build') await writeFile(String(request.path), 'initial');
      if (request.action === 'train') {
        await mkdir(join(String(request.path), 'dist'));
        await writeFile(join(String(request.path), 'dist/model.onnx'), 'trained');
      }
      return '{}';
    },
    evaluate: async (request) => {
      measurements.push({
        path: request.model,
        ids: request.rows.map((row) => row.id),
      });
      const index = measurements.length;
      return {
        metric: 'accuracy',
        value: [0.4, 0.9, 0.8, 0.7][index - 1]!,
        samples: request.rows.length,
        metrics: {},
      };
    },
  });
  const result = await builder.build(raw);
  expect(result.status).toBe('target-unmet');
  expect(result.selectedLearningRate).toBe(0.01);
  expect(measurements).toHaveLength(4);
  expect(measurements[0]!.ids).toEqual(measurements[2]!.ids);
  expect(measurements[3]!.ids.some((id) => measurements[0]!.ids.includes(id))).toBe(false);
  expect(await readFile(result.model, 'utf8')).toBe('trained');
  await expect(builder.build(raw)).rejects.toThrow();
});

test('unsupported ONNX preflight and malformed datasets produce failed artifacts before training', async () => {
  const f = await fixture();
  temporary.push(f.root);
  await f.run.store.write(
    'rows.jsonl',
    Array.from({ length: 60 }, (_, i) =>
      JSON.stringify({ id: String(i), features: [i, 0], label: i % 2 }),
    ).join('\n'),
  );
  let trains = 0;
  const builder = new ModelBuilder(f.run, {
    native: async (_run, request) => {
      if (request.action === 'build') {
        await writeFile(String(request.path), 'unsupported');
        return '{}';
      }
      if (request.action === 'train') trains++;
      throw new Error('unsupported ONNX ops: Conv');
    },
  });
  await expect(builder.build(raw)).rejects.toThrow('unsupported');
  expect(trains).toBe(0);
  expect(await f.run.store.read('models/fixture/status.json')).toContain('failed');
});

test('cancelled training retains status and never evaluates the test set', async () => {
  const f = await fixture();
  temporary.push(f.root);
  await f.run.store.write(
    'rows.jsonl',
    Array.from({ length: 60 }, (_, i) =>
      JSON.stringify({ id: String(i), features: [i, 0], label: i % 2 }),
    ).join('\n'),
  );
  const controller = new AbortController();
  let evaluations = 0;
  const builder = new ModelBuilder(f.run, {
    native: async (_run, request, signal) => {
      if (request.action === 'build') await writeFile(String(request.path), 'model');
      if (request.action === 'inspect')
        return JSON.stringify({
          inputs: ['input'],
          outputs: ['output'],
          weights: ['W'],
        });
      if (request.action === 'train') {
        controller.abort();
        signal!.throwIfAborted();
      }
      return '{}';
    },
    evaluate: async () => {
      evaluations++;
      return { metric: 'accuracy', value: 0.5, samples: 12, metrics: {} };
    },
  });
  await expect(builder.build(raw, controller.signal)).rejects.toThrow();
  expect(evaluations).toBe(1);
  expect(await f.run.store.read('models/fixture/status.json')).toContain('cancelled');
});
