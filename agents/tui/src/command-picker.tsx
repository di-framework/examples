import { Box, Text } from 'ink';
import React from 'react';
import type { CommandSuggestion } from './types.ts';

export function CommandPicker({
  commands,
  selected,
}: {
  commands: readonly CommandSuggestion[];
  selected: number;
}) {
  if (!commands.length) return null;
  const index = Math.max(0, Math.min(selected, commands.length - 1));
  // Keep long command lists compact while following keyboard selection.
  const start = Math.max(0, Math.min(index - 3, commands.length - 6));
  return (
    <Box flexDirection="column" marginLeft={2}>
      {commands.slice(start, start + 6).map((command, offset) => {
        const active = start + offset === index;
        return (
          <Text key={command.name} color={active ? 'cyan' : 'gray'} bold={active}>
            {active ? '❯ ' : '  '}
            {command.name}
            {command.arguments ? ` ${command.arguments}` : ''}
            {command.description ? `  ${command.description}` : ''}
          </Text>
        );
      })}
      <Text dimColor>
        ↑/↓ select · Tab/Enter complete · Esc dismiss
        {commands.length > 6 ? ` · ${index + 1}/${commands.length}` : ''}
      </Text>
    </Box>
  );
}
