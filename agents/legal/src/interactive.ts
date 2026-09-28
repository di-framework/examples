import type { ChatAgentRunOptions } from '@di-framework/ai';
import { CHAT_HELP, type ChatTerminal, runChat } from '@di-framework/tui/core';
import { CASE_WORKFLOW, CASE_WORKFLOW_SEQUENCE } from './case-workflow.ts';
import { createLegalCommands } from './commands.ts';

export type { ChatTerminal } from '@di-framework/tui/core';

export interface InteractiveAgent {
  agent: {
    chat(message: string, options?: ChatAgentRunOptions): Promise<{ content: string }>;
  };
  clearHistory(): void | Promise<void>;
  close(): Promise<void>;
}

const HELP = [
  'Type a message and press Enter.',
  `Case workflow: ${CASE_WORKFLOW_SEQUENCE}`,
  ...CASE_WORKFLOW.map((step) => `${step.command.padEnd(10)}${step.description}`),
  'Run one stage at a time. Answer questions in chat; revisit any stage when facts change.',
  CHAT_HELP,
].join('\n');

/** Case commands remain agent policy; shared TUI owns input and lifecycle. */
export async function runInteractive(
  session: InteractiveAgent,
  terminal: ChatTerminal,
  options: { intake?: boolean } = {},
): Promise<void> {
  await runChat(
    {
      chat: (message, settings) => session.agent.chat(message, settings),
      clearHistory: () => session.clearHistory(),
      close: () => session.close(),
    },
    terminal,
    {
      title: 'Legal agent · Codex subscription',
      help: HELP,
      initialMessage: options.intake ? '/intake' : undefined,
      clearMessage: 'Conversation history cleared. Case data and plugin tools remain available.',
      commands: [...createLegalCommands(session.agent)],
    },
  );
}
