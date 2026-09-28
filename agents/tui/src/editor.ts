/** Pure input reducer adapted from gsio's chat.tsx editing controls. */
export interface EditorState {
  value: string;
  cursor: number;
}
export interface EditorKey {
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  return?: boolean;
  backspace?: boolean;
  delete?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  escape?: boolean;
  tab?: boolean;
}
export interface EditorResult {
  state: EditorState;
  action?: 'submit' | 'interrupt' | 'end';
  line?: string;
}

// Move by Unicode code point, so ordinary emoji are not split into surrogates.
const previous = (value: string, cursor: number) =>
  cursor - ([...value.slice(0, cursor)].at(-1)?.length ?? 0);
const next = (value: string, cursor: number) => cursor + ([...value.slice(cursor)][0]?.length ?? 0);

export function editInput(state: EditorState, input: string, key: EditorKey): EditorResult {
  const { value } = state;
  const cursor = Math.max(0, Math.min(state.cursor, value.length));
  const at = (position: number): EditorResult => ({
    state: { value, cursor: position },
  });
  const replace = (start: number, end: number, text = ''): EditorResult => ({
    state: {
      value: value.slice(0, start) + text + value.slice(end),
      cursor: start + text.length,
    },
  });
  if (key.ctrl && input === 'c') return { state, action: 'interrupt' };
  if (key.ctrl && input === 'd' && !value) return { state, action: 'end' };
  if (key.return) {
    if (key.shift || key.meta) return replace(cursor, cursor, '\n');
    return { state: { value: '', cursor: 0 }, action: 'submit', line: value };
  }
  if (key.ctrl && input === 'a') return at(0);
  if (key.ctrl && input === 'e') return at(value.length);
  if (key.ctrl && input === 'u') return replace(0, cursor);
  if (key.ctrl && input === 'k') return replace(cursor, value.length);
  if (key.leftArrow) return at(previous(value, cursor));
  if (key.rightArrow) return at(next(value, cursor));
  // Ink 4 reports the usual terminal Backspace (DEL) as `delete`.
  if (key.backspace || key.delete || (key.ctrl && input === 'h'))
    return replace(previous(value, cursor), cursor);
  if (key.ctrl && input === 'd') return replace(cursor, next(value, cursor));
  if (key.ctrl || key.meta || key.escape || key.upArrow || key.downArrow) return { state };
  // Multi-line paste is inserted as text, never executed as a series of commands.
  const text = input.replace(/\r\n?/g, '\n');
  if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(text)) return { state };
  return replace(cursor, cursor, key.tab ? '\t' : text);
}
