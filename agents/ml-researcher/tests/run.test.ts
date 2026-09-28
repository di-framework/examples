import { afterEach, expect, test } from 'bun:test';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { safePath } from '../src/artifacts.ts';
import { runProcess } from '../src/process.ts';
import { ResearchRun } from '../src/repositories.ts';
import { fixture } from './helpers.ts';

const temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});

test('normal and bare repositories create pinned worktrees, preserve source changes, and resume', async () => {
  const f = await fixture();
  temporary.push(f.root);
  await writeFile(join(f.ml, 'uncommitted.txt'), 'keep');
  const ml = await f.run.prepare('ml');
  const framework = await f.run.prepare('framework');
  expect(ml.commit).toBe(framework.commit);
  expect(await readFile(join(f.ml, 'uncommitted.txt'), 'utf8')).toBe('keep');
  await expect(readFile(join(ml.path, 'uncommitted.txt'))).rejects.toThrow();
  await writeFile(join(ml.path, 'change.txt'), 'task change');
  const resumed = await ResearchRun.open({
    runsDir: join(f.root, 'runs'),
    repositories: f.repositories,
    resume: f.run.manifest.id,
  });
  expect((await resumed.prepare('ml')).path).toBe(ml.path);
  expect(await readFile(join(ml.path, 'change.txt'), 'utf8')).toBe('task change');
  await f.git(ml.path, ['checkout', '-b', 'wrong-branch']);
  await expect(
    ResearchRun.open({
      runsDir: join(f.root, 'runs'),
      repositories: f.repositories,
      resume: f.run.manifest.id,
    }),
  ).rejects.toThrow('branch');
});

test('untracked source instructions and skills remain discoverable, including missing references', async () => {
  const f = await fixture();
  temporary.push(f.root);
  await mkdir(join(f.ml, '.agents/skills/local'), { recursive: true });
  await writeFile(
    join(f.ml, 'AGENTS.md'),
    'Read `docs/missing.md` before claiming the roadmap complete.',
  );
  await writeFile(
    join(f.ml, '.agents/skills/local/SKILL.md'),
    '---\nname: local\ndescription: fixture\n---\nLocal guidance',
  );
  const guidance = await f.run.guidance('ml');
  expect(
    guidance.records.some(
      (record) => record.content.includes('Local guidance') && record.provenance === 'source-local',
    ),
  ).toBe(true);
  expect(guidance.warnings).toContain('Referenced guidance missing: docs/missing.md');
});

test('artifact paths reject traversal and symlink escapes', async () => {
  const f = await fixture();
  temporary.push(f.root);
  await expect(safePath(f.run.store.root, '../escape')).rejects.toThrow('outside');
  await symlink(f.ml, join(f.run.store.root, 'escape'));
  await expect(f.run.store.write('escape/wrong.txt', 'bad')).rejects.toThrow('Symlink');
});

test('process timeouts and aborts terminate descendants and bound output', async () => {
  const timeout = await runProcess({
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    cwd: process.cwd(),
    timeoutMs: 40,
  });
  expect(timeout.timedOut).toBe(true);
  const controller = new AbortController();
  const task = runProcess({
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    cwd: process.cwd(),
    signal: controller.signal,
  });
  controller.abort();
  expect((await task).cancelled).toBe(true);
  const output = await runProcess({
    command: process.execPath,
    args: ['-e', 'process.stdout.write("x".repeat(100000))'],
    cwd: process.cwd(),
  });
  expect(output.stdout).toHaveLength(65_536);
  expect(output.truncated).toBe(true);
});

test('resume recovers a worktree created just before an interrupted Git response', async () => {
  const f = await fixture();
  temporary.push(f.root);
  const run = await ResearchRun.open({
    runsDir: join(f.root, 'recovery'),
    repositories: f.repositories,
    runner: async (request) => {
      const result = await runProcess(request);
      if (request.args[0] === 'worktree' && request.args[1] === 'add')
        throw new Error('Interrupted after creation');
      return result;
    },
  });
  await expect(run.prepare('ml')).rejects.toThrow('Interrupted');
  expect(run.manifest.worktrees.ml?.state).toBe('preparing');
  const resumed = await ResearchRun.open({
    runsDir: join(f.root, 'recovery'),
    repositories: f.repositories,
    resume: run.manifest.id,
  });
  expect((await resumed.prepare('ml')).state).toBe('ready');
});

test('timeout kills a descendant that ignores SIGTERM', async () => {
  const f = await fixture();
  temporary.push(f.root);
  const pidPath = join(f.root, 'child.pid');
  const code = `const {spawn} = require('node:child_process'); spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)', process.argv[1]], {stdio:'inherit'}); setInterval(() => {}, 1000);`;
  const result = await runProcess({
    command: process.execPath,
    args: ['-e', code, pidPath],
    cwd: f.root,
    timeoutMs: 500,
  });
  expect(result.timedOut).toBe(true);
  const pid = Number(await readFile(pidPath, 'utf8'));
  // Give the OS a chance to reap the orphan after the process group is killed.
  let alive = true;
  for (let attempt = 0; attempt < 50 && alive; attempt++) {
    try {
      process.kill(pid, 0);
      await Bun.sleep(10);
    } catch {
      alive = false;
    }
  }
  expect(alive).toBe(false);
});
