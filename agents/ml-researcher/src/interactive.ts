import { createTerminal } from '@di-framework/tui';
import { CHAT_HELP, type ChatTerminal, runChat } from '@di-framework/tui/core';
import type { MlResearcherSession } from './agent.ts';
import { createMlResearcherCommands, RESEARCH_STAGES } from './commands.ts';
export async function runInteractive(
  session: MlResearcherSession,
  terminal: ChatTerminal = createTerminal(),
) {
  await runChat(
    {
      chat: (message, options) => session.agent.chat(message, options),
      clearHistory: () => session.clearHistory(),
      close: () => session.close(),
    },
    terminal,
    {
      title: 'ML researcher · di-framework-ml + di-framework',
      help: [
        'Describe an objective, or use /build to create and evaluate a model.',
        ...RESEARCH_STAGES.map(([name, description]) => `/${name.padEnd(12)}${description}`),
        '/status       Show run details',
        CHAT_HELP,
      ].join('\n'),
      clearMessage: 'Conversation cleared; research artifacts and worktrees are preserved.',
      cancelledMessage:
        'Request cancelled. Partial artifacts and code changes are preserved; inspect /status before continuing.',
      commands: [...createMlResearcherCommands(session)],
    },
  );
}
