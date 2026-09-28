import { createHash } from 'node:crypto';
import type { ModelSpec } from './spec.ts';

export const hash = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
export interface DataRow {
  id: string;
  features?: number[];
  label?: number;
  input_ids?: number[];
  positive?: number[];
}
export interface Preprocessing {
  mean: number[];
  scale: number[];
}
export interface PreparedData {
  train: DataRow[];
  validation: DataRow[];
  test: DataRow[];
  preprocessing: Preprocessing;
  split: { train: string[]; validation: string[]; test: string[] };
}
export function parseDataset(text: string, spec: ModelSpec): DataRow[] {
  const seen = new Set<string>();
  const rows = text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, i) => {
      const row = JSON.parse(line) as DataRow;
      if (typeof row.id !== 'string' || !row.id || seen.has(row.id))
        throw new Error(`Row ${i + 1} needs a unique string id`);
      seen.add(row.id);
      const numbers = (value: unknown, length?: number) =>
        Array.isArray(value) &&
        value.length > 0 &&
        (length === undefined || value.length === length) &&
        value.every((n) => typeof n === 'number' && Number.isFinite(n));
      if (spec.task === 'embedding') {
        if (!numbers(row.input_ids) || !numbers(row.positive))
          throw new Error(`Row ${row.id} needs input_ids and positive token arrays`);
        if (![...row.input_ids!, ...row.positive!].every((n) => Number.isSafeInteger(n) && n >= 0))
          throw new Error('Token IDs must be nonnegative safe integers');
        if (row.input_ids!.length !== spec.inputSize || row.positive!.length !== spec.inputSize)
          throw new Error(
            'Embedding rows must use the fixed inputSize token length; padding is not supported by this template',
          );
      } else {
        if (
          !numbers(row.features, spec.inputSize) ||
          typeof row.label !== 'number' ||
          !Number.isFinite(row.label)
        )
          throw new Error(`Row ${row.id} has missing/invalid features or label`);
        const classes = spec.outputSize === 1 ? 2 : spec.outputSize;
        if (
          spec.task === 'classification' &&
          (!Number.isInteger(row.label) || row.label < 0 || row.label >= classes)
        )
          throw new Error(`Row ${row.id} label must be a class index`);
      }
      return row;
    });
  if (rows.length < 10)
    throw new Error('At least 10 rows are required for train/validation/test splits');
  return rows;
}

export function prepareData(rows: DataRow[], spec: ModelSpec): PreparedData {
  // Duplicate inputs stay together even if IDs or labels differ.
  const groups = new Map<string, DataRow[]>();
  for (const row of rows) {
    const key = JSON.stringify(row.features ?? row.input_ids);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const ordered = [...groups].sort(([a], [b]) =>
    hash(`${spec.seed}:${a}`).localeCompare(hash(`${spec.seed}:${b}`)),
  );
  if (ordered.length < 10)
    throw new Error(
      'At least 10 distinct inputs are required; duplicated samples cannot populate separate splits',
    );
  const testSize = Math.max(1, Math.floor(ordered.length * spec.testFraction));
  const validationSize = Math.max(1, Math.floor(ordered.length * spec.validationFraction));
  const test = ordered.slice(0, testSize).flatMap(([, group]) => group);
  const validation = ordered
    .slice(testSize, testSize + validationSize)
    .flatMap(([, group]) => group);
  const train = ordered.slice(testSize + validationSize).flatMap(([, group]) => group);
  if (spec.task === 'classification') {
    const classes = spec.outputSize === 1 ? 2 : spec.outputSize;
    if (new Set(train.map((row) => row.label)).size !== classes)
      throw new Error(
        'Training split does not contain every class; supply more representative data',
      );
  }
  if (spec.task === 'embedding' && (validation.length < 2 || test.length < 2))
    throw new Error('Retrieval evaluation requires at least two pairs in validation and test');
  const mean = Array.from({ length: spec.inputSize }, (_, i) =>
    spec.standardize ? train.reduce((sum, row) => sum + row.features![i]!, 0) / train.length : 0,
  );
  const scale = mean.map((m, i) =>
    spec.standardize
      ? Math.sqrt(
          train.reduce((sum, row) => sum + (row.features![i]! - m) ** 2, 0) / train.length,
        ) || 1
      : 1,
  );
  return {
    train,
    validation,
    test,
    preprocessing: { mean, scale },
    split: {
      train: train.map((row) => row.id),
      validation: validation.map((row) => row.id),
      test: test.map((row) => row.id),
    },
  };
}
export function transform(features: number[], preprocessing: Preprocessing) {
  return features.map((value, i) => (value - preprocessing.mean[i]!) / preprocessing.scale[i]!);
}
export function trainingRows(
  rows: DataRow[],
  spec: ModelSpec,
  preprocessing: Preprocessing,
  inputs: string[] = [],
) {
  const feeds = (ids: number[]) => ({
    [spec.inputName]: ids,
    ...(inputs.includes('attention_mask') ? { attention_mask: ids.map(() => 1) } : {}),
    ...(inputs.includes('token_type_ids') ? { token_type_ids: ids.map(() => 0) } : {}),
  });
  return (
    rows
      .map((row) =>
        spec.task === 'embedding'
          ? { ...feeds(row.input_ids!), positive: feeds(row.positive!) }
          : {
              [spec.inputName]: transform(row.features!, preprocessing),
              label:
                spec.task === 'classification' && spec.outputSize > 1 ? row.label : [row.label],
            },
      )
      .map((row) => JSON.stringify(row))
      .join('\n') + '\n'
  );
}
