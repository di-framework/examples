import { lstat, mkdir, readdir, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { type ArtifactStore, FileArtifacts, identifier, json, safePath } from './artifacts.ts';
import { assertProcess, type ProcessRequest, type ProcessRunner, runProcess } from './process.ts';

export type Target = 'ml' | 'framework';
export interface Repository {
  path: string;
  ref?: string;
}
export interface Worktree {
  source: string;
  path: string;
  commit: string;
  branch: string;
  state?: 'preparing' | 'ready';
}
export interface RunManifest {
  id: string;
  createdAt: string;
  objective?: string;
  repositories: Record<Target, Repository>;
  worktrees: Partial<Record<Target, Worktree>>;
}
export interface RunOptions {
  runsDir: string;
  repositories: Record<Target, Repository>;
  resume?: string;
  runner?: ProcessRunner;
  timeoutMs?: number;
  artifacts?: (root: string) => ArtifactStore;
}

export class ResearchRun {
  private preparing = new Map<Target, Promise<Worktree>>();
  private journal: Promise<unknown> = Promise.resolve();
  private constructor(
    readonly manifest: RunManifest,
    readonly store: ArtifactStore,
    private readonly runner: ProcessRunner,
    readonly timeoutMs: number,
  ) {}

  static async open(options: RunOptions) {
    const id = options.resume
      ? identifier(options.resume)
      : `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    await mkdir(options.runsDir, { recursive: true });
    const root = await safePath(options.runsDir, id);
    if (!options.resume) await mkdir(root, { recursive: false });
    const store = options.artifacts?.(root) ?? new FileArtifacts(await realpath(root));
    const manifest: RunManifest = options.resume
      ? JSON.parse(await store.read('run.json'))
      : {
          id,
          createdAt: new Date().toISOString(),
          repositories: {
            ml: {
              ...options.repositories.ml,
              path: resolve(options.repositories.ml.path),
            },
            framework: {
              ...options.repositories.framework,
              path: resolve(options.repositories.framework.path),
            },
          },
          worktrees: {},
        };
    if (manifest.id !== id) throw new Error('Run manifest ID mismatch');
    const run = new ResearchRun(
      manifest,
      store,
      options.runner ?? runProcess,
      options.timeoutMs ?? 600_000,
    );
    if (options.resume)
      for (const target of ['ml', 'framework'] as const) {
        if (manifest.worktrees[target]?.state !== 'preparing' && manifest.worktrees[target])
          await run.validate(target);
      }
    else await run.save();
    return run;
  }
  async save() {
    const content = json(this.manifest);
    const task = this.journal.then(() => this.store.write('run.json', content));
    this.journal = task.catch(() => {});
    await task;
  }
  async objective(text: string) {
    if (!text.trim()) throw new Error('An objective is required');
    if (this.manifest.objective && this.manifest.objective !== text)
      throw new Error('This run already has an objective; refine it in chat or start a new run');
    this.manifest.objective = text;
    await this.save();
  }
  async execute(request: ProcessRequest) {
    const log = `logs/${Date.now()}-${crypto.randomUUID()}.json`;
    const start = {
      command: request.command,
      args: request.args,
      cwd: request.cwd,
      startedAt: new Date().toISOString(),
    };
    await this.store.write(log, json({ ...start, status: 'running' }));
    try {
      const result = await this.runner({
        ...request,
        timeoutMs: request.timeoutMs ?? this.timeoutMs,
      });
      await this.store.write(log, json({ ...start, result }));
      return { ...result, log };
    } catch (error) {
      await this.store.write(log, json({ ...start, error: String(error) }));
      throw error;
    }
  }
  private async git(cwd: string, args: string[], signal?: AbortSignal) {
    return assertProcess(await this.execute({ command: 'git', args, cwd, signal })).stdout.trim();
  }
  async prepare(target: Target, signal?: AbortSignal): Promise<Worktree> {
    if (this.manifest.worktrees[target] && this.manifest.worktrees[target]?.state !== 'preparing')
      return this.validate(target, signal);
    const pending = this.preparing.get(target);
    if (pending) return pending;
    const task = this.create(target, signal);
    this.preparing.set(target, task);
    try {
      return await task;
    } finally {
      this.preparing.delete(target);
    }
  }
  private async create(target: Target, signal?: AbortSignal) {
    let entry = this.manifest.worktrees[target];
    if (!entry) {
      const repository = this.manifest.repositories[target];
      const source = await realpath(repository.path);
      const commit = await this.git(
        source,
        ['rev-parse', '--verify', '--end-of-options', `${repository.ref ?? 'HEAD'}^{commit}`],
        signal,
      );
      const path = await safePath(this.store.root, `worktrees/${target}`);
      entry = {
        source,
        path,
        commit,
        branch: `ml-researcher/${this.manifest.id}-${target}`,
        state: 'preparing',
      };
      this.manifest.worktrees[target] = entry;
      // Record ownership before Git mutates anything, so interruption can be recovered.
      await this.save();
    }
    const expected = await safePath(this.store.root, `worktrees/${target}`);
    if (resolve(entry.path) !== expected)
      throw new Error('Pending worktree path does not match run');
    const exists = await lstat(expected).then(
      () => true,
      (error) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    );
    if (!exists) {
      await mkdir(resolve(expected, '..'), { recursive: true });
      const branch = await this.execute({
        command: 'git',
        args: ['rev-parse', '--verify', '--quiet', `refs/heads/${entry.branch}`],
        cwd: entry.source,
        signal,
      });
      if (branch.cancelled || branch.timedOut) assertProcess(branch);
      if (branch.code === 0 && branch.stdout.trim() !== entry.commit)
        throw new Error('Pending worktree branch moved');
      if (branch.code !== 0 && branch.code !== 1) assertProcess(branch);
      await this.git(
        entry.source,
        branch.code === 0
          ? ['worktree', 'add', expected, entry.branch]
          : ['worktree', 'add', '-b', entry.branch, expected, entry.commit],
        signal,
      );
    }
    await this.validate(target, signal);
    entry.state = 'ready';
    await this.save();
    return entry;
  }
  async validate(target: Target, signal?: AbortSignal) {
    const entry = this.manifest.worktrees[target];
    if (!entry) throw new Error(`No ${target} worktree`);
    const expected = await safePath(this.store.root, `worktrees/${target}`);
    if ((await realpath(expected)) !== (await realpath(entry.path)))
      throw new Error('Worktree path does not match run');
    const common = async (path: string) =>
      realpath(
        await this.git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir'], signal),
      );
    if ((await common(entry.path)) !== (await common(this.manifest.repositories[target].path)))
      throw new Error('Worktree repository does not match source');
    if ((await this.git(entry.path, ['symbolic-ref', '--short', 'HEAD'], signal)) !== entry.branch)
      throw new Error('Worktree branch changed');
    if ((await this.git(entry.path, ['rev-parse', 'HEAD'], signal)) !== entry.commit)
      throw new Error('Worktree HEAD changed; expected the recorded base commit');
    return entry;
  }
  async guidance(target: Target, signal?: AbortSignal) {
    const worktree = await this.prepare(target, signal);
    const records: { path: string; provenance: string; content: string }[] = [];
    for (const [root, provenance] of [
      [worktree.source, 'source-local'],
      [worktree.path, 'pinned-worktree'],
    ] as const) {
      for (const name of ['AGENTS.md', '.agents/AGENTS.md']) {
        try {
          records.push({
            path: join(root, name),
            provenance,
            content: await readFile(await safePath(root, name), 'utf8'),
          });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      try {
        const skillsRoot = await safePath(root, '.agents/skills');
        for (const dir of await readdir(skillsRoot, { withFileTypes: true })) {
          if (!dir.isDirectory()) continue;
          const path = await safePath(root, `.agents/skills/${dir.name}/SKILL.md`);
          try {
            records.push({
              path,
              provenance,
              content: await readFile(path, 'utf8'),
            });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const warnings: string[] = [];
    for (const record of records) {
      for (const match of record.content.matchAll(/`((?:docs\/)[^`\s]+\.md)`/g)) {
        try {
          await readFile(await safePath(worktree.source, match[1]!));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            warnings.push(`Referenced guidance missing: ${match[1]}`);
          else throw error;
        }
      }
    }
    const result = { worktree, records, warnings: [...new Set(warnings)] };
    await this.store.write(`guidance/${target}.json`, json(result));
    return result;
  }
}
