import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ChatModel, ChatResponse, type Prompt } from '@di-framework/ai';

/** Image-only adapter around Codex's native image input; no application tools are exposed. */
export class CodexVisionModel implements ChatModel {
  readonly options;
  constructor(
    private config: {
      model?: string;
      executable?: string;
      timeoutMs?: number;
    } = {},
  ) {
    this.options = { model: config.model };
  }

  async call(prompt: Prompt): Promise<ChatResponse> {
    if (prompt.options?.toolCallbacks?.length)
      throw new Error('Vision extraction cannot execute application tools');
    const timeoutMs = this.config.timeoutMs ?? 120_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
      throw new Error('Vision timeout must be positive');
    const signal = AbortSignal.any([
      AbortSignal.timeout(timeoutMs),
      ...(prompt.options?.signal ? [prompt.options.signal] : []),
    ]);
    signal.throwIfAborted();
    const directory = await mkdtemp(join(tmpdir(), 'baseball-vision-'));
    let child: ReturnType<typeof Bun.spawn> | undefined;
    const kill = () => {
      child?.kill('SIGKILL');
    };
    signal.addEventListener('abort', kill, { once: true });
    try {
      const args = [
        'exec',
        '--ignore-user-config',
        '--ephemeral',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '-c',
        'approval_policy="never"',
        '-c',
        'features.shell_tool=false',
        '-c',
        'web_search="disabled"',
        '--color',
        'never',
      ];
      const model = prompt.options?.model ?? this.config.model;
      if (model) args.push('--model', model);
      if (prompt.options?.outputSchema) {
        const path = join(directory, 'schema.json');
        await writeFile(path, prompt.options.outputSchema);
        args.push('--output-schema', path);
      }
      let count = 0;
      for (const message of prompt.messages) {
        if (!('media' in message)) continue;
        for (const image of message.media) {
          if (!(image.data instanceof Uint8Array))
            throw new Error('Vision images must be attached as bytes');
          const extension = {
            'image/png': 'png',
            'image/jpeg': 'jpg',
            'image/webp': 'webp',
          }[image.mimeType];
          if (!extension) throw new Error('Unsupported vision image type');
          const path = join(directory, `image-${count++}.${extension}`);
          await writeFile(path, image.data);
          args.push('--image', path);
        }
      }
      if (!count) throw new Error('Vision extraction requires an image attachment');
      args.push('-');
      signal.throwIfAborted();
      const handle = Bun.spawn([this.config.executable ?? 'codex', ...args], {
        cwd: directory,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      child = handle;
      handle.stdin.write(
        prompt.messages.map((m) => `${m.messageType}: ${m.text ?? ''}`).join('\n\n'),
      );
      handle.stdin.end();
      if (signal.aborted) kill();
      const boundedText = async (stream: ReadableStream<Uint8Array>) => {
        const reader = stream.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.length;
            if (length > 2 * 1024 * 1024) {
              kill();
              throw new Error('Vision response exceeded 2 MiB');
            }
            chunks.push(value);
          }
          return Buffer.concat(chunks).toString('utf8');
        } finally {
          reader.releaseLock();
        }
      };
      const [stdout, stderr, code] = await Promise.all([
        boundedText(child.stdout as ReadableStream<Uint8Array>),
        boundedText(child.stderr as ReadableStream<Uint8Array>),
        child.exited,
      ]);
      signal.throwIfAborted();
      if (code !== 0) throw new Error(`Vision model failed (exit ${code}): ${stderr.slice(-1000)}`);
      if (!stdout.trim()) throw new Error('Vision model returned no transcription');
      return ChatResponse.of(stdout.trim(), {
        model: model ?? 'Codex CLI default',
      });
    } finally {
      signal.removeEventListener('abort', kill);
      kill();
      if (child) await child.exited;
      await rm(directory, { recursive: true, force: true });
    }
  }
}
