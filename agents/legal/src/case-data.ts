import { open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  copyChatClientRequest,
  createBeforeAfterAdvisor,
  DEFAULT_TOOL_CALLING_ORDER,
  Prompt,
  userMessage,
} from '@di-framework/ai';

export const CASE_DATA_PATH = 'case-data/README.md';
const MAX_CASE_DATA_BYTES = 64 * 1024;

/** Missing intake is allowed; malformed or unreadable intake must not be silently omitted. */
export async function readCaseData(workspace: string): Promise<string | undefined> {
  const root = await realpath(workspace);
  let path: string;
  try {
    path = await realpath(resolve(root, CASE_DATA_PATH));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const within = relative(root, path);
  if (isAbsolute(within) || within === '..' || within.startsWith('../'))
    throw new Error(`${CASE_DATA_PATH} must remain inside the agent workspace`);
  const file = await open(path, 'r');
  try {
    if (!(await file.stat()).isFile()) throw new Error(`${CASE_DATA_PATH} must be a regular file`);
    const buffer = Buffer.alloc(MAX_CASE_DATA_BYTES + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const chunk = await file.read(buffer, bytes, buffer.length - bytes, null);
      if (chunk.bytesRead === 0) break;
      bytes += chunk.bytesRead;
    }
    if (bytes > MAX_CASE_DATA_BYTES)
      throw new Error(
        `${CASE_DATA_PATH} exceeds 64 KiB; keep the summary here and link supporting documents`,
      );
    return buffer.subarray(0, bytes).toString('utf8');
  } finally {
    await file.close();
  }
}

/** Refresh once per chat request, before the tool loop, keeping case facts out of system rules. */
export function caseDataAdvisor(workspace: string) {
  return createBeforeAfterAdvisor({
    name: 'Case data intake',
    order: DEFAULT_TOOL_CALLING_ORDER - 1,
    async before(request) {
      const text = await readCaseData(workspace);
      if (!text?.trim()) return request;
      const context = userMessage(JSON.stringify({ source: CASE_DATA_PATH, text }));
      const messages = [...request.prompt.messages];
      const index = messages.findIndex((message) => message.messageType === 'user');
      messages.splice(index < 0 ? messages.length : index, 0, context);
      return copyChatClientRequest(request, {
        prompt: new Prompt(messages, request.prompt.options),
      });
    },
  });
}
