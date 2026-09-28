import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { json } from './artifacts.ts';
import { assertProcess } from './process.ts';
import type { ResearchRun } from './repositories.ts';

/** Compile the helper against this run's ML worktree, not the source checkout. */
export async function nativeRequest(
  run: ResearchRun,
  request: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const worktree = await run.prepare('ml', signal);
  const manifest = `[package]\nname = "ml-researcher-native"\nversion = "0.1.0"\nedition = "2024"\n[workspace]\n[dependencies]\ndi-ml = { path = ${JSON.stringify(join(worktree.path, 'crates/di-ml'))} }\nonnx-rs = "=0.1.2"\nserde = { version = "1", features = ["derive"] }\nserde_json = "1"\n`;
  await run.store.write('native/Cargo.toml', manifest);
  await run.store.write(
    'native/src/main.rs',
    await readFile(join(import.meta.dir, '../native/src/main.rs'), 'utf8'),
  );
  await run.store.write(
    `native/requests/${Date.now()}-${crypto.randomUUID()}.json`,
    json({ request, backend: 'cpu', worktreeCommit: worktree.commit }),
  );
  const result = assertProcess(
    await run.execute({
      command: 'cargo',
      args: ['run', '--quiet', '--manifest-path', join(run.store.root, 'native/Cargo.toml')],
      cwd: run.store.root,
      input: json(request),
      signal,
      env: {
        DI_ML_ACCEL: 'cpu',
        CARGO_TARGET_DIR: resolve(import.meta.dir, '../.cache/native-target'),
      },
    }),
  );
  return result.stdout;
}
