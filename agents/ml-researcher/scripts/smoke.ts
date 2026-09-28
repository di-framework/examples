import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ModelBuilder } from '../src/build.ts';
import { assertProcess } from '../src/process.ts';
import { ResearchRun } from '../src/repositories.ts';

const run = await ResearchRun.open({
  runsDir: resolve(import.meta.dir, '../runs'),
  repositories: {
    ml: {
      path: process.env.ML_REPO ?? resolve(import.meta.dir, '../../../../di-framework-ml'),
    },
    framework: { path: resolve(import.meta.dir, '../../../../di-framework') },
  },
});
console.log(`Synthetic smoke run: ${run.manifest.id}`);
const rows = Array.from({ length: 120 }, (_, i) => {
  const x = ((i % 12) - 5.5) / 6;
  const y = (Math.floor(i / 12) - 4.5) / 5;
  return { id: String(i), features: [x, y], label: Number(x + y > 0) };
});
await run.store.write('fixture.jsonl', rows.map((row) => JSON.stringify(row)).join('\n'));
const builder = new ModelBuilder(run);
const first = await builder.build({
  name: 'synthetic-classifier',
  task: 'classification',
  datasetPath: 'fixture.jsonl',
  datasetRevision: 'synthetic-grid-v1',
  source: { kind: 'mlp', hidden: [8] },
  inputSize: 2,
  outputSize: 1,
  outputEncoding: 'logits',
  maxSteps: 200,
  learningRates: [0.03],
  target: { metric: 'accuracy', value: 0.85 },
  budgetSeconds: 1200,
});
console.log(JSON.stringify(first, null, 2));
if (first.status !== 'target-met') throw new Error('Synthetic classification quality gate failed');
const adapted = await builder.build({
  name: 'synthetic-adaptation',
  task: 'classification',
  datasetPath: 'fixture.jsonl',
  datasetRevision: 'synthetic-grid-v1',
  source: { kind: 'pretrained', path: first.model, revision: first.modelHash },
  inputSize: 2,
  outputSize: 1,
  outputEncoding: 'logits',
  maxSteps: 20,
  learningRates: [0.005],
  target: { metric: 'accuracy', value: 0.85 },
  budgetSeconds: 1200,
});
console.log(JSON.stringify(adapted, null, 2));
if (adapted.status !== 'target-met') throw new Error('Synthetic adaptation quality gate failed');

// Exercise distinct label/loss paths as well as the exported inference script.
for (const task of ['classification', 'regression'] as const) {
  const multiclass = task === 'classification';
  const name = multiclass ? 'synthetic-multiclass' : 'synthetic-regression';
  await run.store.write(
    `${name}.jsonl`,
    rows
      .map((row) =>
        JSON.stringify({
          ...row,
          label: multiclass
            ? row.features[0]! < -0.3
              ? 0
              : row.features[0]! > 0.3
                ? 2
                : 1
            : row.features[0]! + 2 * row.features[1]!,
        }),
      )
      .join('\n'),
  );
  const report = await builder.build({
    name,
    task,
    datasetPath: `${name}.jsonl`,
    datasetRevision: 'synthetic-grid-v1',
    source: { kind: 'mlp', hidden: multiclass ? [8] : [] },
    inputSize: 2,
    outputSize: multiclass ? 3 : 1,
    outputEncoding: multiclass ? 'logits' : 'values',
    maxSteps: 200,
    learningRates: [0.03],
    target: {
      metric: multiclass ? 'accuracy' : 'mse',
      value: multiclass ? 0.8 : 0.05,
    },
    budgetSeconds: 1200,
  });
  if (report.status !== 'target-met')
    throw new Error(`${name} quality gate failed: ${report.test.value}`);
  const inference = await run.execute({
    command: process.execPath,
    args: [report.model.replace('model.onnx', 'infer.ts'), '[0.2,0.4]'],
    cwd: run.store.root,
  });
  if (inference.code !== 0) throw new Error(inference.stderr);
  console.log(
    `${name}: ${report.test.metric}=${report.test.value}; inference=${inference.stdout.trim()}`,
  );
}

// Verify pretrained token inputs, native InfoNCE training, pooling and exported inference.
await run.store.write(
  'native/examples/embedding-fixture.rs',
  await readFile(resolve(import.meta.dir, 'embedding-fixture.rs'), 'utf8'),
);
assertProcess(
  await run.execute({
    command: 'cargo',
    args: [
      'run',
      '--quiet',
      '--manifest-path',
      resolve(run.store.root, 'native/Cargo.toml'),
      '--example',
      'embedding-fixture',
      '--',
      resolve(run.store.root, 'embedding.onnx'),
    ],
    cwd: run.store.root,
    env: {
      CARGO_TARGET_DIR: resolve(import.meta.dir, '../.cache/native-target'),
    },
  }),
);
await run.store.write(
  'pairs.jsonl',
  Array.from({ length: 40 }, (_, i) =>
    JSON.stringify({
      id: `pair-${i}`,
      input_ids: [i, i + 1],
      positive: [i, i + 1],
    }),
  ).join('\n'),
);
const embedding = await builder.build({
  name: 'synthetic-embedding',
  task: 'embedding',
  datasetPath: 'pairs.jsonl',
  datasetRevision: 'synthetic-pairs-v1',
  source: {
    kind: 'pretrained',
    path: 'embedding.onnx',
    revision: 'synthetic-gather-v1',
  },
  inputName: 'input_ids',
  outputName: 'embedding',
  inputSize: 2,
  outputSize: 4,
  outputEncoding: 'embedding',
  pooling: 'mean',
  maxSteps: 5,
  learningRates: [0.001],
  target: { metric: 'recallAt1', value: 0.8 },
  budgetSeconds: 1200,
});
if (embedding.status !== 'target-met')
  throw new Error(`Embedding quality gate failed: ${embedding.test.value}`);
const example = assertProcess(
  await run.execute({
    command: process.execPath,
    args: [embedding.model.replace('model.onnx', 'infer.ts'), '[1,2]'],
    cwd: run.store.root,
  }),
);
const vector = JSON.parse(example.stdout).values;
if (vector.length !== 4 || Math.abs(Math.hypot(...vector) - 1) > 1e-6)
  throw new Error('Exported embedding normalization mismatch');
console.log(
  `synthetic-embedding: recallAt1=${embedding.test.value}; inference=${example.stdout.trim()}`,
);

console.log('Smoke checks passed. Synthetic data proves pipeline mechanics, not domain quality.');
