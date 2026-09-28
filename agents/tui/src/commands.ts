import type { CommandSuggestion } from './types.ts';

const EXIT_COMMANDS: readonly CommandSuggestion[] = [
  { name: '/exit', description: 'Close the session' },
  { name: '/quit', description: 'Close the session (alias)' },
];

export const BUILTIN_COMMANDS: readonly CommandSuggestion[] = [
  { name: '/clear', description: 'Clear conversation history' },
  { name: '/paste', description: 'Compose multiple lines' },
  { name: '/help', description: 'Show commands' },
  ...EXIT_COMMANDS,
];

/** Completion follows the controller's available commands in each input mode. */
export function commandSuggestions(
  custom: readonly CommandSuggestion[] = [],
  draft = false,
): readonly CommandSuggestion[] {
  if (draft)
    return [
      { name: '/send', description: 'Submit the multiline draft' },
      { name: '/cancel', description: 'Discard the multiline draft' },
      ...EXIT_COMMANDS,
    ];
  const seen = new Set(BUILTIN_COMMANDS.map(({ name }) => name));
  const commands: CommandSuggestion[] = [];
  for (const { name, description, arguments: args } of custom) {
    if (seen.has(name)) continue;
    seen.add(name);
    commands.push({ name, description, arguments: args });
  }
  return [...commands, ...BUILTIN_COMMANDS];
}
