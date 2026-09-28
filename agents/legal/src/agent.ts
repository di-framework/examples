import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  adaptSdkClient,
  type ChatMemory,
  type ChatModel,
  createMcpToolCallbackProvider,
  type ToolCallback,
} from '@di-framework/ai';
import {
  type AgentPlugin,
  type AgentPluginMcpServer,
  createSkillsAgentBundle,
  loadPluginsDirectory,
} from '@di-framework/ai-utils';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { caseDataAdvisor } from './case-data.ts';

export interface PluginMcpSession {
  tools: readonly ToolCallback[];
  close(): Promise<void>;
}

export async function connectPluginMcp(
  name: string,
  server: AgentPluginMcpServer,
  plugin?: AgentPlugin,
): Promise<PluginMcpSession> {
  const expand = (value: string) =>
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Plugin config uses a literal placeholder.
    value.replaceAll('${pluginDir}', plugin?.basePath ?? process.cwd());
  if ((!server.serverUrl && !server.command) || (server.serverUrl && server.command))
    throw new Error(`MCP ${name} must specify exactly one of command or serverUrl`);
  const client = new Client({ name: 'legal-agent', version: '0.1.0' });
  const transport = server.command
    ? new StdioClientTransport({
        command: server.command === 'bun' ? process.execPath : expand(server.command),
        args: server.args?.map(expand),
        cwd: server.cwd ? expand(server.cwd) : plugin?.basePath,
        env: Object.fromEntries(
          Object.entries({ ...process.env, ...server.env })
            .filter((entry): entry is [string, string] => entry[1] !== undefined)
            .map(([key, value]) => [key, expand(value)]),
        ),
        stderr: 'inherit',
      })
    : new StreamableHTTPClientTransport(new URL(server.serverUrl ?? ''), {
        requestInit: { headers: server.headers },
        fetch: (url, init) =>
          fetch(url, {
            ...init,
            signal: AbortSignal.any([
              AbortSignal.timeout(10_000),
              ...(init?.signal ? [init.signal] : []),
            ]),
          }),
      });
  try {
    await client.connect(transport, { timeout: 10_000 });
    const provider = await createMcpToolCallbackProvider({
      mcpClients: [adaptSdkClient(client, { title: name })],
      toolFilter: (_connection, tool) => !server.disabledTools?.includes(tool.name),
      // Local tool context stays with the host.
      toolContextToMcpMetaConverter: () => ({}),
    });
    return { tools: provider.getToolCallbacks(), close: () => client.close() };
  } catch (error) {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    throw error;
  }
}

/** Resolve only this working directory's plugin, without user/global discovery. */
export function loadLegalPlugin(workspace = process.cwd()): AgentPlugin {
  const preferred = resolve(workspace, '.agents/plugin');
  const directory = existsSync(preferred) ? preferred : resolve(workspace, '.agents/plugins/legal');
  // Discover this plugin's skill manifests; file tools remain bounded to the workspace.
  const plugins = loadPluginsDirectory(directory);
  const plugin = plugins.find((plugin) => ['legal', 'legal-plugin'].includes(plugin.name));
  if (!plugin?.skillsDirectory) throw new Error(`Expected legal plugin skills under ${directory}`);
  return plugin;
}

export interface LegalAgentOptions {
  conversationMemory?: ChatMemory;
  conversationId?: string;
  workspace?: string;
  mcp?: boolean;
  connectMcp?: typeof connectPluginMcp;
  onWarning?: (message: string) => void;
}

/** The caller supplies inference; tests can inject FakeChatModel. */
export async function createLegalAgent(chatModel: ChatModel, options: LegalAgentOptions = {}) {
  const workspace = resolve(options.workspace ?? process.cwd());
  const plugin = loadLegalPlugin(workspace);
  const skillsDirectory = plugin.skillsDirectory;
  if (!skillsDirectory) throw new Error('Legal plugin has no skills');
  const sessions: PluginMcpSession[] = [];
  const warnings: string[] = [];
  const close = async () => {
    const closing = sessions.splice(0);
    await Promise.allSettled(closing.map((session) => session.close()));
  };
  try {
    if (options.mcp !== false) {
      for (const [name, server] of Object.entries(plugin.mcpConfig?.mcpServers ?? {})) {
        if (server.disabled) continue;
        try {
          sessions.push(await (options.connectMcp ?? connectPluginMcp)(name, server, plugin));
        } catch (error) {
          const warning = `MCP ${name} unavailable: ${error instanceof Error ? error.message : String(error)}. Use the plugin's local/GitHub fallback.`;
          warnings.push(warning);
          options.onWarning?.(warning);
        }
      }
    }
    const bundle = createSkillsAgentBundle({
      chatModel,
      conversationMemory: options.conversationMemory,
      defaultConversationId: options.conversationId,
      advisors: [caseDataAdvisor(workspace)],
      workspace,
      sourceMode: 'replace',
      directories: [skillsDirectory],
      system: [...plugin.rules.map((rule) => rule.content), ...warnings].join('\n\n'),
      extraTools: sessions.flatMap((session) => session.tools),
      instructionDiscovery: { workingDirectory: resolve(workspace, '.agents') },
      semanticDiscovery: false,
      shell: false,
      task: false,
      write: true,
      web: { fetch: true, search: false },
      memories: false,
      todos: false,
    });
    return { ...bundle, plugin, warnings, workspace, close };
  } catch (error) {
    await close();
    throw error;
  }
}
