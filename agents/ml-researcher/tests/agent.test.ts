import { afterEach, expect, test } from 'bun:test';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ChatResponse, FakeChatModel, toolCall, toolCallResponse } from '@di-framework/ai';
import { createTerminalModel } from '@di-framework/tui/core';
import { createMlResearcherAgent } from '../src/agent.ts';
import { runInteractive } from '../src/interactive.ts';
import { ResearchClient } from '../src/research.ts';
import { fixture } from './helpers.ts';

const temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});

test('real skill/tool loop writes research notes with injected inference and recovers after history reset', async () => {
  const f = await fixture();
  temporary.push(f.root);
  let step = 0;
  const model = new FakeChatModel(() => {
    if (step++ === 0)
      return toolCallResponse([toolCall('skill', 'Skill', { command: 'ml-research' })]);
    if (step === 2)
      return toolCallResponse([
        toolCall('save', 'SaveNote', {
          path: 'findings.md',
          content: 'A fixture hypothesis.',
        }),
      ]);
    return ChatResponse.of('Saved findings.');
  });
  const agent = await createMlResearcherAgent(model, {
    runsDir: join(f.root, 'agent-runs'),
    repositories: f.repositories,
  });
  expect((await agent.agent.chat('Investigate a fixture')).content).toBe('Saved findings.');
  expect(await agent.run.store.read('notes/findings.md')).toContain('hypothesis');
  expect(agent.toolbox.runtime.activeSkill()?.name).toBe('ml-research');
  agent.clearHistory();
  await agent.agent.chat('Read the saved findings');
  expect(agent.run.manifest.objective).toBe('Investigate a fixture');
  await agent.close();
  await agent.close();
});

test('shared commands populate typeahead and /clear preserves artifacts', async () => {
  const f = await fixture();
  temporary.push(f.root);
  const agent = await createMlResearcherAgent(
    new FakeChatModel(() => ChatResponse.of('Need a dataset and target.')),
    { runsDir: join(f.root, 'agent-runs'), repositories: f.repositories },
  );
  const terminal = createTerminalModel();
  const names: string[] = [];
  terminal.subscribe(() => {
    names.push(...terminal.getSnapshot().commands.map(({ name }) => name));
  });
  for (const line of ['/build classify readings', '/status', '/clear', '/exit'])
    terminal.submit(line);
  await runInteractive(agent, terminal.terminal);
  expect(names).toContain('/build');
  expect(names).toContain('/verify');
  expect(agent.run.manifest.objective).toContain('classify readings');
  expect(terminal.getSnapshot().messages.some(({ content }) => content.includes('preserved'))).toBe(
    true,
  );
});

test('Hub uses argv and records sources, while missing web credentials leave other sources usable', async () => {
  const f = await fixture();
  temporary.push(f.root);
  const requests: unknown[] = [];
  const agent = await createMlResearcherAgent(new FakeChatModel(), {
    runsDir: join(f.root, 'agent-runs'),
    repositories: f.repositories,
    runner: async (request) => {
      requests.push(request);
      return {
        code: 0,
        stdout: '{"title":"Paper"}',
        stderr: '',
        cancelled: false,
        timedOut: false,
        truncated: false,
        durationMs: 1,
      };
    },
    research: {
      braveApiKey: '',
      fetch: async () => new Response('Official documentation'),
    },
  });
  const source = await agent.research.query({
    kind: 'papers',
    action: 'search',
    query: 'model; echo bad',
  });
  expect(JSON.stringify(requests)).toContain('model; echo bad');
  expect(source.url).toContain('huggingface.co');
  expect(await agent.run.store.read(`sources/${source.id}.json`)).toContain('accessedAt');
  await expect(
    agent.research.query({ kind: 'web', action: 'search', query: 'test' }),
  ).rejects.toThrow('BRAVE');
  expect(
    (
      await agent.research.query({
        kind: 'url',
        action: 'read',
        query: 'https://example.test/docs',
      })
    ).content,
  ).toBe('Official documentation');
  await agent.close();
});

