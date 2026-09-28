import { type EditorKey, type EditorResult, type EditorState, editInput } from './editor.ts';
import type { CommandSuggestion } from './types.ts';

export interface CompletionState extends EditorState {
  selected: number;
  dismissedValue?: string;
}

export function matchingCommands(
  state: CompletionState,
  commands: readonly CommandSuggestion[],
): readonly CommandSuggestion[] {
  if (
    state.dismissedValue === state.value ||
    state.cursor !== state.value.length ||
    !/^\/[^\s/]*$/.test(state.value)
  )
    return [];
  return commands.filter(({ name }) => name.startsWith(state.value));
}

/** Pure keyboard state machine; completing a command never submits it. */
export function completeInput(
  state: CompletionState,
  input: string,
  key: EditorKey,
  commands: readonly CommandSuggestion[],
): Omit<EditorResult, 'state'> & { state: CompletionState } {
  const matches = matchingCommands(state, commands);
  const selected = Math.max(0, Math.min(state.selected, matches.length - 1));
  if (matches.length && !key.ctrl && !key.meta && !key.shift) {
    if (key.upArrow || key.downArrow) {
      return {
        state: {
          ...state,
          selected: (selected + (key.upArrow ? -1 : 1) + matches.length) % matches.length,
        },
      };
    }
    if (key.tab || key.return) {
      const command = matches[selected]!;
      const value = command.name + (command.arguments ? ' ' : '');
      return {
        state: {
          value,
          cursor: value.length,
          selected: 0,
          dismissedValue: value,
        },
      };
    }
  }
  // Ink marks Escape as a meta key, so handle dismissal independently.
  if (matches.length && key.escape) return { state: { ...state, dismissedValue: state.value } };
  const result = editInput(state, input, key);
  return {
    ...result,
    state: {
      ...result.state,
      selected: result.state.value === state.value ? selected : 0,
      dismissedValue: result.state.value === state.value ? state.dismissedValue : undefined,
    },
  };
}
