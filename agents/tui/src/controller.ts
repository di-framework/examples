import { commandSuggestions } from './commands.ts';
import type { ChatOptions, ChatSession, ChatTerminal, CommandContext } from './types.ts';

export const CHAT_HELP = [
  '/clear    Clear this session’s conversation history',
  '/paste    Compose multiple lines; /send submits, /cancel discards',
  '/help     Show commands',
  '/exit     Close the session',
  'Ctrl+C cancels a running request; at the prompt it exits. Ctrl+D ends input.',
].join('\n');

/** Serializes turns; neither the model nor the renderer owns command routing. */
export async function runChat(
  session: ChatSession,
  terminal: ChatTerminal,
  options: ChatOptions,
): Promise<void> {
  let stopped = false;
  let active: AbortController | undefined;
  let removeInterrupt = () => {};
  const status = (text: string | null) => {
    if (terminal.setStatus) terminal.setStatus(text);
    else if (text) terminal.write(text);
  };
  const perform = async (
    work: (context: CommandContext) => Promise<string | void> | string | void,
  ) => {
    const controller = new AbortController();
    active = controller;
    try {
      status('Working…');
      const result = await work({
        signal: controller.signal,
        write: (text, settings) => {
          if (!controller.signal.aborted) terminal.write(text, settings);
        },
        setStatus: (text) => {
          if (!controller.signal.aborted) status(text);
        },
      });
      controller.signal.throwIfAborted();
      if (typeof result === 'string') terminal.write(result, { role: 'assistant' });
    } catch (error) {
      terminal.write(
        controller.signal.aborted
          ? (options.cancelledMessage ?? 'Request cancelled.')
          : `Request failed: ${error instanceof Error ? error.message : String(error)}`,
        { role: 'error' },
      );
    } finally {
      active = undefined;
      status(null);
    }
  };
  const respond = (message: string) =>
    perform(async ({ signal }) => {
      const result = await session.chat(message, { signal });
      return result.content;
    });

  try {
    removeInterrupt = terminal.onInterrupt(() => {
      if (active) active.abort();
      else {
        stopped = true;
        terminal.close();
      }
    });
    terminal.setCommands?.(commandSuggestions(options.commands));
    terminal.write(`${options.title}\n${options.help}`);
    if (options.initialMessage !== undefined) await respond(options.initialMessage);
    let draft: string[] | undefined;
    while (!stopped) {
      terminal.setCommands?.(commandSuggestions(options.commands, Boolean(draft)));
      const line = await terminal.readLine(draft ? '... ' : 'You> ');
      if (line === null || stopped) break;
      const command = line.trim();
      if (command === '/exit' || command === '/quit') break;
      if (draft) {
        if (command === '/cancel') {
          draft = undefined;
          terminal.write('Draft discarded.');
        } else if (command === '/send') {
          const message = draft.join('\n').trim();
          draft = undefined;
          if (message) await respond(message);
        } else draft.push(line);
        continue;
      }
      if (!command) continue;
      switch (command) {
        case '/help':
          terminal.write(options.help);
          break;
        case '/clear':
          await perform(async () => {
            await session.clearHistory();
            terminal.write(options.clearMessage ?? 'Conversation history cleared.');
          });
          break;
        case '/paste':
          draft = [];
          terminal.write('Enter lines, then /send. Use /cancel to discard.');
          break;
        default: {
          if (!command.startsWith('/')) {
            await respond(line);
            break;
          }
          const name = command.split(/\s/, 1)[0];
          const handler = options.commands?.find((entry) => entry.name === name);
          if (handler)
            await perform((context) =>
              handler.run(command.slice(handler.name.length).trim(), context),
            );
          else terminal.write('Unknown command. Use /help.');
        }
      }
    }
  } finally {
    // A failed terminal cleanup must not leak the agent's resources.
    try {
      removeInterrupt();
    } finally {
      try {
        terminal.close();
      } finally {
        await session.close?.();
      }
    }
  }
}
