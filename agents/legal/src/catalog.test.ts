import { expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { type Graphql, LegalCatalog } from '../.agents/plugins/legal/mcp/catalog.ts';
import { createCatalogServer } from '../.agents/plugins/legal/mcp/server.ts';
import { connectPluginMcp, loadLegalPlugin } from './agent.ts';

const commit = 'a'.repeat(40);
function fixture() {
  const requests: { query: string; variables: Record<string, string> }[] = [];
  const graphql: Graphql = async <T>(
    query: string,
    variables: Record<string, string>,
  ): Promise<T> => {
    requests.push({ query, variables });
    if (query.includes('Snapshot'))
      return {
        repository: {
          defaultBranchRef: { name: 'main', target: { oid: commit } },
        },
      } as T;
    const path = variables.expression?.slice(41);
    const entries = [
      { name: 'LICENSE', type: 'blob', mode: 33188, oid: 'license' },
      { name: 'SKILL.md', type: 'blob', mode: 33188, oid: 'skill' },
      { name: 'linked.md', type: 'blob', mode: 40960, oid: 'link' },
      { name: 'large.md', type: 'blob', mode: 33188, oid: 'large' },
      { name: 'binary', type: 'blob', mode: 33188, oid: 'binary' },
    ];
    const text = '---\nname: example\nlicense: Apache-2.0\n---\nA legal skill.';
    const object = query.includes('on Tree')
      ? { __typename: 'Tree', oid: 'tree', entries }
      : {
          __typename: 'Blob',
          oid: 'skill',
          byteSize: path === 'large.md' ? 300000 : text.length,
          isBinary: path === 'binary',
          ...(query.includes(' text') ? { text } : {}),
        };
    return { repository: { object } } as T;
  };
  return { catalog: new LegalCatalog(graphql), requests };
}

test('pins a commit, pages and caches results, and preserves file contents', async () => {
  const { catalog, requests } = fixture();
  const first = await catalog.list('', 0, 2);
  const second = await catalog.list('', first.nextOffset ?? 0, 2);
  expect(first.entries.map((e) => e.name)).toEqual(['LICENSE', 'SKILL.md']);
  expect(second.entries.map((e) => e.name)).toEqual(['binary', 'large.md']);
  let text = '';
  let offset: number | null = 0;
  while (offset !== null) {
    const page = await catalog.read('SKILL.md', offset, 10);
    text += page.text;
    offset = page.nextOffset;
    expect(page.commit).toBe(commit);
    expect(page.sourceUrl).toContain(`/blob/${commit}/SKILL.md`);
  }
  expect(text).toContain('license: Apache-2.0');
  expect(requests).toHaveLength(4);
  expect(requests.slice(1).every((r) => r.variables.expression?.startsWith(`${commit}:`))).toBe(
    true,
  );
  expect(
    requests.every((r) => !r.query.includes('mutation') && r.variables.owner === 'ThomasMoreAI'),
  ).toBe(true);
});

test('rejects unsafe paths, links, binary and large files before content fetch', async () => {
  const { catalog, requests } = fixture();
  for (const path of ['../secret', '/etc/passwd', 'main:LICENSE', 'a/../b', 'a\\b', 'a//b'])
    await expect(catalog.read(path)).rejects.toThrow('repository-relative');
  expect(requests).toHaveLength(0);
  await expect(catalog.read('linked.md')).rejects.toThrow('regular');
  await expect(catalog.read('large.md')).rejects.toThrow('256 KiB');
  await expect(catalog.read('binary')).rejects.toThrow('binary');
  expect(requests.some((r) => r.query.includes(' text'))).toBe(false);
  await expect(catalog.list('', 0, 101)).rejects.toThrow('limit');
  await expect(catalog.read('LICENSE', 0, 16001)).rejects.toThrow('limit');
  await expect(catalog.open(AbortSignal.abort())).rejects.toThrow();
});

test('enforces a session request budget and reports missing objects', async () => {
  const { catalog } = fixture();
  for (let index = 0; index < 99; index++) await catalog.list(`directory-${index}`);
  await expect(catalog.list('another')).rejects.toThrow('request limit');
  const missing = new LegalCatalog(
    async <T>(query: string): Promise<T> =>
      (query.includes('Snapshot')
        ? {
            repository: {
              defaultBranchRef: { name: 'main', target: { oid: commit } },
            },
          }
        : { repository: { object: null } }) as T,
  );
  await expect(missing.read('missing.md')).rejects.toThrow('No catalog object');
});

test('MCP exposes only three read tools and rejects arbitrary query inputs', async () => {
  const { catalog } = fixture();
  const server = createCatalogServer(catalog);
  const client = new Client({ name: 'test', version: '1' });
  const [host, peer] = InMemoryTransport.createLinkedPair();
  await server.connect(host);
  await client.connect(peer);
  try {
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual([
      'catalog_open',
      'catalog_list',
      'catalog_read',
    ]);
    expect(
      (
        await client.callTool({
          name: 'catalog_read',
          arguments: { path: 'SKILL.md', limit: 10 },
        })
      ).isError,
    ).not.toBe(true);
    expect(
      (
        await client.callTool({
          name: 'catalog_open',
          arguments: { query: 'mutation { }' },
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await client.callTool({
          name: 'catalog_read',
          arguments: { path: '../secret' },
        })
      ).isError,
    ).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});

test('plugin stdio launch resolves pluginDir and queries a fake gh process', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'legal-gh-test-'));
  const gh = join(directory, 'gh');
  await writeFile(
    gh,
    `#!${process.execPath}
const input = JSON.parse(await Bun.stdin.text());
if (!input.query.includes('Snapshot')) throw new Error('Unexpected query');
console.log(JSON.stringify({data:{repository:{defaultBranchRef:{name:'main',target:{oid:'${commit}'}}}}}));
`,
  );
  await chmod(gh, 0o755);
  try {
    const plugin = loadLegalPlugin(join(import.meta.dir, '..'));
    const server = plugin.mcpConfig?.mcpServers['legal-skills-open'];
    if (!server) throw new Error('Missing plugin MCP config');
    const session = await connectPluginMcp(
      'legal-skills-open',
      {
        ...server,
        env: { PATH: `${directory}:${process.env.PATH}` },
      },
      plugin,
    );
    try {
      const tool = session.tools.find((t) => t.toolDefinition.name.endsWith('catalog_open'));
      if (!tool) throw new Error('Missing catalog_open callback');
      expect(await tool.call('{}')).toContain(commit);
    } finally {
      await session.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
