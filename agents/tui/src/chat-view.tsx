import { Box, Static, Text, useInput } from 'ink';
import React, { useRef, useState, useSyncExternalStore } from 'react';
import { CommandPicker } from './command-picker.tsx';
import { type CompletionState, completeInput, matchingCommands } from './completion.ts';
import { Markdown } from './markdown.tsx';
import type { ChatMessage, TerminalModel } from './terminal-model.ts';
import { UserInput } from './user-input.tsx';

/** Role styling and transcript layout extracted from gsio's chat screen. */
export function MessageView({ message }: { message: ChatMessage }) {
  const color = {
    user: 'green',
    assistant: 'yellow',
    info: 'gray',
    error: 'red',
  }[message.role];
  const label =
    message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Agent' : undefined;
  return (
    <Box flexDirection="column" marginBottom={1}>
      {label && (
        <Text color={color} bold>
          {label}:
        </Text>
      )}
      <Box flexDirection="column" marginLeft={label ? 2 : 0}>
        {message.role === 'assistant' ? (
          <Markdown content={message.content} color={color} />
        ) : (
          <Text color={color}>{message.content}</Text>
        )}
      </Box>
    </Box>
  );
}

export function ChatView({ model }: { model: TerminalModel }) {
  const snapshot = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const [editor, setEditor] = useState<CompletionState>({
    value: '',
    cursor: 0,
    selected: 0,
  });
  // Input may arrive several times before React commits a render.
  const currentEditor = useRef(editor);
  useInput(
    (input, key) => {
      const result = completeInput(currentEditor.current, input, key, model.getSnapshot().commands);
      currentEditor.current = result.state;
      setEditor(result.state);
      if (result.action === 'interrupt') model.interrupt();
      else if (result.action === 'end') model.endInput();
      else if (result.action === 'submit') model.submit(result.line!);
    },
    { isActive: !snapshot.closed && !snapshot.inputEnded },
  );

  return (
    <Box flexDirection="column">
      <Static items={[...snapshot.messages]}>
        {(message) => <MessageView key={message.id} message={message} />}
      </Static>
      {snapshot.status && <Text color="cyan">{snapshot.status}</Text>}
      {!snapshot.closed && !snapshot.inputEnded && (
        <>
          <UserInput {...editor} prompt={snapshot.prompt} />
          <CommandPicker
            commands={matchingCommands(editor, snapshot.commands)}
            selected={editor.selected}
          />
        </>
      )}
    </Box>
  );
}
