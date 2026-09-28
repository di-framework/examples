# Shared agent TUI

`@di-framework/tui` is a Bun/TypeScript workspace package used by the legal and
baseball agents. It adapts gsio's Ink/React Markdown renderer, input component,
and chat presentation. See [source attribution](NOTICE.md).

From the repository root:

```sh
bun install
bun run --cwd packages/tui demo
bun run --cwd packages/tui test
bun run --cwd packages/tui typecheck
```

The echo demo needs no credentials or model connection. Both agents use the
same UI through their existing `bun start` commands. Interactive terminals get
Ink rendering; redirected or piped streams use readline and plain text.
`createTerminal({ mode: 'plain' })` forces the plain adapter.

In the Ink UI, type `/` to open the command picker and keep typing to filter
by prefix. Use ↑/↓ to select a command and Tab or Enter to complete it. Press
Enter again to submit. Escape dismisses the picker. Commands that take
arguments complete with a trailing space. In `/paste` mode the picker offers
`/send`, `/cancel`, and the exit commands.

```ts
import { CHAT_HELP, createTerminal, runChat } from "@di-framework/tui";

await runChat(
  {
    chat: (message, options) => agent.chat(message, options),
    clearHistory: () => memory.clear(),
    close: () => agent.close(),
  },
  createTerminal(),
  {
    title: "My agent",
    help: CHAT_HELP,
    commands: [
      {
        name: "/status",
        description: "Check current status",
        run: async (_args, { signal, setStatus }) => {
          setStatus("Fetching status…");
          return await fetchStatus(signal);
        },
      },
    ],
  },
);
```

`/help`, `/clear`, `/paste`, `/exit`, and `/quit` are built in. Custom command
handlers receive the remaining arguments, an abort signal, a status callback,
and a writer. Returned strings become Markdown assistant messages; `write`
defaults to plain informational text. Add custom command descriptions to
`help`. `/clear` clears agent history; the visible terminal transcript remains.
Command `description` and optional `arguments` (for example, `'PATH'`) also
populate the shared picker. `runChat` sends these suggestions through the
optional `ChatTerminal.setCommands` interface; agents need no picker logic.

Enter submits; Alt+Enter (or Shift+Enter when reported by the terminal) inserts
a newline. Pasted multiline text stays one draft. `/paste` and `/send` also
work with readline. Arrow keys move the cursor; Backspace erases left; Ctrl+A/E
move to the start/end; Ctrl+U/K erase to the start/end. Ink 4 reports the Delete
and usual Backspace keys alike, so both erase left; Ctrl+D erases right when
there is text, and ends input when empty. Ctrl+C cancels a running request or
exits at the prompt. Cancellation is cooperative: callbacks must honor the
signal to stop promptly; late results are suppressed. Submitted lines queue
while a request runs, and EOF drains that queue before cleanup.

## Testable boundaries

- **Controller:** `runChat` depends only on `ChatSession` and `ChatTerminal`.
  It serializes turns, routes commands, handles errors/cancellation, and calls
  the optional session `close` exactly once. Omit `close` when the caller owns
  the resource lifecycle.
- **State:** `createTerminalModel` is an observable input queue and transcript
  with no React or process dependency. `editInput` is a pure reducer.
- **Adapters:** `createReadlineTerminal` accepts streams and an optional signal
  source. `createTerminal` supplies process defaults and chooses Ink/readline.
- **Views:** `Markdown`, `UserInput`, `MessageView`, and `ChatView` are exported
  from `@di-framework/tui/components`. The views do not call an agent.

Tests can import `@di-framework/tui/core` without loading React/Ink:

```ts
const model = createTerminalModel();
model.submit("hello");
model.endInput();
await runChat(fakeSession, model.terminal, { title: "Test", help: "" });
const replies = model
  .getSnapshot()
  .messages.filter((m) => m.role === "assistant");
```

The package tests use deferred promises for deterministic in-flight
cancellation, injected streams for EOF/queue behavior, and Ink's testing
library for actual key bindings and rendering. The agent integration tests
cover case commands and photo/video drafts without network calls.

This is a private source package for the Bun workspace. Publishing compiled
JavaScript, model streaming, gsio's audio, TODO storage, and configuration menu
are outside its current API.
