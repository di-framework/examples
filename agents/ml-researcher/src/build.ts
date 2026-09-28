import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { json, safePath } from './artifacts.ts';
import { type DataRow, hash, parseDataset, prepareData, trainingRows } from './data.ts';
import { type Evaluation, type EvaluationRequest, poolEmbedding } from './evaluate.ts';
import { nativeRequest } from './native.ts';
import { assertProcess } from './process.ts';
import type { ResearchRun } from './repositories.ts';
import { type ModelSpec, modelSpecSchema } from './spec.ts';

export interface BuildDependencies {
  native?: typeof nativeRequest;
  evaluate?: (request: EvaluationRequest, signal?: AbortSignal) => Promise<Evaluation>;
  resolveInput?: (path: string) => Promise<string>;
}
const better = (spec: ModelSpec, a: number, b: number) =>
  spec.task === 'regression' ? a < b : a > b;
export const meetsTarget = (spec: ModelSpec, score: number) =>
  spec.task === 'regression' ? score <= spec.target.value : score >= spec.target.value;

export class ModelBuilder {
  constructor(
    private readonly run: ResearchRun,
    private readonly dependencies: BuildDependencies = {},
  ) {}
  async build(raw: unknown, signal?: AbortSignal) {
    const spec = modelSpecSchema.parse(raw);
    const timeout = AbortSignal.timeout(spec.budgetSeconds * 1000);
    const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const native = this.dependencies.native ?? nativeRequest;
    const resolveInput =
      this.dependencies.resolveInput ?? ((path: string) => safePath(this.run.store.root, path));
    const evaluate =
      this.dependencies.evaluate ??
      (async (request, signal) => {
        const result = assertProcess(
          await this.run.execute({
            command: process.execPath,
            args: [join(import.meta.dir, 'evaluate.ts')],
            cwd: this.run.store.root,
            input: json(request),
            signal,
          }),
        );
        return JSON.parse(result.stdout.trim()) as Evaluation;
      });
    const base = `models/${spec.name}`;
    const root = await safePath(this.run.store.root, base);
    // A model name identifies one frozen split/selection run. Never overwrite a prior test result.
    await mkdir(join(root, '..'), { recursive: true });
    await mkdir(root, { recursive: false });
    const checkpoint = (status: string, extra: Record<string, unknown> = {}) =>
      this.run.store.write(`${base}/status.json`, json({ status, ...extra }));
    await this.run.store.write(`${base}/spec.json`, json(spec));
    await checkpoint('preparing');
    try {
      const dataPath = await resolveInput(spec.datasetPath);
      if ((await stat(dataPath)).size > 32 * 1024 * 1024)
        throw new Error('Dataset exceeds the 32 MiB local template limit');
      const dataText = await readFile(dataPath, 'utf8');
      const data = prepareData(parseDataset(dataText, spec), spec);
      await this.run.store.write(
        `${base}/split.json`,
        json({
          seed: spec.seed,
          datasetRevision: spec.datasetRevision,
          datasetHash: hash(dataText),
          ...data.split,
        }),
      );
      await this.run.store.write(`${base}/preprocessing.json`, json(data.preprocessing));
      await this.run.store.write(
        `${base}/data/train.jsonl`,
        trainingRows(data.train, spec, data.preprocessing),
      );
      await this.run.store.write(
        `${base}/data/validation.jsonl`,
        trainingRows(data.validation, spec, data.preprocessing),
      );
      await this.run.store.write(`${base}/data/test.json`, json(data.test));
      const original = join(root, 'initial.onnx');
      if (spec.source.kind === 'mlp') {
        await native(
          this.run,
          {
            action: 'build',
            path: original,
            inputSize: spec.inputSize,
            outputSize: spec.outputSize,
            hidden: spec.source.hidden,
            seed: spec.seed,
            inputName: spec.inputName,
            outputName: spec.outputName,
          },
          abort,
        );
      } else {
        await copyFile(await resolveInput(spec.source.path), original);
        if (spec.source.tokenizerPath)
          await copyFile(
            await resolveInput(spec.source.tokenizerPath),
            join(root, 'tokenizer.json'),
          );
      }
      const initialHash = hash(await readFile(original));
      const inspectText = await native(
        this.run,
        { action: 'inspect', path: original, trainable: spec.trainable },
        abort,
      );
      const inspection = JSON.parse(inspectText.trim().split('\n').at(-1)!) as {
        inputs: string[];
        outputs: string[];
        weights: string[];
      };
      if (
        !inspection.inputs.includes(spec.inputName) ||
        !inspection.outputs.includes(spec.outputName)
      )
        throw new Error('ONNX I/O names do not match specification');
      if (
        inspection.inputs.some(
          (name) =>
            name !== spec.inputName &&
            !(spec.task === 'embedding' && ['attention_mask', 'token_type_ids'].includes(name)),
        )
      )
        throw new Error('ONNX graph requires unsupported additional inputs');
      await this.run.store.write(`${base}/inspection.json`, json({ ...inspection, initialHash }));
      const measure = (model: string, rows: DataRow[]) =>
        evaluate({ model, rows, spec, preprocessing: data.preprocessing }, abort);
      const baseline = await measure(original, data.validation);
      const trials: {
        model: string;
        learningRate: number | null;
        validation: Evaluation;
      }[] = [];
      if (spec.source.kind === 'pretrained')
        trials.push({
          model: original,
          learningRate: null,
          validation: baseline,
        });
      await this.run.store.write(
        `${base}/baseline.json`,
        json({
          model: baseline,
          trivial: trivialBaseline(data.train, data.validation, spec),
        }),
      );
      for (const [index, learningRate] of spec.learningRates.entries()) {
        abort.throwIfAborted();
        await checkpoint('training', { trial: index });
        const trialBase = `${base}/trials/${index}`;
        const trial = join(this.run.store.root, trialBase);
        await this.run.store.write(
          `${trialBase}/data/train.jsonl`,
          trainingRows(data.train, spec, data.preprocessing, inspection.inputs),
        );
        await this.run.store.write(
          `${trialBase}/data/eval.jsonl`,
          trainingRows(data.validation, spec, data.preprocessing, inspection.inputs),
        );
        await copyFile(original, join(trial, 'model.onnx'));
        const loss =
          spec.task === 'embedding'
            ? 'infonce'
            : spec.task === 'regression'
              ? 'mse'
              : spec.outputSize === 1
                ? 'bce-logits'
                : 'cross-entropy';
        const config =
          `loss = ${JSON.stringify(loss)}\noptimizer = "adamw"\nlearning-rate = ${learningRate}\nmax-steps = ${spec.maxSteps}\nbatch-size = ${spec.batchSize}\nseed = ${spec.seed}\nlog-every = ${Math.max(1, spec.maxSteps)}\ntrainable = ${JSON.stringify(spec.trainable)}\n` +
          (spec.task === 'embedding'
            ? `pool = ${JSON.stringify(spec.pooling)}\nl2-normalize = true\nembedding-output = ${JSON.stringify(spec.outputName)}\n`
            : '');
        await this.run.store.write(`${trialBase}/train.toml`, config);
        await native(this.run, { action: 'train', path: trial }, abort);
        const model = join(trial, 'dist/model.onnx');
        const validation = await measure(model, data.validation);
        trials.push({ model, learningRate, validation });
        await this.run.store.write(`${trialBase}/validation.json`, json(validation));
      }
      const winner = trials.reduce((a, b) =>
        better(spec, b.validation.value, a.validation.value) ? b : a,
      );
      await this.run.store.write(
        `${base}/selection.json`,
        json({ criterion: spec.target.metric, trials, selected: winner.model }),
      );
      // Only the validation-selected model is exposed to the held-out test split.
      await checkpoint('evaluating');
      const test = await measure(winner.model, data.test);
      abort.throwIfAborted();
      await mkdir(join(root, 'dist'), { recursive: true });
      await copyFile(winner.model, join(root, 'dist/model.onnx'));
      await this.run.store.write(`${base}/dist/preprocessing.json`, json(data.preprocessing));
      if (spec.source.kind === 'pretrained' && spec.source.tokenizerPath)
        await copyFile(join(root, 'tokenizer.json'), join(root, 'dist/tokenizer.json'));
      await this.run.store.write(`${base}/dist/infer.ts`, inferenceExample(spec));
      await this.run.store.write(`${base}/dist/spec.json`, json(spec));
      const report = {
        status: meetsTarget(spec, test.value) ? 'target-met' : 'target-unmet',
        spec,
        baseline,
        validation: winner.validation,
        test,
        selectedLearningRate: winner.learningRate,
        datasetHash: hash(dataText),
        initialModelHash: initialHash,
        tokenizerHash:
          spec.source.kind === 'pretrained' && spec.source.tokenizerPath
            ? hash(await readFile(join(root, 'tokenizer.json')))
            : null,
        modelHash: hash(await readFile(join(root, 'dist/model.onnx'))),
        hardware: {
          platform: process.platform,
          architecture: process.arch,
          cpu: cpus()[0]?.model,
          logicalCpus: cpus().length,
          memoryBytes: totalmem(),
        },
        backend: 'cpu',
        inference: '@di-framework/ml / WASM',
        repository: this.run.manifest.worktrees.ml,
        model: join(root, 'dist/model.onnx'),
        input: {
          name: spec.inputName,
          shape: [1, spec.inputSize],
          type: spec.task === 'embedding' ? 'int64' : 'float32',
        },
        output: {
          name: spec.outputName,
          dimensions: spec.outputSize,
          encoding: spec.outputEncoding,
          pooling: spec.pooling,
        },
        limitations:
          spec.task === 'embedding'
            ? [
                'Pretokenized, fixed-length inputs; recall@1 uses other held-out positives as negatives.',
              ]
            : [
                'Random grouped split; temporal or grouped deployment shifts require a task-specific evaluation.',
              ],
      };
      await this.run.store.write(`${base}/report.json`, json(report));
      await this.run.store.write(
        `${base}/report.md`,
        `# ${spec.name}\n\nStatus: **${report.status}**\n\n${test.metric}: ${test.value} on ${test.samples} held-out rows; target ${spec.target.value}.\n\nValidation: ${winner.validation.value}. Initial model: ${baseline.value}.\n\nModel: ${report.model}\n\nSee spec.json, split.json, selection.json, trials/*/train.toml and trials/*/dist/metrics.json for reproduction. Run dist/infer.ts with Bun in an environment with @di-framework/ml installed.\n\n${report.limitations.join('\n')}\n`,
      );
      await checkpoint(report.status);
      return report;
    } catch (error) {
      await checkpoint(abort.aborted ? 'cancelled-or-timed-out' : 'failed', {
        error: String(error),
      });
      throw error;
    }
  }
}
function trivialBaseline(train: DataRow[], validation: DataRow[], spec: ModelSpec) {
  if (spec.task === 'embedding')
    return {
      metric: 'recallAt1',
      value: 1 / validation.length,
      method: 'random retrieval expectation',
    };
  const labels = train.map((row) => row.label!);
  const prediction =
    spec.task === 'regression'
      ? labels.reduce((a, b) => a + b, 0) / labels.length
      : [...new Set(labels)].sort(
          (a, b) => labels.filter((n) => n === b).length - labels.filter((n) => n === a).length,
        )[0]!;
  const value =
    validation.reduce(
      (sum, row) =>
        sum +
        (spec.task === 'regression'
          ? (row.label! - prediction) ** 2
          : Number(row.label === prediction)),
      0,
    ) / validation.length;
  return {
    metric: spec.target.metric,
    value,
    prediction,
    method: spec.task === 'regression' ? 'training mean' : 'training majority class',
  };
}
function inferenceExample(spec: ModelSpec) {
  return `import { Session } from '@di-framework/ml';
import { fileURLToPath } from 'node:url';
${spec.task === 'embedding' ? poolEmbedding.toString() : ''}
const session = await Session.fromPath(fileURLToPath(new URL('./model.onnx', import.meta.url)));
const preprocessing = await Bun.file(new URL('./preprocessing.json', import.meta.url)).json();
// Usage: bun infer.ts '[${Array.from({ length: Math.min(spec.inputSize, 8) }, () => 0).join(',')}]'
// Supply exactly ${spec.inputSize} ${spec.task === 'embedding' ? 'unpadded token IDs from the recorded tokenizer' : 'numeric features in training order'}.
try {
  const values = JSON.parse(Bun.argv[2] ?? '[]');
  if (!Array.isArray(values) || values.length !== ${spec.inputSize} || !values.every(Number.isFinite)) throw new Error('Input shape mismatch');
  ${spec.task === 'embedding' ? "if (!values.every((v) => Number.isSafeInteger(v) && v >= 0)) throw new Error('Invalid token IDs');" : ''}
  const feeds: any = { ${JSON.stringify(spec.inputName)}: { data: ${spec.task === 'embedding' ? 'BigInt64Array.from(values, BigInt)' : 'Float32Array.from(values.map((v, i) => (v - preprocessing.mean[i]) / preprocessing.scale[i]))'}, dims: [1, values.length] } };
  ${spec.task === 'embedding' ? "for (const name of session.inputs) { if (name === 'attention_mask' || name === 'token_type_ids') feeds[name] = { data: BigInt64Array.from(values, () => name === 'attention_mask' ? 1n : 0n), dims: [1, values.length] }; }" : ''}
  const output = (await session.run(feeds))[${JSON.stringify(spec.outputName)}];
  if (!output || !(output.data instanceof Float32Array)) throw new Error('Expected float32 output');
  // Output encoding: ${spec.outputEncoding}; pooling: ${spec.pooling}.
  const result = ${spec.task === 'embedding' ? `poolEmbedding(Array.from(output.data), output.dims, ${spec.outputSize}, ${JSON.stringify(spec.pooling)})` : 'Array.from(output.data)'};
  console.log(JSON.stringify({ dims: ${spec.task === 'embedding' ? '[1, result.length]' : 'output.dims'}, values: result }));
} finally { await session.release(); }
`;
}
