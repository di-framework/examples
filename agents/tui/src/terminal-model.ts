import { BUILTIN_COMMANDS } from './commands.ts';
import type { ChatTerminal, CommandSuggestion, MessageRole } from './types.ts';

export interface ChatMessage {
  id: number;
  role: MessageRole;
  content: string;
}

export interface TerminalSnapshot {
  messages: readonly ChatMessage[];
  prompt: string;
  status: string | null;
  inputEnded: boolean;
  closed: boolean;
  commands: readonly CommandSuggestion[];
}

/** Observable state and an input queue, independent of React and process globals. */
export function createTerminalModel() {
  let snapshot: TerminalSnapshot = {
    messages: [],
    prompt: 'You> ',
    status: null,
    inputEnded: false,
    closed: false,
    commands: BUILTIN_COMMANDS,
  };
  const listeners = new Set<() => void>();
  const interrupts = new Set<() => void>();
  const lines: string[] = [];
  let pending: ((line: string | null) => void) | undefined;
  let nextId = 0;
  const update = (patch: Partial<TerminalSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };
  const append = (content: string, role: MessageRole) => {
    update({
      messages: [...snapshot.messages, { id: nextId++, content, role }],
    });
  };
  const resolvePending = (line: string | null) => {
    const resolve = pending;
    pending = undefined;
    resolve?.(line);
  };
  const terminal: ChatTerminal = {
    async readLine(prompt) {
      if (snapshot.closed) return null;
      if (pending) throw new Error('Only one readLine may be pending');
      update({ prompt });
      if (lines.length) return lines.shift()!;
      if (snapshot.inputEnded) return null;
      return new Promise<string | null>((resolve) => {
        pending = resolve;
      });
    },
    write(text, options) {
      if (!snapshot.closed) append(text, options?.role ?? 'info');
    },
    setStatus(status) {
      if (!snapshot.closed) update({ status });
    },
    setCommands(commands) {
      if (!snapshot.closed) update({ commands: commands.map((command) => ({ ...command })) });
    },
    onInterrupt(handler) {
      interrupts.add(handler);
      return () => {
        interrupts.delete(handler);
      };
    },
    close() {
      if (snapshot.closed) return;
      lines.length = 0;
      resolvePending(null);
      interrupts.clear();
      update({ closed: true, inputEnded: true, status: null });
    },
  };
  return {
    terminal,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    submit(line: string) {
      if (snapshot.closed || snapshot.inputEnded) return;
      append(line, 'user');
      if (pending) resolvePending(line);
      else lines.push(line);
    },
    interrupt() {
      for (const handler of interrupts) handler();
    },
    endInput() {
      if (snapshot.closed || snapshot.inputEnded) return;
      update({ inputEnded: true });
      resolvePending(null);
    },
  };
}

export type TerminalModel = ReturnType<typeof createTerminalModel>;
