import type { ChatAgentRunOptions } from '@di-framework/ai';
import { createTerminal } from '@di-framework/tui';
import { CHAT_HELP, type ChatTerminal, runChat } from '@di-framework/tui/core';
import {
  type BaseballCommandSession,
  createBaseballCommands,
  createSpectatorCommands,
  type SpectatorCommandSession,
} from './commands.ts';

export const HELP = `Tell me about your team, paste postgame stats, or ask for a season report.
/video PATH  Watch the first two minutes of recorded game footage and review plays
/photo PATH  Read a scorebook photo with AI vision and review its draft
${CHAT_HELP}`;

export const SPECTATOR_HELP = `I am an AI baseball spectator. I record what I see from game footage into a durable log.
/record PATH  Record a finished game file
/live [demo|URL]  Live from OBS (default LIVE_URL from .env) until you cancel
/video PATH   Quick sample (first two minutes)
Ask about the current recording after /record or /live. Season bookkeeping is not part of this spectator.
${CHAT_HELP}`;

export interface BaseballSession extends BaseballCommandSession {
  agent: {
    chat(message: string, options?: ChatAgentRunOptions): Promise<{ content: string }>;
  };
  clearHistory(): void;
}

export interface SpectatorSession extends SpectatorCommandSession {
  agent: {
    chat(message: string, options?: ChatAgentRunOptions): Promise<{ content: string }>;
  };
  clearHistory(): void;
}

export async function runInteractive(
  session: BaseballSession,
  terminal: ChatTerminal = createTerminal(),
) {
  await runChat(
    {
      chat: (message, settings) => session.agent.chat(message, settings),
      clearHistory: () => session.clearHistory(),
    },
    terminal,
    {
      title: 'Baseball stats agent',
      help: HELP,
      clearMessage: 'Chat cleared; saved stats remain.',
      cancelledMessage: 'Cancelled. Check saved records before repeating an entry.',
      commands: [...createBaseballCommands(session)],
    },
  );
}

export async function runSpectatorInteractive(
  session: SpectatorSession,
  terminal: ChatTerminal = createTerminal(),
) {
  await runChat(
    {
      chat: (message, settings) => session.agent.chat(message, settings),
      clearHistory: () => session.clearHistory(),
    },
    terminal,
    {
      title: 'Baseball spectator',
      help: SPECTATOR_HELP,
      clearMessage: 'Chat cleared; current game log remains until /record again.',
      cancelledMessage: 'Cancelled. Partial recordings may be incomplete.',
      commands: [...createSpectatorCommands(session)],
    },
  );
}
