import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CourtListenerEmbedder,
  MODEL_DIRECTORY,
  QUERY_PREFIX,
  sha256,
} from '../.agents/plugins/legal/mcp/embeddings.ts';

type Row = {
  kind: 'query' | 'document';
  text: string;
  ids: number[];
  vector: number[];
};
const cosine = (a: number[], b: number[]) =>
  a.reduce((sum, v, i) => sum + v * b[i]!, 0) / (Math.hypot(...a) * Math.hypot(...b));
const rank = (query: number[], docs: number[][]) =>
  docs
    .map((doc, i) => ({ i, score: cosine(query, doc) }))
    .sort((a, b) => b.score - a.score)
    .map((v) => v.i);

export async function verifyEmbeddings() {
  await rm(join(MODEL_DIRECTORY, 'verified.json'), { force: true });
  const rows: Row[] = JSON.parse(await readFile(join(MODEL_DIRECTORY, 'reference.json'), 'utf8'));
  if (rows.length < 12 || !rows.some((r) => r.kind === 'document'))
    throw new Error('Missing reference coverage');
  const embedder = await CourtListenerEmbedder.load(MODEL_DIRECTORY, {
    verify: false,
  });
  let minimumCosine = 1,
    maximumAbsoluteError = 0;
  const actual: number[][] = [];
  const started = performance.now();
  try {
    for (const [i, row] of rows.entries()) {
      const prefix = row.kind === 'query' ? QUERY_PREFIX : 'search_document: ';
      const ids = embedder.tokenize(row.text, prefix);
      if (JSON.stringify(ids) !== JSON.stringify(row.ids))
        throw new Error(`Tokenizer differs from Python on fixture ${i}`);
      const vector = await embedder.embed(row.text, prefix);
      const similarity = cosine(vector, row.vector);
      const error = Math.max(...vector.map((v, d) => Math.abs(v - row.vector[d]!)));
      if (similarity < 0.99999 || error > 0.0001 || Math.abs(Math.hypot(...vector) - 1) > 0.00001) {
        throw new Error(
          `Embedding parity failed on fixture ${i}: cosine=${similarity}, max error=${error}`,
        );
      }
      minimumCosine = Math.min(minimumCosine, similarity);
      maximumAbsoluteError = Math.max(maximumAbsoluteError, error);
      actual.push(vector);
      console.log(
        `Fixture ${i + 1}/${rows.length}: ${ids.length} tokens, cosine=${similarity.toFixed(8)}, max error=${error.toExponential(2)}`,
      );
    }
    const docs = rows.flatMap((r, i) => (r.kind === 'document' ? [actual[i]!] : []));
    const referenceDocs = rows.filter((r) => r.kind === 'document').map((r) => r.vector);
    for (const [i, row] of rows.entries()) {
      if (
        row.kind === 'query' &&
        JSON.stringify(rank(actual[i]!, docs)) !== JSON.stringify(rank(row.vector, referenceDocs))
      ) {
        throw new Error(`Retrieval ranking changed on fixture ${i}`);
      }
    }
    // Exercise the graph's dynamic mask with actual padding, not just pooling in isolation.
    const row = rows[1]!;
    const padded = await embedder.embedTokens(
      [...row.ids, ...Array(8).fill(50283)],
      [...Array(row.ids.length).fill(1), ...Array(8).fill(0)],
    );
    const paddedError = Math.max(...padded.map((v, d) => Math.abs(v - row.vector[d]!)));
    if (cosine(padded, row.vector) < 0.99999 || paddedError > 0.0001)
      throw new Error('Padded attention-mask parity failed');
    const report = {
      passed: true,
      manifestSha256: sha256(await readFile(join(MODEL_DIRECTORY, 'manifest.json'))),
      fixtures: rows.length,
      minimumCosine,
      maximumAbsoluteError,
      rankingsMatch: true,
      paddedMaximumAbsoluteError: paddedError,
      elapsedMs: Math.round(performance.now() - started),
      verifiedAt: new Date().toISOString(),
    };
    await writeFile(join(MODEL_DIRECTORY, 'verified.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await embedder.release();
  }
}

if (import.meta.main) await verifyEmbeddings();
