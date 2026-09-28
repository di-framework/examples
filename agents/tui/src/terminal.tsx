import { render } from 'ink';
import React from 'react';
import { ChatView } from './chat-view.tsx';
import { createReadlineTerminal, type InterruptSource } from './readline-terminal.ts';
import { createTerminalModel } from './terminal-model.ts';
import type { ChatTerminal } from './types.ts';

export interface TerminalOptions {
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
  error?: NodeJS.WriteStream;
  interrupts?: InterruptSource;
  mode?: 'auto' | 'plain' | 'ink';
}

/** Composition root: process streams and Ink are selected only at the boundary. */
export function createTerminal(options: TerminalOptions = {}): ChatTerminal {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const interrupts = options.interrupts ?? process;
  const interactive = Boolean(input.isTTY && output.isTTY && input.setRawMode);
  if (options.mode === 'plain' || (options.mode !== 'ink' && !interactive)) {
    return createReadlineTerminal({ input, output, interrupts });
  }
  if (!interactive) throw new Error('Ink mode requires TTY input and output');
  const model = createTerminalModel();
  const app = render(<ChatView model={model} />, {
    stdin: input,
    stdout: output,
    stderr: options.error ?? process.stderr,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  const interrupt = () => model.interrupt();
  const end = () => model.endInput();
  interrupts.on('SIGINT', interrupt);
  input.on('end', end);
  let closed = false;
  return {
    ...model.terminal,
    close() {
      if (closed) return;
      closed = true;
      interrupts.off('SIGINT', interrupt);
      input.off('end', end);
      model.terminal.close();
      app.unmount();
    },
  };
}
