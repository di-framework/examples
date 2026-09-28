import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { ChatTerminal } from './types.ts';

export interface InterruptSource {
  on(event: 'SIGINT', listener: () => void): unknown;
  off(event: 'SIGINT', listener: () => void): unknown;
}

export interface ReadlineOptions {
  input: Readable & { isTTY?: boolean };
  output: Writable & { isTTY?: boolean };
  interrupts?: InterruptSource;
}

/** The eagerly created iterator queues pasted/piped lines during model turns. */
export function createReadlineTerminal({
  input,
  output,
  interrupts,
}: ReadlineOptions): ChatTerminal {
  const interactive = Boolean(input.isTTY && output.isTTY);
  const readline = createInterface({
    input,
    output,
    terminal: interactive,
    crlfDelay: Infinity,
  });
  const lines = readline[Symbol.asyncIterator]();
  const cleanups = new Set<() => void>();
  let closed = false;
  return {
    async readLine(prompt) {
      if (closed) return null;
      if (interactive) {
        readline.setPrompt(prompt);
        readline.prompt();
      }
      const result = await lines.next();
      return closed || result.done ? null : result.value;
    },
    write(text, options) {
      output.write(`${options?.role === 'assistant' ? 'Agent: ' : ''}${text}\n\n`);
    },
    onInterrupt(handler) {
      readline.on('SIGINT', handler);
      interrupts?.on('SIGINT', handler);
      const remove = () => {
        readline.off('SIGINT', handler);
        interrupts?.off('SIGINT', handler);
        cleanups.delete(remove);
      };
      cleanups.add(remove);
      return remove;
    },
    close() {
      if (closed) return;
      closed = true;
      for (const remove of cleanups) remove();
      readline.close();
    },
  };
}
