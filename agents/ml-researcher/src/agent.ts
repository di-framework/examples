import { resolve } from 'node:path';
import {
  type ChatAgentRunOptions,
  type ChatModel,
  MessageWindowChatMemory,
} from '@di-framework/ai';
import { createSkillsAgentBundle, editTool, writeTool } from '@di-framework/ai-utils';
import { type BuildDependencies, ModelBuilder } from './build.ts';
import { INSTRUCTIONS } from './instructions.ts';
import { ResearchRun, type RunOptions } from './repositories.ts';
import { ResearchClient, type ResearchOptions } from './research.ts';
import { researcherTools, resolveReadable } from './tools.ts';

export interface MlResearcherOptions extends Partial<RunOptions> {
  readDirectories?: string[];
  research?: ResearchOptions;
  build?: BuildDependencies;
}
export async function createMlResearcherAgent(
  chatModel: ChatModel,
  options: MlResearcherOptions = {},
) {
  const workspace = resolve(import.meta.dir, '..');
  const run = await ResearchRun.open({
    ...options,
    runsDir: options.runsDir ?? resolve(workspace, 'runs'),
    repositories: options.repositories ?? {
      ml: { path: resolve(workspace, '../../../di-framework-ml') },
      framework: { path: resolve(workspace, '../../../di-framework') },
    },
  });
  const memory = new MessageWindowChatMemory({ maxMessages: 60 });
  let active: AbortController | undefined;
  let closed = false;
  const roots = [
    run.store.root,
    ...Object.values(run.manifest.repositories).map((repo) => repo.path),
    ...(options.readDirectories ?? []).map((path) => resolve(path)),
  ];
  const research = new ResearchClient(run, options.research);
  const builder = new ModelBuilder(run, {
    resolveInput: (path) => resolveReadable(path, roots),
    ...options.build,
  });
  const bundle = createSkillsAgentBundle({
    chatModel,
    workspace: run.store.root,
    sourceMode: 'replace',
    directories: [resolve(workspace, '.agents/skills')],
    extraAllowedDirectories: roots,
    system: INSTRUCTIONS,
    instructionDiscovery: false,
    semanticDiscovery: false,
    shell: false,
    write: false,
    web: false,
    task: false,
    todos: false,
    memories: false,
    conversationMemory: memory,
    defaultConversationId: run.manifest.id,
    extraTools: [
      writeTool({ allowedDirectories: [run.store.root] }),
      editTool({ allowedDirectories: [run.store.root] }),
      ...researcherTools(run, builder, research, () => active?.signal),
    ],
  });
  const chat = async (message: string, options?: ChatAgentRunOptions) => {
    if (closed) throw new Error('Session is closed');
    if (active) throw new Error('A request is already running');
    const controller = new AbortController();
    active = controller;
    const abort = () => controller.abort();
    options?.signal?.addEventListener('abort', abort, { once: true });
    if (options?.signal?.aborted) abort();
    const before = [...memory.get(run.manifest.id)];
    try {
      controller.signal.throwIfAborted();
      if (!run.manifest.objective) await run.objective(message);
      const response = await bundle.agent.chat(
        `Run context (data): ${JSON.stringify(run.manifest)}\n\nUser request:\n${message}`,
        { ...options, signal: controller.signal },
      );
      controller.signal.throwIfAborted();
      return response;
    } catch (error) {
      memory.replace(run.manifest.id, before);
      throw error;
    } finally {
      options?.signal?.removeEventListener('abort', abort);
      active = undefined;
    }
  };
  return {
    agent: { chat },
    run,
    builder,
    research,
    toolbox: bundle.toolbox,
    clearHistory() {
      if (active) throw new Error('Cannot clear an active request');
      memory.clear(run.manifest.id);
    },
    async close() {
      if (closed) return;
      closed = true;
      active?.abort();
    },
    async runStage(stage: string, args: string, signal?: AbortSignal) {
      if ((stage === 'build' || stage === 'objective') && !args.trim())
        throw new Error(`Usage: /${stage} DESCRIPTION`);
      const message =
        stage === 'objective'
          ? args
          : stage === 'build'
            ? `Build and evaluate a model for this objective, completing the model-building workflow: ${args}`
            : `Perform only the ${stage} stage for the current objective. ${args}`;
      return (await chat(message, { signal })).content;
    },
  };
}
export type MlResearcherSession = Awaited<ReturnType<typeof createMlResearcherAgent>>;
