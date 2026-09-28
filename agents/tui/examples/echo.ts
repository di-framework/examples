import { CHAT_HELP, createTerminal, runChat } from '../src/index.ts';

await runChat(
  {
    async chat(message, { signal }) {
      signal.throwIfAborted();
      return { content: `You said:\n\n${message}` };
    },
    clearHistory() {},
  },
  createTerminal(),
  { title: 'Shared TUI · echo demo', help: CHAT_HELP },
);
