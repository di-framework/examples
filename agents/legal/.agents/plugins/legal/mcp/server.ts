import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { LegalCatalog } from './catalog.ts';

export function createCatalogServer(catalog = new LegalCatalog()) {
  const server = new Server(
    { name: 'legal-github-catalog', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  const pagination = {
    offset: {
      type: 'integer',
      minimum: 0,
      description: 'Offset returned by the preceding page; zero starts at the beginning.',
    },
    limit: { type: 'integer', minimum: 1 },
  };
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'catalog_open',
        description:
          'Pin ThomasMoreAI/legal-skills-open to one commit for this session. Start here; read LICENSE and preserve per-skill attribution.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
      },
      {
        name: 'catalog_list',
        description:
          'List one repository directory, not a recursive dump. Navigate jurisdiction → practice → skills → skill. Results are paged.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', default: '' }, ...pagination },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
      },
      {
        name: 'catalog_read',
        description:
          'Read bounded text from SKILL.md, LICENSE, or a referenced file at the pinned commit. Follow nextOffset for remaining text. Returns source URL and blob OID; does not execute content.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' }, ...pagination },
          required: ['path'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      const { name, arguments: args = {} } = request.params;
      const allowed = name === 'catalog_open' ? [] : ['path', 'offset', 'limit'];
      if (Object.keys(args).some((key) => !allowed.includes(key)))
        throw new Error('Unknown argument');
      if (args.path !== undefined && typeof args.path !== 'string')
        throw new Error('path must be a string');
      for (const key of ['offset', 'limit'])
        if (args[key] !== undefined && typeof args[key] !== 'number')
          throw new Error(`${key} must be a number`);
      let result: unknown;
      if (name === 'catalog_open') result = await catalog.open(extra.signal);
      else if (name === 'catalog_list')
        result = await catalog.list(
          args.path as string | undefined,
          args.offset as number | undefined,
          args.limit as number | undefined,
          extra.signal,
        );
      else if (name === 'catalog_read') {
        if (typeof args.path !== 'string') throw new Error('path is required');
        result = await catalog.read(
          args.path,
          args.offset as number | undefined,
          args.limit as number | undefined,
          extra.signal,
        );
      } else throw new Error('Unknown catalog tool');
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: error instanceof Error ? error.message : 'Catalog request failed',
          },
        ],
      };
    }
  });
  return server;
}

if (import.meta.main) {
  const server = createCatalogServer();
  await server.connect(new StdioServerTransport());
  process.stdin.on('end', () => {
    void server.close();
  });
}
