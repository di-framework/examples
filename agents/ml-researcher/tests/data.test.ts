import { expect, test } from 'bun:test';
import { parseDataset, prepareData, trainingRows } from '../src/data.ts';
import { evaluate, poolEmbedding } from '../src/evaluate.ts';
import { modelSpecSchema } from '../src/spec.ts';

const spec = modelSpecSchema.parse({
  name: 'fixture',
  task: 'classification',
  datasetPath: 'data.jsonl',
  datasetRevision: 'test',
  source: { kind: 'mlp', hidden: [4] },
  inputSize: 2,
  outputSize: 1,
  outputEncoding: 'logits',
  standardize: true,
  target: { metric: 'accuracy', value: 0.8 },
});
const rows = Array.from({ length: 60 }, (_, i) => ({
  id: String(i),
  features: [i, i % 7],
  label: i % 2,
}));

test('splits are deterministic, disjoint, duplicate-grouped, and fit preprocessing on training only', () => {
  const input = [...rows, { ...rows[0]!, id: 'duplicate' }];
  const first = prepareData(input, spec);
  expect(
    prepareData([...input].reverse(), spec)
      .split.train.slice()
      .sort(),
  ).toEqual(first.split.train.slice().sort());
  expect(new Set([...first.split.train, ...first.split.validation, ...first.split.test]).size).toBe(
    input.length,
  );
  const group = [first.train, first.validation, first.test].find((split) =>
    split.some((row) => row.id === '0'),
  )!;
  expect(group.some((row) => row.id === 'duplicate')).toBe(true);
  expect(first.preprocessing.mean[0]).toBeCloseTo(
    first.train.reduce((sum, row) => sum + row.features![0]!, 0) / first.train.length,
  );
  expect(trainingRows(first.train, spec, first.preprocessing)).not.toContain('duplicate');
});

test('invalid labels, duplicate IDs, nonfinite features, unsupported specs fail before execution', () => {
  expect(() => parseDataset(rows.map((row) => JSON.stringify(row)).join('\n'), spec)).not.toThrow();
  for (const invalid of [
    { ...rows[0], label: undefined },
    { ...rows[0], label: 4 },
    { ...rows[0], features: [null, 1] },
  ]) {
    expect(() =>
      parseDataset([invalid, ...rows.slice(1)].map((row) => JSON.stringify(row)).join('\n'), spec),
    ).toThrow();
  }
  expect(() =>
    parseDataset([...rows, rows[0]].map((row) => JSON.stringify(row)).join('\n'), spec),
  ).toThrow('unique');
  expect(() => modelSpecSchema.parse({ ...spec, target: { metric: 'mse', value: 0.2 } })).toThrow(
    'accuracy',
  );
  expect(() => modelSpecSchema.parse({ ...spec, outputEncoding: 'probabilities' })).toThrow(
    'logits',
  );
  expect(() =>
    prepareData(
      Array.from({ length: 12 }, (_, i) => ({ ...rows[0]!, id: String(i) })),
      spec,
    ),
  ).toThrow('distinct');
});

test('pooling checks output shape and normalizes embeddings', () => {
  for (const value of poolEmbedding([1, 0, 0, 1], [1, 2, 2], 2, 'mean'))
    expect(value).toBeCloseTo(Math.SQRT1_2);
  expect(() => poolEmbedding([0, 0], [1, 2], 2, 'none')).toThrow('zero');
  expect(() => poolEmbedding([1, 0], [1, 2], 3, 'none')).toThrow('shape');
});

test('inference releases sessions after shape mismatch and reports measured accuracy', async () => {
  let released = 0;
  const factory = async () => ({
    inputs: ['input'],
    outputs: ['output'],
    async run() {
      return { output: { data: new Float32Array([2]), dims: [1, 1] } };
    },
    async release() {
      released++;
    },
  });
  const request = {
    model: 'fixture.onnx',
    rows: [{ id: 'x', features: [1, 2], label: 1 }],
    spec,
    preprocessing: { mean: [0, 0], scale: [1, 1] },
  };
  expect((await evaluate(request, factory)).value).toBe(1);
  await expect(evaluate({ ...request, spec: { ...spec, outputSize: 2 } }, factory)).rejects.toThrow(
    'shape',
  );
  expect(released).toBe(2);
});
