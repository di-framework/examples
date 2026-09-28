import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertProcess, runProcess } from '../src/process.ts';
import { ResearchRun } from '../src/repositories.ts';

export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ml-researcher-'));
  const git = async (cwd: string, args: string[]) =>
    assertProcess(await runProcess({ command: 'git', args, cwd })).stdout.trim();
  const ml = join(root, 'ml'),
    framework = join(root, 'framework.git');
  await mkdir(ml);
  await git(ml, ['init']);
  await git(ml, [
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '--allow-empty',
    '-m',
    'fixture',
  ]);
  await git(root, ['clone', '--bare', ml, framework]);
  const repositories = { ml: { path: ml }, framework: { path: framework } };
  const run = await ResearchRun.open({
    runsDir: join(root, 'runs'),
    repositories,
  });
  return { root, ml, framework, repositories, run, git };
}
