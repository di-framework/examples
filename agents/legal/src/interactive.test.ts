import { expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { ChatResponse, FakeChatModel, MessageWindowChatMemory } from '@di-framework/ai';
import { createLegalAgent } from './agent.ts';
import { type ChatTerminal, type InteractiveAgent, runInteractive } from './interactive.ts';
import { createTerminal } from './terminal.ts';

function terminal(lines: string[]) {
  const output: string[] = [];
  let interrupt = () => {};
  let closed = false;
  const io: ChatTerminal = {
    readLine: async () => (closed ? null : (lines.shift() ?? null)),
    write: (text) => {
      output.push(text);
    },
    onInterrupt: (handler) => {
      interrupt = handler;
      return () => {
        interrupt = () => {};
      };
    },
    close: () => {
      closed = true;
    },
  };
  return {
    io,
    output,
    interrupt: () => interrupt(),
    get closed() {
      return closed;
    },
  };
}

test('interactive commands submit intake, follow-up and multiline turns and close once', async () => {
  const ui = terminal([
    '',
    '/help',
    '/intake',
    'The state is Virginia.',
    '/paste',
    'First line',
    'Second line',
    '/send',
    '/paste',
    'discard',
    '/cancel',
    '/clear',
    '/unknown',
    '/exit',
    'never sent',
  ]);
  const prompts: string[] = [];
  let cleared = 0;
  let closed = 0;
  await runInteractive(
    {
      agent: {
        chat: async (message) => {
          prompts.push(message);
          return { content: 'reply' };
        },
      },
      clearHistory: () => {
        cleared++;
      },
      close: async () => {
        closed++;
      },
    },
    ui.io,
  );
  expect(prompts).toEqual(['/intake', 'The state is Virginia.', 'First line\nSecond line']);
  expect(cleared).toBe(1);
  expect(closed).toBe(1);
  expect(ui.closed).toBe(true);
  expect(ui.output.some((text) => text.includes('Unknown command'))).toBe(true);
});

test('cancellation and provider errors leave the loop usable', async () => {
  const ui = terminal(['cancel this', 'fail this', 'continue', '/exit']);
  const prompts: string[] = [];
  await runInteractive(
    {
      agent: {
        chat: async (message, options) => {
          prompts.push(message);
          if (message === 'cancel this') {
            queueMicrotask(ui.interrupt);
            await new Promise((_, reject) =>
              options?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), {
                once: true,
              }),
            );
          }
          if (message === 'fail this') throw new Error('provider unavailable');
          return { content: 'continued' };
        },
      },
      clearHistory: () => {},
      close: async () => {},
    },
    ui.io,
  );
  expect(prompts).toEqual(['cancel this', 'fail this', 'continue']);
  expect(ui.output).toContain('Request cancelled.');
  expect(ui.output).toContain('Request failed: provider unavailable');
  expect(ui.output).toContain('continued');
});

test('real readline retains piped lines while responses are pending and exits on EOF', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  const io = createTerminal(input, output);
  const prompts: string[] = [];
  let closed = 0;
  const session: InteractiveAgent = {
    agent: {
      chat: async (message) => {
        prompts.push(message);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { content: 'reply' };
      },
    },
    clearHistory: () => {},
    close: async () => {
      closed++;
    },
  };
  const task = runInteractive(session, io);
  input.end('First\nSecond\n');
  await task;
  expect(prompts).toEqual(['First', 'Second']);
  expect(closed).toBe(1);
});

test('intake startup is followed by interactive answers', async () => {
  const ui = terminal(['Virginia', '/exit']);
  const prompts: string[] = [];
  await runInteractive(
    {
      agent: {
        chat: async (message) => {
          prompts.push(message);
          return { content: 'reply' };
        },
      },
      clearHistory: () => {},
      close: async () => {},
    },
    ui.io,
    { intake: true },
  );
  expect(prompts).toEqual(['/intake', 'Virginia']);
});

test('session memory retains exchanges without retaining stale case-data snapshots', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'legal-interactive-'));
  await mkdir(join(workspace, '.agents/plugin'), { recursive: true });
  await cp(
    resolve(import.meta.dir, '../.agents/plugins/legal'),
    join(workspace, '.agents/plugin/legal'),
    { recursive: true },
  );
  await mkdir(join(workspace, 'case-data'));
  const caseFile = join(workspace, 'case-data/README.md');
  await writeFile(caseFile, 'Initial case data');
  const memory = new MessageWindowChatMemory({ maxMessages: 40 });
  const model = new FakeChatModel((prompt) =>
    ChatResponse.of(prompt.getUserMessage().text === 'Begin intake' ? 'Which state?' : 'Recorded.'),
  );
  const legal = await createLegalAgent(model, {
    workspace,
    mcp: false,
    conversationMemory: memory,
    conversationId: 'session',
  });
  try {
    await legal.agent.chat('Begin intake');
    await writeFile(caseFile, 'Updated case data');
    await legal.agent.chat('Virginia');
    const prompt = model.calls[1];
    expect(prompt?.messages.some((message) => message.text === 'Begin intake')).toBe(true);
    expect(prompt?.messages.some((message) => message.text === 'Which state?')).toBe(true);
    const source = prompt?.messages.filter((message) =>
      message.text?.includes('"source":"case-data/README.md"'),
    );
    expect(source).toHaveLength(1);
    expect(source?.[0]?.text).toContain('Updated case data');
    expect(JSON.stringify(prompt?.messages)).not.toContain('Initial case data');
    expect(JSON.stringify(memory.get('session'))).not.toContain('case-data/README.md');
    memory.clear('session');
    await legal.agent.chat('Start fresh');
    expect(model.calls[2]?.messages.some((message) => message.text === 'Virginia')).toBe(false);
  } finally {
    await legal.close();
    await rm(workspace, { recursive: true, force: true });
  }
});
