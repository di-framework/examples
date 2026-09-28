import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { GetVectorsCommand, QueryVectorsCommand } from '@aws-sdk/client-s3vectors';
import { S3VectorStore } from '@di-framework/ai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  CourtListener,
  CourtListenerVectors,
  createCourtListenerServer,
  embedQuery,
  validate,
} from '../.agents/plugins/legal/mcp/caselaw.ts';
import { connectPluginMcp, loadLegalPlugin } from './agent.ts';

const vector = Array.from({ length: 768 }, () => 0.01);
const metadata = {
  opinion_id: '100',
  chunk_number: 1,
  text: 'A published opinion chunk.',
};
const body = (text: string) => ({
  transformToWebStream: () => new Blob([text]).stream(),
});
function fixture() {
  const calls: { command: any; input: any; options?: any }[] = [];
  const vectors = new CourtListenerVectors(
    async (text, signal) => {
      calls.push({ command: 'embed', input: { text, signal } });
      return vector;
    },
    {
      send: async (command: any, options: any) => {
        calls.push({ command, input: command.input, options });
        if (command instanceof QueryVectorsCommand)
          return {
            distanceMetric: 'cosine',
            vectors: [{ key: '100:1', distance: 0.15, metadata }],
          };
        if (command instanceof GetVectorsCommand) return { vectors: [{ key: '100:1', metadata }] };
        throw new Error('Unexpected command');
      },
    } as any,
    {
      send: async (command: any, options: any) => {
        calls.push({ command, input: command.input, options });
        return {
          Body: body(
            JSON.stringify({
              complete: false,
              phase: 'running',
              vectors: 12000,
              objects: 1000,
              updated_at: 1789162900,
            }),
          ),
        };
      },
    } as any,
  );
  return { vectors, calls };
}

test('DI S3VectorStore maps AWS distance, query vectors, metadata filtering and live coverage', async () => {
  const { vectors, calls } = fixture();
  expect(vectors.store()).toBeInstanceOf(S3VectorStore);
  const result: any = await vectors.call('semantic_search_opinions', {
    query: 'due process $(never-execute)',
    top_k: 3,
    opinion_id: 100,
  });
  expect(result.results[0].similarity).toBeCloseTo(0.85);
  expect(result.results[0].opinion_id).toBe(100);
  expect(result.results[0].text).toBe(metadata.text);
  expect(result.import.complete).toBe(false);
  expect(result.note).toContain('incomplete');
  const embedding = calls.find((c) => c.command === 'embed')!;
  expect(embedding.input.text).toBe('due process $(never-execute)');
  const call = calls.find((c) => c.command instanceof QueryVectorsCommand)!;
  const query = call.input;
  expect(call.options.abortSignal).toBeInstanceOf(AbortSignal);
  expect(calls.find((c) => c.command instanceof GetObjectCommand)!.input.Key).toBe(
    'imports/modernbert-768/status.json',
  );
  expect(query.queryVector.float32).toHaveLength(768);
  expect(query.queryVector.float32[0]).toBeCloseTo(1 / Math.sqrt(768));
  expect(query.filter).toEqual({ opinion_id: { $eq: '100' } });
  expect(query.topK).toBe(3);
  expect(query.returnMetadata).toBe(true);
  expect(query.returnDistance).toBe(true);
});

test('chunk retrieval pages through DI without embedding or API credentials', async () => {
  const { vectors, calls } = fixture();
  const result: any = await vectors.call('get_opinion_chunk', {
    opinion_id: 100,
    chunk_number: 1,
    offset: 2,
    length: 9,
  });
  expect(result.text).toBe(metadata.text.slice(2, 11));
  expect(result.next_offset).toBe(11);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.command).toBeInstanceOf(GetVectorsCommand);
  await expect(vectors.store().delete(['100:1'])).rejects.toThrow('read-only');
});

test('invalid arguments and incompatible embeddings fail before AWS search', async () => {
  for (const args of [
    { query: 'x', top_k: -1 },
    { query: '' },
    { query: 'x', top_k: 21 },
    { query: 'x', surprise: true },
  ])
    expect(() => validate('semantic_search_opinions', args)).toThrow();
  await expect(embedQuery('test', undefined, async () => [1, 2])).rejects.toThrow('768');
  await expect(embedQuery('test', undefined, async () => Array(768).fill(NaN))).rejects.toThrow(
    'finite',
  );
});

test('oversized text is fetched only from its exact owned S3 key as text', async () => {
  let fetched = false;
  const vectors = new CourtListenerVectors(
    undefined,
    {
      send: async () => ({
        vectors: [
          {
            key: '100:1',
            metadata: {
              ...metadata,
              text: undefined,
              text_s3_key: 'chunks/100/1.txt',
            },
          },
        ],
      }),
    } as any,
    {
      send: async (command: GetObjectCommand) => {
        fetched = true;
        expect(command.input.Key).toBe('chunks/100/1.txt');
        return { Body: body('Complete chunk text') };
      },
    } as any,
  );
  expect(
    (
      (await vectors.call('get_opinion_chunk', {
        opinion_id: 100,
        chunk_number: 1,
      })) as any
    ).text,
  ).toBe('Complete chunk text');
  expect(fetched).toBe(true);
  const bad = new CourtListenerVectors(undefined, {
    send: async () => ({
      vectors: [{ key: '100:1', metadata: { text_s3_key: '../../private' } }],
    }),
  } as any);
  await expect(bad.call('get_opinion_chunk', { opinion_id: 100, chunk_number: 1 })).rejects.toThrow(
    'Unexpected chunk',
  );
});

test('semantic search runs through the MCP protocol without a CourtListener API token', async () => {
  const { vectors } = fixture();
  const server = createCourtListenerServer(new CourtListener('', fetch, vectors));
  const client = new Client({ name: 'test', version: '1' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(left);
  await client.connect(right);
  try {
    expect((await client.listTools()).tools.map((t) => t.name)).toContain(
      'semantic_search_opinions',
    );
    const result = await client.callTool({
      name: 'semantic_search_opinions',
      arguments: { query: 'due process' },
    });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).toContain('A published opinion chunk.');
    expect(
      (
        await client.callTool({
          name: 'semantic_search_opinions',
          arguments: { query: 'x', top_k: -1 },
        })
      ).isError,
    ).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});

test('legal plugin launches the CourtListener MCP and exposes DI tool callbacks', async () => {
  const plugin = loadLegalPlugin(resolve(import.meta.dir, '..'));
  const config = plugin.mcpConfig?.mcpServers.courtlistener;
  if (!config) throw new Error('CourtListener MCP not registered');
  const session = await connectPluginMcp('courtlistener', config, plugin);
  try {
    expect(
      session.tools
        .map((t) => t.toolDefinition.name)
        .some((name) => name.endsWith('semantic_search_opinions')),
    ).toBe(true);
    expect(
      session.tools
        .map((t) => t.toolDefinition.name)
        .some((name) => name.endsWith('get_opinion_chunk')),
    ).toBe(true);
  } finally {
    await session.close();
  }
});
