import { expect, test } from 'bun:test';
import { editInput } from '../src/core.ts';

test('edits at the cursor, deletes backwards and forwards, and keeps emoji intact', () => {
  let state = { value: 'a😀b', cursor: 3 };
  state = editInput(state, '', { leftArrow: true }).state;
  expect(state.cursor).toBe(1);
  state = editInput(state, 'd', { ctrl: true }).state;
  expect(state).toEqual({ value: 'ab', cursor: 1 });
  state = editInput(state, '界', {}).state;
  expect(state).toEqual({ value: 'a界b', cursor: 2 });
  state = editInput(state, '', { delete: true }).state;
  expect(state).toEqual({ value: 'ab', cursor: 1 });
  expect(editInput({ value: 'a😀', cursor: 3 }, '', { backspace: true }).state).toEqual({
    value: 'a',
    cursor: 1,
  });
});

test('multiline paste stays a single draft until Enter', () => {
  const pasted = editInput({ value: '', cursor: 0 }, 'first\r\n/exit\nlast', {});
  expect(pasted.action).toBeUndefined();
  const result = editInput(pasted.state, '', { return: true });
  expect(result.line).toBe('first\n/exit\nlast');
  expect(result.action).toBe('submit');
  expect(result.state.value).toBe('');
});

test('supports newline, line editing, interrupt, EOF, and rejects escape sequences', () => {
  const state = { value: 'hello world', cursor: 5 };
  expect(editInput(state, '', { return: true, meta: true }).state.value).toBe('hello\n world');
  expect(editInput(state, 'u', { ctrl: true }).state.value).toBe(' world');
  expect(editInput(state, 'k', { ctrl: true }).state.value).toBe('hello');
  expect(editInput(state, 'a', { ctrl: true }).state.cursor).toBe(0);
  expect(editInput(state, 'e', { ctrl: true }).state.cursor).toBe(11);
  expect(editInput(state, 'c', { ctrl: true }).action).toBe('interrupt');
  expect(editInput({ value: '', cursor: 0 }, 'd', { ctrl: true }).action).toBe('end');
  expect(editInput(state, '\u001b[99~', {}).state).toEqual(state);
});
