import { afterEach, expect, test } from 'bun:test';
import { cleanup, render } from 'ink-testing-library';
import React from 'react';
import { ChatView } from '../src/components.ts';
import { createTerminalModel, runChat } from '../src/core.ts';

afterEach(cleanup);
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('Ink input reaches the injected model, including DEL backspace and multiline paste', async () => {
  const model = createTerminalModel();
  const view = render(<ChatView model={model} />);
  await flush();
  const line = model.terminal.readLine('You> ');
  view.stdin.write('hellx');
  view.stdin.write('\x7f');
  view.stdin.write('o\nworld');
  view.stdin.write('\r');
  expect(await line).toBe('hello\nworld');
  model.terminal.write('**A reply**', { role: 'assistant' });
  await flush();
  expect(view.frames.join('\n')).toContain('A reply');
});

test('Ctrl+C interrupts and Ctrl+D resolves EOF through the actual Ink bindings', async () => {
  const model = createTerminalModel();
  let interrupts = 0;
  model.terminal.onInterrupt(() => {
    interrupts++;
  });
  const view = render(<ChatView model={model} />);
  await flush();
  view.stdin.write('\x03');
  expect(interrupts).toBe(1);
  const line = model.terminal.readLine('You> ');
  view.stdin.write('\x04');
  expect(await line).toBeNull();
});

test('Ink shows filtered commands, follows arrows, and completes with Tab and Enter before submitting', async () => {
  const model = createTerminalModel();
  model.terminal.setCommands?.([
    { name: '/intake', description: 'Start intake' },
    { name: '/issues', description: 'Identify issues' },
    { name: '/help', description: 'Show commands' },
  ]);
  const view = render(<ChatView model={model} />);
  await flush();
  view.stdin.write('/');
  await flush();
  expect(view.lastFrame()).toContain('❯ /intake');
  expect(view.lastFrame()).toContain('/help');
  view.stdin.write('i');
  view.stdin.write('\x1b[B');
  await flush();
  expect(view.lastFrame()).toContain('❯ /issues');
  expect(view.lastFrame()).not.toContain('/help');
  view.stdin.write('\x1b[A');
  view.stdin.write('\t');
  await flush();
  expect(view.lastFrame()).toContain('You> /intake');
  expect(view.lastFrame()).not.toContain('Tab/Enter complete');
  expect(model.getSnapshot().messages).toHaveLength(0);
  const first = model.terminal.readLine('You> ');
  view.stdin.write('\r');
  expect(await first).toBe('/intake');

  view.stdin.write('/he');
  view.stdin.write('\r');
  expect(model.getSnapshot().messages).toHaveLength(1);
  const second = model.terminal.readLine('You> ');
  view.stdin.write('\r');
  expect(await second).toBe('/help');
});

test('controller supplies custom commands and switches suggestions for multiline drafts', async () => {
  const model = createTerminalModel();
  const view = render(<ChatView model={model} />);
  const prompts: string[] = [];
  const task = runChat(
    {
      async chat(message) {
        prompts.push(message);
        return { content: 'reply' };
      },
      clearHistory() {},
    },
    model.terminal,
    {
      title: 'Test',
      help: '',
      commands: [{ name: '/intake', description: 'Begin intake', run: () => 'intake' }],
    },
  );
  await flush();
  view.stdin.write('/');
  await flush();
  expect(view.lastFrame()).toContain('Begin intake');
  view.stdin.write('paste');
  view.stdin.write('\r');
  view.stdin.write('\r');
  await flush();
  expect(model.getSnapshot().commands.map(({ name }) => name)).toEqual([
    '/send',
    '/cancel',
    '/exit',
    '/quit',
  ]);
  view.stdin.write('draft text');
  view.stdin.write('\r');
  await flush();
  view.stdin.write('/s');
  view.stdin.write('\t');
  view.stdin.write('\r');
  await flush();
  expect(prompts).toEqual(['draft text']);
  expect(model.getSnapshot().commands.some(({ name }) => name === '/intake')).toBe(true);
  model.endInput();
  await task;
});
