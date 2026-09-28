// Adapted from gsio src/userInput.tsx (MIT); see ../NOTICE.md.

import { Box, Newline, Text } from 'ink';
import React from 'react';

export type UserInputProps = {
  value: string;
  cursor: number;
  debug?: boolean;
  prompt?: string;
  lastInput?: string;
  lastFlags?: string;
  lastAction?: string;
};

export const UserInput = ({
  value,
  cursor,
  debug = false,
  prompt = '> ',
  lastInput,
  lastFlags,
  lastAction,
}: UserInputProps) => {
  const left = value.slice(0, cursor);
  const right = value.slice(cursor);

  return (
    <Box flexDirection="column" flexShrink={0} marginTop={1}>
      <Text>
        <Text color="magenta">{prompt}</Text>
        {left}
        <Text color="magenta">|</Text>
        {right}
      </Text>

      {debug && (
        <>
          <Newline />
          <Text color="gray">[debug] input: {lastInput}</Text>
          <Text color="gray">[debug] flags: {lastFlags}</Text>
          <Text color="gray">[debug] action: {lastAction}</Text>
          <Text color="gray">
            [debug] cursor: {cursor}/{value.length}
          </Text>
        </>
      )}
    </Box>
  );
};
