import { Session, type Tensor, type TensorData } from '@di-framework/ml';
import { type DataRow, type Preprocessing, transform } from './data.ts';
import type { ModelSpec } from './spec.ts';

export interface Evaluation {
  metric: string;
  value: number;
  samples: number;
  metrics: Record<string, number>;
}
export interface EvaluationRequest {
  model: string;
  rows: DataRow[];
  spec: ModelSpec;
  preprocessing: Preprocessing;
}
export interface InferenceSession {
  inputs: string[];
  outputs: string[];
  run(feeds: Record<string, Tensor<TensorData>>): Promise<Record<string, Tensor<TensorData>>>;
  release(): Promise<void>;
}
export type SessionFactory = (path: string) => Promise<InferenceSession>;

export function poolEmbedding(
  values: number[],
  dims: number[],
  size: number,
  pooling: ModelSpec['pooling'],
): number[] {
  if (dims[0] !== 1 || dims.at(-1) !== size || !values.every(Number.isFinite))
    throw new Error('Embedding output shape/values do not match specification');
  let vector: number[];
  if (dims.length === 2) vector = values;
  else if (dims.length === 3 && pooling !== 'none') {
    const tokens = dims[1]!;
    if (!tokens) throw new Error('Empty embedding output');
    if (pooling === 'cls') vector = values.slice(0, size);
    else if (pooling === 'last-token') vector = values.slice(-size);
    else
      vector = Array.from({ length: size }, (_, i) => {
        let sum = 0;
        for (let t = 0; t < tokens; t++) sum += values[t * size + i]!;
        return sum / tokens;
      });
  } else throw new Error('Embedding pooling must match the output rank');
  if (vector.length !== size) throw new Error('Embedding length mismatch');
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm === 0) throw new Error('Invalid zero/nonfinite embedding');
  return vector.map((value) => value / norm);
}

export async function evaluate(
  request: EvaluationRequest,
  createSession: SessionFactory = Session.fromPath,
): Promise<Evaluation> {
  const { spec, rows, preprocessing } = request;
  if (!rows.length) throw new Error('No evaluation rows');
  const session = await createSession(request.model);
  try {
    if (!session.inputs.includes(spec.inputName) || !session.outputs.includes(spec.outputName))
      throw new Error('Model input/output names do not match specification');
    const predict = async (row: DataRow, positive = false) => {
      const feeds: Record<string, Tensor<TensorData>> = {};
      if (spec.task === 'embedding') {
        const ids = positive ? row.positive! : row.input_ids!;
        feeds[spec.inputName] = {
          data: BigInt64Array.from(ids, BigInt),
          dims: [1, ids.length],
        };
        for (const input of session.inputs) {
          if (input === 'attention_mask')
            feeds[input] = {
              data: BigInt64Array.from(ids, () => 1n),
              dims: [1, ids.length],
            };
          if (input === 'token_type_ids')
            feeds[input] = {
              data: BigInt64Array.from(ids, () => 0n),
              dims: [1, ids.length],
            };
        }
      } else {
        feeds[spec.inputName] = {
          data: Float32Array.from(transform(row.features!, preprocessing)),
          dims: [1, spec.inputSize],
        };
      }
      if (session.inputs.some((input) => !feeds[input]))
        throw new Error('Model needs additional inputs not supported by this template');
      const output = (await session.run(feeds))[spec.outputName];
      if (!output || !(output.data instanceof Float32Array))
        throw new Error('Expected float32 model output');
      const values = Array.from(output.data);
      if (spec.task === 'embedding')
        return poolEmbedding(values, output.dims, spec.outputSize, spec.pooling);
      if (
        output.dims.length !== 2 ||
        output.dims[0] !== 1 ||
        values.length !== spec.outputSize ||
        !values.every(Number.isFinite)
      )
        throw new Error('Output shape/values do not match specification');
      return values;
    };
    const predictions: number[][] = [];
    for (const row of rows) predictions.push(await predict(row));
    let value: number;
    if (spec.task === 'regression') {
      value =
        predictions.reduce((sum, pred, i) => sum + (pred[0]! - rows[i]!.label!) ** 2, 0) /
        rows.length;
    } else if (spec.task === 'classification') {
      value =
        predictions.filter((pred, i) => {
          const label = pred.length === 1 ? Number(pred[0]! >= 0) : pred.indexOf(Math.max(...pred));
          return label === rows[i]!.label;
        }).length / rows.length;
    } else {
      const documents: number[][] = [];
      for (const row of rows) documents.push(await predict(row, true));
      value =
        predictions.filter((query, i) => {
          const scores = documents.map((document) =>
            document.reduce((sum, d, j) => sum + d * query[j]!, 0),
          );
          return scores.indexOf(Math.max(...scores)) === i;
        }).length / rows.length;
    }
    return {
      metric: spec.target.metric,
      value,
      samples: rows.length,
      metrics: { [spec.target.metric]: value },
    };
  } finally {
    await session.release();
  }
}

if (import.meta.main) {
  try {
    const request = JSON.parse(await Bun.stdin.text()) as EvaluationRequest;
    console.log(JSON.stringify(await evaluate(request)));
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
