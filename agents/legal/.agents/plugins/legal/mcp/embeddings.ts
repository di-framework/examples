import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Session } from '@di-framework/ml';
import { Tokenizer } from '@huggingface/tokenizers';

export const MODEL = 'freelawproject/modernbert-embed-base_finetune_512';
export const MODEL_REVISION = '04f0141fbc045122439d28d51ba670f3091e9ed8';
export const MODEL_DIRECTORY = resolve(import.meta.dir, '../../../../.cache/courtlistener-onnx');
export const DIMENSIONS = 768;
export const MAX_LENGTH = 8192;
export const QUERY_PREFIX = 'search_query: ';
export const ARTIFACTS = [
  'model.onnx',
  'tokenizer.json',
  'tokenizer_config.json',
  'reference.json',
] as const;
const SETUP = 'Run bun run embeddings:prepare from agents/legal.';
export const sha256 = (data: Uint8Array | string) =>
  createHash('sha256').update(data).digest('hex');

export type Manifest = {
  model: string;
  revision: string;
  dimensions: number;
  maxLength: number;
  pooling: string;
  normalize: boolean;
  queryPrefix: string;
  sha256: Record<string, string>;
};

export function validateManifest(value: Manifest) {
  if (
    value.model !== MODEL ||
    value.revision !== MODEL_REVISION ||
    value.dimensions !== DIMENSIONS ||
    value.maxLength !== MAX_LENGTH ||
    value.pooling !== 'masked-mean' ||
    value.normalize !== true ||
    value.queryPrefix !== QUERY_PREFIX ||
    !value.sha256 ||
    ARTIFACTS.some((name) => !/^[0-9a-f]{64}$/.test(value.sha256[name] ?? ''))
  ) {
    throw new Error('Incompatible CourtListener ONNX bundle. ' + SETUP);
  }
}

/** Attention-mask weighted mean over every non-padding token, then L2 normalization. */
export function poolAndNormalize(
  hidden: Float32Array,
  dims: number[],
  mask: readonly number[],
): number[] {
  if (
    dims.length !== 3 ||
    dims[0] !== 1 ||
    dims[1] !== mask.length ||
    dims[2] !== DIMENSIONS ||
    hidden.length !== mask.length * DIMENSIONS ||
    mask.some((v) => v !== 0 && v !== 1)
  ) {
    throw new Error('Unexpected ModernBERT output shape or attention mask');
  }
  const count = mask.reduce((sum, v) => sum + v, 0);
  if (!count) throw new Error('Cannot pool an empty attention mask');
  const vector = Array<number>(DIMENSIONS).fill(0);
  for (let t = 0; t < mask.length; t++) {
    if (!mask[t]) continue;
    for (let d = 0; d < DIMENSIONS; d++)
      vector[d] = vector[d]! + hidden[t * DIMENSIONS + d]! / count;
  }
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm === 0)
    throw new Error('Expected a finite, nonzero CourtListener embedding');
  return vector.map((v) => v / norm);
}

/** One model/session per worker. No Python, HTTP or model downloads at query time. */
export class CourtListenerEmbedder {
  private constructor(
    private readonly session: Session,
    private readonly tokenizer: Tokenizer,
  ) {}

  static async load(directory = MODEL_DIRECTORY, options: { verify?: boolean } = {}) {
    let manifestBytes: Buffer;
    try {
      manifestBytes = await readFile(join(directory, 'manifest.json'));
    } catch {
      throw new Error('CourtListener ONNX bundle is missing. ' + SETUP);
    }
    const manifest: Manifest = JSON.parse(manifestBytes.toString());
    validateManifest(manifest);
    if (options.verify !== false) {
      let verified: { manifestSha256?: string; passed?: boolean };
      try {
        verified = JSON.parse(await readFile(join(directory, 'verified.json'), 'utf8'));
      } catch {
        throw new Error('CourtListener ONNX bundle has not passed parity verification. ' + SETUP);
      }
      if (verified.passed !== true || verified.manifestSha256 !== sha256(manifestBytes)) {
        throw new Error('CourtListener ONNX parity verification is stale. ' + SETUP);
      }
    }
    // Hash the actual bytes being loaded; a stale or mixed model/tokenizer must fail closed.
    const files = new Map<string, Buffer>();
    for (const name of ARTIFACTS) {
      const bytes = await readFile(join(directory, name));
      if (sha256(bytes) !== manifest.sha256[name])
        throw new Error(`CourtListener bundle checksum mismatch: ${name}. ${SETUP}`);
      files.set(name, bytes);
    }
    const tokenizer = new Tokenizer(
      JSON.parse(files.get('tokenizer.json')!.toString()),
      JSON.parse(files.get('tokenizer_config.json')!.toString()),
    );
    const session = await Session.fromBytes(files.get('model.onnx')!);
    if (
      session.inputs.join(',') !== 'input_ids,attention_mask' ||
      session.outputs.join(',') !== 'last_hidden_state'
    ) {
      await session.release();
      throw new Error('Unexpected CourtListener ONNX input/output names');
    }
    return new CourtListenerEmbedder(session, tokenizer);
  }

  tokenize(text: string, prefix = QUERY_PREFIX): number[] {
    // SentenceTransformer strips input strings before tokenizing. The prefix is already attached.
    const stripped = (prefix + text).replace(
      /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g,
      '',
    );
    const ids = this.tokenizer.encode(stripped, {
      add_special_tokens: true,
    }).ids;
    // This pinned tokenizer uses [CLS] + text + [SEP], with right truncation of text only.
    return ids.length <= MAX_LENGTH ? ids : [...ids.slice(0, MAX_LENGTH - 1), ids.at(-1)!];
  }

  async embed(text: string, prefix = QUERY_PREFIX): Promise<number[]> {
    const ids = this.tokenize(text, prefix);
    const mask = Array<number>(ids.length).fill(1);
    return this.embedTokens(ids, mask);
  }

  async embedTokens(ids: number[], mask: number[]): Promise<number[]> {
    if (
      !ids.length ||
      ids.length > MAX_LENGTH ||
      mask.length !== ids.length ||
      ids.some((id) => !Number.isSafeInteger(id) || id < 0 || id >= 50368) ||
      mask.some((v) => v !== 0 && v !== 1) ||
      !mask.some((v) => v === 1)
    ) {
      throw new Error('Invalid ModernBERT token IDs or attention mask');
    }
    const out = await this.session.run({
      input_ids: {
        data: BigInt64Array.from(ids, BigInt),
        dims: [1, ids.length],
      },
      attention_mask: {
        data: BigInt64Array.from(mask, BigInt),
        dims: [1, ids.length],
      },
    });
    const hidden = out.last_hidden_state;
    if (!hidden || !(hidden.data instanceof Float32Array))
      throw new Error('Expected float32 ModernBERT output');
    return poolAndNormalize(hidden.data, hidden.dims, mask);
  }

  release() {
    return this.session.release();
  }
}
