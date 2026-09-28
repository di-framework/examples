import { expect, test } from 'bun:test';
import {
  type CompletionState,
  commandSuggestions,
  completeInput,
  matchingCommands,
} from '../src/core.ts';

const commands = commandSuggestions([
  { name: '/intake', description: 'Start intake' },
  { name: '/issues', description: 'Identify issues' },
  { name: '/photo', arguments: 'PATH' },
]);
const state = (value: string): CompletionState => ({
  value,
  cursor: value.length,
  selected: 0,
});

test('slash opens the catalog; prefix filtering resets selection and ignores prose and arguments', () => {
  const opened = completeInput(state(''), '/', {}, commands).state;
  expect(matchingCommands(opened, commands)).toEqual(commands);
  const moved = completeInput(opened, '', { downArrow: true }, commands).state;
  const filtered = completeInput(moved, 'i', {}, commands).state;
  expect(filtered.selected).toBe(0);
  expect(matchingCommands(filtered, commands).map((command) => command.name)).toEqual([
    '/intake',
    '/issues',
  ]);
  for (const value of ['hello /', '/photo image.jpg', '/intake\nhello', '/unknown']) {
    expect(matchingCommands(state(value), commands)).toEqual([]);
  }
  expect(matchingCommands({ ...state('/intake'), cursor: 2 }, commands)).toEqual([]);
});

test('navigation wraps and Tab/Enter complete without submitting; the next Enter submits', () => {
  let selected = completeInput(state('/i'), '', { upArrow: true }, commands).state;
  expect(selected.selected).toBe(1);
  selected = completeInput(selected, '', { downArrow: true }, commands).state;
  expect(selected.selected).toBe(0);
  for (const key of [{ tab: true }, { return: true }]) {
    const completed = completeInput(selected, '', key, commands);
    expect(completed.action).toBeUndefined();
    expect(completed.state.value).toBe('/intake');
    expect(matchingCommands(completed.state, commands)).toEqual([]);
    const submitted = completeInput(completed.state, '', { return: true }, commands);
    expect(submitted.action).toBe('submit');
    expect(submitted.line).toBe('/intake');
  }
});

test('argument commands leave room for a path; editing and Escape dismissal remain usable', () => {
  const completed = completeInput(state('/ph'), '', { tab: true }, commands).state;
  expect(completed.value).toBe('/photo ');
  expect(completeInput(completed, 'game.jpg', {}, commands).state.value).toBe('/photo game.jpg');
  const dismissed = completeInput(state('/i'), '', { escape: true, meta: true }, commands).state;
  expect(matchingCommands(dismissed, commands)).toEqual([]);
  const edited = completeInput(dismissed, 's', {}, commands).state;
  expect(matchingCommands(edited, commands).map(({ name }) => name)).toEqual(['/issues']);
  expect(completeInput(state('/'), 'c', { ctrl: true }, commands).action).toBe('interrupt');
  expect(completeInput(state('/i'), '', { return: true, meta: true }, commands).state.value).toBe(
    '/i\n',
  );
});

test('draft mode offers only draft controls and exit commands; built-ins cannot be shadowed', () => {
  expect(commandSuggestions(commands, true).map(({ name }) => name)).toEqual([
    '/send',
    '/cancel',
    '/exit',
    '/quit',
  ]);
  const catalog = commandSuggestions([
    { name: '/help', description: 'wrong' },
    { name: '/test' },
    { name: '/test' },
  ]);
  expect(catalog.filter(({ name }) => name === '/test')).toHaveLength(1);
  expect(catalog.find(({ name }) => name === '/help')?.description).toBe('Show commands');
});
