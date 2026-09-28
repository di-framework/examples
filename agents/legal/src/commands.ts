import type { ChatCommand, ChatSession } from '@di-framework/tui/core';
import { CASE_WORKFLOW } from './case-workflow.ts';

/** Inject only the chat capability needed by the case commands. */
export function createLegalCommands(agent: Pick<ChatSession, 'chat'>): ChatCommand[] {
  return CASE_WORKFLOW.map(({ command, description }) => ({
    name: command,
    description,
    async run(args, { signal }) {
      if (args) throw new Error(`${command} does not accept arguments; answer questions in chat.`);
      const result = await agent.chat(command, { signal });
      return result.content;
    },
  }));
}
