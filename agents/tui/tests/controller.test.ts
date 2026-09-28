import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  type ChatSession,
  createReadlineTerminal,
  createTerminalModel,
  runChat,
} from '../src/core.ts';

const options = { title: 'Test agent', help: 'Test help' };
const session = (overrides: Partial<ChatSession> = {}): ChatSession => ({
  async chat(message) {
    return { content: `reply: ${message}` };
  },
  clearHistory() {},
  ...overrides,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('routes commands, preserves multiline content, and treats draft commands as text', async () => {
  const model = createTerminalModel();
  const prompts: string[] = [];
  let clears = 0;
  let closes = 0;
  for (const line of [
    '',
    '/help',
    '/paste',
    'first',
    '/custom literal',
    '/send',
    '/paste',
    'discard',
    '/cancel',
    '/custom args',
    '/clear',
    '/unknown',
    '  hello  ',
    '/exit',
    'ignored',
  ])
    model.submit(line);
  await runChat(
    session({
      async chat(message) {
        prompts.push(message);
        return { content: 'ok' };
      },
      clearHistory() {
        clears++;
      },
      close() {
        closes++;
      },
    }),
    model.terminal,
    {
      ...options,
      commands: [{ name: '/custom', run: (args) => `custom: ${args}` }],
    },
  );
  expect(prompts).toEqual(['first\n/custom literal', '  hello  ']);
  expect(clears).toBe(1);
  expect(closes).toBe(1);
  expect(model.getSnapshot().closed).toBe(true);
  const messages = model.getSnapshot().messages.map((message) => message.content);
  expect(messages).toContain('custom: args');
  expect(messages).toContain('Unknown command. Use /help.');
  expect(messages).toContain('Draft discarded.');
});

test('cancellation suppresses late replies and progress, then permits another turn', async () => {
  const model = createTerminalModel();
  const started = deferred<void>();
  const finish = deferred<void>();
  let signal: AbortSignal | undefined;
  model.submit('/slow');
  model.submit('next');
  model.endInput();
  const task = runChat(session(), model.terminal, {
    ...options,
    commands: [
      {
        name: '/slow',
        async run(_, context) {
          signal = context.signal;
          started.resolve();
          await finish.promise;
          context.write('stale progress');
          context.setStatus('stale status');
          return 'stale reply';
        },
      },
    ],
  });
  await started.promise;
  model.interrupt();
  expect(signal?.aborted).toBe(true);
  finish.resolve();
  await task;
  const messages = model.getSnapshot().messages.map((message) => message.content);
  expect(messages).toContain('Request cancelled.');
  expect(messages).toContain('reply: next');
  expect(messages.join('\n')).not.toContain('stale');
  expect(model.getSnapshot().status).toBeNull();
});

test('provider and history errors recover, including a failed initial turn', async () => {
  const model = createTerminalModel();
  model.submit('/clear');
  model.submit('continue');
  model.endInput();
  await runChat(
    session({
      async chat(message) {
        if (message === 'start') throw new Error('offline');
        return { content: 'recovered' };
      },
      clearHistory() {
        throw new Error('history unavailable');
      },
    }),
    model.terminal,
    { ...options, initialMessage: 'start' },
  );
  const output = model.getSnapshot().messages.map((message) => message.content);
  expect(output).toContain('Request failed: offline');
  expect(output).toContain('Request failed: history unavailable');
  expect(output).toContain('recovered');
});

test('idle interrupt resolves the pending read and closes the session once', async () => {
  const model = createTerminalModel();
  let closed = 0;
  const task = runChat(
    session({
      close() {
        closed++;
      },
    }),
    model.terminal,
    options,
  );
  model.interrupt();
  await task;
  model.interrupt();
  expect(closed).toBe(1);
  expect(await model.terminal.readLine('again')).toBeNull();
});

test('cleans up the session even when terminal setup or cleanup fails', async () => {
  for (const phase of ['setup', 'read', 'close']) {
    const model = createTerminalModel();
    let closed = 0;
    model.endInput();
    const terminal = { ...model.terminal };
    if (phase === 'setup')
      terminal.onInterrupt = () => {
        throw new Error(phase);
      };
    if (phase === 'read')
      terminal.readLine = async () => {
        throw new Error(phase);
      };
    if (phase === 'close')
      terminal.close = () => {
        throw new Error(phase);
      };
    await expect(
      runChat(
        session({
          close() {
            closed++;
          },
        }),
        terminal,
        options,
      ),
    ).rejects.toThrow(phase);
    expect(closed).toBe(1);
  }
});

test('readline queues piped input while busy, drains at EOF, and removes signal handlers', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const interrupts = new EventEmitter();
  let transcript = '';
  output.on('data', (data) => {
    transcript += data;
  });
  const terminal = createReadlineTerminal({ input, output, interrupts });
  const started = deferred<void>();
  const finish = deferred<void>();
  const prompts: string[] = [];
  const task = runChat(
    session({
      async chat(message) {
        prompts.push(message);
        if (message === 'first') {
          started.resolve();
          await finish.promise;
        }
        return { content: message };
      },
    }),
    terminal,
    options,
  );
  input.write('first\n');
  await started.promise;
  input.end('second\nthird\n');
  finish.resolve();
  await task;
  expect(prompts).toEqual(['first', 'second', 'third']);
  expect(transcript).toContain('third');
  expect(transcript).not.toContain('\u001b');
  expect(interrupts.listenerCount('SIGINT')).toBe(0);
});

test('redirected output stays plain even with TTY input, and SIGINT releases a pending read', async () => {
  const input = Object.assign(new PassThrough(), { isTTY: true });
  const output = new PassThrough();
  const interrupts = new EventEmitter();
  let transcript = '';
  output.on('data', (data) => {
    transcript += data;
  });
  const terminal = createReadlineTerminal({ input, output, interrupts });
  let closed = 0;
  const task = runChat(
    session({
      close() {
        closed++;
      },
    }),
    terminal,
    options,
  );
  interrupts.emit('SIGINT');
  await task;
  expect(closed).toBe(1);
  expect(transcript).not.toContain('You>');
  expect(transcript).not.toContain('\u001b');
  expect(interrupts.listenerCount('SIGINT')).toBe(0);
});
