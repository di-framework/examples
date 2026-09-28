import { afterEach, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  ChatResponse,
  FakeChatModel,
  functionToolCallback,
  toolCall,
  toolCallResponse,
} from '@di-framework/ai';
import { connectPluginMcp, createLegalAgent, loadLegalPlugin } from './agent.ts';

const workspace = resolve(import.meta.dir, '..');
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test('loads legal rules and executes an actual Skill with injected inference', async () => {
  const model = new FakeChatModel((prompt) => {
    expect(prompt.getSystemMessage().text).toContain('Do not skip intake');
    if (!prompt.messages.some((message) => message.messageType === 'tool'))
      return toolCallResponse([toolCall('intake', 'Skill', { command: 'state' })]);
    expect(JSON.stringify(prompt.messages)).toContain(
      resolve(workspace, '.agents/plugins/legal/skills/state'),
    );
    return ChatResponse.of('Intake ready');
  });
  const legal = await createLegalAgent(model, { workspace, mcp: false });
  try {
    expect(legal.toolbox.skills).toHaveLength(7);
    expect((await legal.agent.chat('Begin intake')).content).toBe('Intake ready');
    expect(legal.toolbox.runtime.activeSkill()?.name).toBe('state');
    expect(model.calls).toHaveLength(2);
  } finally {
    await legal.close();
  }
});

test('resolves .agents/plugin from cwd and fails when the plugin is missing', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'legal-agent-')));
  temporary.push(directory);
  await mkdir(join(directory, '.agents/plugin'), { recursive: true });
  await cp(join(workspace, '.agents/plugins/legal'), join(directory, '.agents/plugin/legal'), {
    recursive: true,
  });
  const previous = process.cwd();
  try {
    process.chdir(directory);
    const legal = await createLegalAgent(new FakeChatModel(), { mcp: false });
    expect(legal.plugin.basePath).toBe(join(directory, '.agents/plugin/legal'));
    expect(legal.toolbox.skills).toHaveLength(7);
    await legal.close();
    await rm(join(directory, '.agents/plugin/legal/plugin.json'));
    expect(() => loadLegalPlugin()).toThrow('Expected legal plugin');
  } finally {
    process.chdir(previous);
  }
});

test('MCP tools reach the model and sessions close exactly once', async () => {
  let closed = 0;
  let called = 0;
  const model = new FakeChatModel((prompt) =>
    prompt.messages.some((message) => message.messageType === 'tool')
      ? ChatResponse.of('MCP used')
      : toolCallResponse([toolCall('discover', 'legal_discover', {})]),
  );
  const legal = await createLegalAgent(model, {
    workspace,
    connectMcp: async (name, server) => {
      if (name === 'courtlistener') return { tools: [], close: async () => {} };
      expect(name).toBe('legal-skills-open');
      expect(server.command).toBe('bun');
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Assert the literal plugin placeholder.
      expect(server.args).toEqual(['${pluginDir}/mcp/server.ts']);
      return {
        tools: [
          functionToolCallback({
            name: 'legal_discover',
            call: () => {
              called++;
              return 'catalog';
            },
          }),
        ],
        close: async () => {
          closed++;
        },
      };
    },
  });
  expect((await legal.agent.chat('Discover')).content).toBe('MCP used');
  expect(called).toBe(1);
  await legal.close();
  await legal.close();
  expect(closed).toBe(1);
});

test('unavailable MCP is reported while local skills remain usable', async () => {
  const warnings: string[] = [];
  const legal = await createLegalAgent(new FakeChatModel(), {
    workspace,
    connectMcp: async () => {
      throw new Error('offline');
    },
    onWarning: (warning) => warnings.push(warning),
  });
  expect(warnings[0]).toContain('offline');
  expect(legal.toolbox.skills).toHaveLength(7);
  expect((await legal.agent.chat('hello')).content).toBe('ok');
  await legal.close();
});

test('HTTP MCP tools execute through the real SDK transport', async () => {
  let calls = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      const body = (await request.json()) as { id?: number; method: string };
      if (body.id === undefined) return new Response(null, { status: 202 });
      const result =
        body.method === 'initialize'
          ? {
              protocolVersion: '2025-03-26',
              capabilities: { tools: {} },
              serverInfo: { name: 'test-legal', version: '1' },
            }
          : body.method === 'tools/list'
            ? { tools: [{ name: 'discover', inputSchema: { type: 'object' } }] }
            : { content: [{ type: 'text', text: `catalog ${++calls}` }] };
      return Response.json({ jsonrpc: '2.0', id: body.id, result });
    },
  });
  try {
    const session = await connectPluginMcp('legal-skills-open', {
      serverUrl: server.url.toString(),
    });
    const tool = session.tools[0];
    if (!tool) throw new Error('Missing discovered tool');
    const legal = await createLegalAgent(
      new FakeChatModel((prompt) =>
        prompt.messages.some((message) => message.messageType === 'tool')
          ? ChatResponse.of('done')
          : toolCallResponse([toolCall('remote', tool.toolDefinition.name, {})]),
      ),
      {
        workspace,
        connectMcp: async (name) =>
          name === 'legal-skills-open' ? session : { tools: [], close: async () => {} },
      },
    );
    try {
      expect((await legal.agent.chat('Discover legal skills')).content).toBe('done');
      expect(calls).toBe(1);
    } finally {
      await legal.close();
    }
  } finally {
    await server.stop(true);
  }
});
