import { afterEach, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ChatResponse,
  FakeChatModel,
  OpenAiChatModel,
  Prompt,
  userMessage,
} from '@di-framework/ai';
import { createBaseballAgent } from './agent.ts';
import { CodexVisionModel } from './codex-vision.ts';
import { readImage, readScorebook } from './vision.ts';

const directories: string[] = [];
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/zQAAAAASUVORK5CYII=',
  'base64',
);
const draft = {
  teamName: 'Owls',
  date: null,
  opponent: 'Foxes',
  runsFor: 5,
  runsAgainst: 3,
  players: [
    {
      name: 'Alex',
      number: '7',
      batting: null,
      pitching: null,
      fielding: null,
      pitchCount: 38,
    },
  ],
  warnings: ['Date is unreadable. Only pitch counts were supplied.'],
};
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'baseball-photo-test-'));
  directories.push(dir);
  const path = join(dir, 'score sheet.png');
  writeFileSync(path, png);
  return { dir, path };
}
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

test('passes image bytes to vision and preserves uncertain values with source hash', async () => {
  const { path } = fixture();
  const model = new FakeChatModel((prompt) => {
    const user = prompt.messages.find((m) => m.messageType === 'user');
    expect(user?.media[0]?.data).toEqual(png);
    expect(user?.media[0]?.mimeType).toBe('image/png');
    expect(prompt.options?.toolCallbacks).toBeUndefined();
    expect(prompt.options?.outputSchema).toContain('warnings');
    return ChatResponse.of(JSON.stringify(draft));
  });
  const result = await readScorebook(model, path);
  expect(result.reviewRequired).toBe(true);
  expect(result.date).toBeNull();
  expect(result.players[0]?.pitchCount).toBe(38);
  expect(result.source).toMatch(/SHA-256 [a-f0-9]{64}$/);
});

test('rejects nonimages, oversized files, malformed responses, and cancelled requests', async () => {
  const { dir, path } = fixture();
  const bad = join(dir, 'fake.png');
  writeFileSync(bad, 'not an image');
  await expect(readImage(bad)).rejects.toThrow('PNG, JPEG, or WebP');
  const tooLarge = join(dir, 'large.png');
  writeFileSync(tooLarge, Buffer.alloc(20 * 1024 * 1024 + 1));
  await expect(readImage(tooLarge)).rejects.toThrow('20 MiB');
  await expect(
    readScorebook(new FakeChatModel(() => ChatResponse.of('not JSON')), path),
  ).rejects.toThrow('valid JSON');
  await expect(
    readScorebook(new FakeChatModel(() => ChatResponse.of('{"players":[]}')), path),
  ).rejects.toThrow('invalid scorebook');
  const model = new FakeChatModel();
  await expect(readScorebook(model, path, AbortSignal.abort())).rejects.toThrow();
  expect(model.calls).toHaveLength(0);
});

test('photo extraction performs no writes and enters chat only as an unverified draft', async () => {
  const { path } = fixture();
  const chat = new FakeChatModel((prompt) => {
    const messages = JSON.stringify(prompt.messages);
    expect(messages).toContain('Unverified photo draft');
    expect(messages).toContain('Date is unreadable');
    return ChatResponse.of('What date was this game?');
  });
  const baseball = createBaseballAgent(chat, {
    databasePath: ':memory:',
    visionModel: new FakeChatModel(() => ChatResponse.of(JSON.stringify(draft))),
  });
  try {
    await baseball.readPhoto(path);
    expect(baseball.store.listTeams()).toEqual([]);
    expect(chat.calls).toHaveLength(0);
    expect((await baseball.agent.chat('Review that scorebook')).content).toBe(
      'What date was this game?',
    );
    expect(baseball.store.listTeams()).toEqual([]);
  } finally {
    baseball.close();
  }
});

test('DI Framework API vision adapter serializes actual image content', async () => {
  const { path } = fixture();
  const model = new OpenAiChatModel({
    model: 'vision-test',
    apiKey: 'test-only',
    fetch: async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      expect(body.messages[1].content[1]).toEqual({
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${png.toString('base64')}`,
        },
      });
      expect(body.response_format.type).toBe('json_schema');
      return Response.json({
        id: 'test',
        model: 'vision-test',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: JSON.stringify(draft) },
            finish_reason: 'stop',
          },
        ],
      });
    },
  });
  expect((await readScorebook(model, path)).players[0]?.pitchCount).toBe(38);
});

test('Codex adapter attaches bytes, uses schema, disables shell, and cleans temp files', async () => {
  const { dir } = fixture();
  const executable = join(dir, 'codex-stub');
  writeFileSync(
    executable,
    `#!${process.execPath}
const args = process.argv.slice(2);
const imagePath = args[args.indexOf('--image') + 1];
const schemaPath = args[args.indexOf('--output-schema') + 1];
console.log(JSON.stringify({ args, directory: process.cwd(), input: await Bun.stdin.text(),
  image: Buffer.from(await Bun.file(imagePath).arrayBuffer()).toString('base64'),
  schema: await Bun.file(schemaPath).json() }));
`,
  );
  chmodSync(executable, 0o755);
  const model = new CodexVisionModel({ executable });
  const result = await model.call(
    new Prompt(
      [
        userMessage('Read this sheet', {
          media: [{ mimeType: 'image/png', data: png }],
        }),
      ],
      { outputSchema: '{"type":"object"}' },
    ),
  );
  const output = JSON.parse(result.content);
  expect(output.image).toBe(png.toString('base64'));
  expect(output.args).toContain('features.shell_tool=false');
  expect(output.args).toContain('--ignore-user-config');
  expect(output.schema).toEqual({ type: 'object' });
  expect(existsSync(output.directory)).toBe(false);
});

test('Codex vision timeout kills the subprocess', async () => {
  const { dir } = fixture();
  const executable = join(dir, 'codex-stall');
  writeFileSync(
    executable,
    `#!${process.execPath}\nawait new Promise(() => { setInterval(() => {}, 1000); });\n`,
  );
  chmodSync(executable, 0o755);
  const model = new CodexVisionModel({ executable, timeoutMs: 100 });
  const start = performance.now();
  const error = await model
    .call(
      new Prompt([
        userMessage('Read', {
          media: [{ mimeType: 'image/png', data: png }],
        }),
      ]),
    )
    .catch((error: unknown) => error);
  expect(error).toBeInstanceOf(Error);
  expect(performance.now() - start).toBeLessThan(3000);
});

test('terminal retains piped follow-up after an asynchronous photo read', async () => {
  const { dir, path } = fixture();
  const runner = join(dir, 'terminal.ts');
  writeFileSync(
    runner,
    `
import { runInteractive } from ${JSON.stringify(new URL('./interactive.ts', import.meta.url).pathname)};
const calls = [];
await runInteractive({
  agent: { async chat(message) { calls.push(message); return { content: 'FOLLOWUP_RECEIVED' }; } },
  async readPhoto(path) { await Bun.sleep(40); return { reviewRequired: true, path }; },
  clearHistory() {},
});
console.log(JSON.stringify(calls));
`,
  );
  const child = Bun.spawn([process.execPath, runner], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  child.stdin.write(`/photo ${path}\nThe date was September 12.\n/exit\n`);
  child.stdin.end();
  const [output, error, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(error).toBe('');
  expect(code).toBe(0);
  expect(output).toContain('Draft only; no stats saved.');
  expect(output).toContain('FOLLOWUP_RECEIVED');
  expect(output).toContain('["The date was September 12."]');
});