test('agent researches, edits a prepared repository, executes verification, and saves a report', async () => {
  const f = await fixture();
  temporary.push(f.root);
  let step = 0;
  let agent: Awaited<ReturnType<typeof createMlResearcherAgent>>;
  const model = new FakeChatModel(() => {
    switch (step++) {
      case 0:
        return toolCallResponse([
          toolCall('source', 'Research', {
            kind: 'url',
            action: 'read',
            query: 'https://example.test/official',
          }),
        ]);
      case 1:
        return toolCallResponse([toolCall('repo', 'Repository', { target: 'ml' })]);
      case 2:
        return toolCallResponse([
          toolCall('write', 'Write', {
            filePath: join(agent.run.manifest.worktrees.ml!.path, 'fixture.txt'),
            content: 'verified fixture',
          }),
        ]);
      case 3:
        return toolCallResponse([
          toolCall('check', 'Execute', {
            target: 'ml',
            command: process.execPath,
            args: [
              '-e',
              'if (await Bun.file("fixture.txt").text() !== "verified fixture") process.exit(1)',
            ],
          }),
        ]);
      case 4:
        return toolCallResponse([
          toolCall('report', 'SaveNote', {
            path: 'report.md',
            content: 'Fixture implementation checked.',
          }),
        ]);
      default:
        return ChatResponse.of('Completed.');
    }
  });
  agent = await createMlResearcherAgent(model, {
    runsDir: join(f.root, 'end-to-end'),
    repositories: f.repositories,
    research: { fetch: async () => new Response('Primary source fixture') },
  });
  await agent.agent.chat('Implement the fixture and verify it.');
  expect(await readFile(join(agent.run.manifest.worktrees.ml!.path, 'fixture.txt'), 'utf8')).toBe(
    'verified fixture',
  );
  const logs = await readdir(join(agent.run.store.root, 'logs'));
  const records = await Promise.all(
    logs.map((name) => agent.run.store.read(`logs/${name}`).then((text) => JSON.parse(text))),
  );
  expect(
    records.some((record) => record.command === process.execPath && record.result?.code === 0),
  ).toBe(true);
  expect(await agent.run.store.read('notes/report.md')).toContain('checked');
  await agent.close();
});

test('tool cancellation preserves saved files and permits a fresh conversation turn', async () => {
  const f = await fixture();
  temporary.push(f.root);
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let step = 0;
  const model = new FakeChatModel(() => {
    if (step++ === 0)
      return toolCallResponse([
        toolCall('save', 'SaveNote', {
          path: 'partial.md',
          content: 'Evidence collected before cancellation.',
        }),
      ]);
    if (step === 2)
      return toolCallResponse([
        toolCall('long', 'Execute', {
          target: 'run',
          command: 'fixture-command',
          args: [],
        }),
      ]);
    return ChatResponse.of('Recovered.');
  });
  const agent = await createMlResearcherAgent(model, {
    runsDir: join(f.root, 'cancel'),
    repositories: f.repositories,
    runner: async (request) => {
      started();
      await new Promise<void>((resolve) => {
        if (request.signal?.aborted) resolve();
        else
          request.signal?.addEventListener('abort', () => resolve(), {
            once: true,
          });
      });
      return {
        code: null,
        stdout: '',
        stderr: '',
        cancelled: true,
        timedOut: false,
        durationMs: 1,
        truncated: false,
      };
    },
  });
  const controller = new AbortController();
  const pending = agent.agent.chat('Collect evidence and run a check', {
    signal: controller.signal,
  });
  const outcome = pending.then(
    () => 'unexpected-success',
    () => 'cancelled',
  );
  await ready;
  controller.abort();
  expect(await outcome).toBe('cancelled');
  expect(await agent.run.store.read('notes/partial.md')).toContain('Evidence');
  expect((await agent.agent.chat('Continue from saved evidence')).content).toBe('Recovered.');
  await agent.close();
});
