export type MessageRole = 'user' | 'assistant' | 'info' | 'error';

export interface WriteOptions {
  role?: MessageRole;
}

/** The controller's only dependency on a user interface. */
export interface ChatTerminal {
  readLine(prompt: string): Promise<string | null>;
  write(text: string, options?: WriteOptions): void;
  onInterrupt(handler: () => void): () => void;
  close(): void;
  setStatus?(text: string | null): void;
  setCommands?(commands: readonly CommandSuggestion[]): void;
}

export interface ChatSession {
  chat(message: string, options: { signal: AbortSignal }): Promise<{ content: string }>;
  clearHistory(): void | Promise<void>;
  /** If supplied, runChat owns cleanup and calls this once. */
  close?(): void | Promise<void>;
}

export interface CommandContext {
  signal: AbortSignal;
  write(text: string, options?: WriteOptions): void;
  setStatus(text: string): void;
}

export interface CommandSuggestion {
  name: `/${string}`;
  description?: string;
  /** Argument hint shown in the picker; completion leaves a space for input. */
  arguments?: string;
}

export interface ChatCommand extends CommandSuggestion {
  run(args: string, context: CommandContext): Promise<string | void> | string | void;
}

export interface ChatOptions {
  title: string;
  help: string;
  commands?: readonly ChatCommand[];
  initialMessage?: string;
  clearMessage?: string;
  cancelledMessage?: string;
}
