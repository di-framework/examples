import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { functionToolCallback } from '@di-framework/ai';
import { z } from 'zod';
import { safePath, within } from './artifacts.ts';
import type { ModelBuilder } from './build.ts';
import type { ResearchRun } from './repositories.ts';
import type { ResearchClient } from './research.ts';
import { modelSpecSchema } from './spec.ts';

export async function resolveReadable(path: string, roots: readonly string[]) {
  for (const root of roots) {
    const candidate = resolve(root, path);
    if (!within(root, candidate)) continue;
    try {
      return await realpath(await safePath(root, candidate));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error('Input file is unavailable within the configured readable roots');
}
export function researcherTools(
  run: ResearchRun,
  builder: ModelBuilder,
  research: ResearchClient,
  signal: () => AbortSignal | undefined,
) {
  const tool = <T extends z.ZodType>(
    name: string,
    description: string,
    schema: T,
    call: (input: z.infer<T>) => Promise<unknown>,
  ) =>
    functionToolCallback({
      name,
      description,
      inputSchema: z.toJSONSchema(schema),
      call: async (input) => {
        try {
          signal()?.throwIfAborted();
          return { ok: true, result: await call(schema.parse(input)) };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    });
  const target = z.enum(['ml', 'framework']);
  return [
    tool(
      'Repository',
      'Prepare an isolated target worktree and read repository instructions and skills, with source provenance and missing-reference warnings.',
      z.strictObject({ target }),
      ({ target }) => run.guidance(target, signal()),
    ),
    tool(
      'RunStatus',
      'Read this run’s objective, pinned revisions, and retained worktree paths.',
      z.strictObject({}),
      async () => run.manifest,
    ),
    tool(
      'Research',
      'Search/read primary papers or Hub models/datasets, fetch a public URL, or use configured Brave search. Saves source records with URL and access date.',
      z.strictObject({
        kind: z.enum(['papers', 'models', 'datasets', 'web', 'url']),
        action: z.enum(['search', 'read', 'info']),
        query: z.string().min(1),
        limit: z.number().int().min(1).max(10).optional(),
      }),
      (input) => research.query(input, signal()),
    ),
    tool(
      'SaveNote',
      'Save a research note or final report under notes/. Only reports successful writes after saving.',
      z.strictObject({ path: z.string().min(1), content: z.string() }),
      async ({ path, content }) => {
        const destination = await safePath(run.store.root, `notes/${path}`);
        if (!within(resolve(run.store.root, 'notes'), destination))
          throw new Error('Notes must stay under notes/');
        return { path: await run.store.write(destination, content) };
      },
    ),
    tool(
      'Execute',
      'Run a local executable with argv in a worktree or run directory. Use for experiments, builds, and tests. Captures exit status and bounded logs; cancellation kills the process group. No automatic publishing or cloud jobs.',
      z.strictObject({
        target: z.enum(['ml', 'framework', 'run']),
        command: z.string().min(1),
        args: z.array(z.string()),
        directory: z.string().default('.'),
        env: z.record(z.string(), z.string()).optional(),
      }),
      async (input) => {
        const root =
          input.target === 'run'
            ? run.store.root
            : (await run.prepare(input.target, signal())).path;
        const cwd = await realpath(await safePath(root, input.directory));
        return run.execute({
          command: input.command,
          args: input.args,
          cwd,
          env: input.env,
          signal: signal(),
        });
      },
    ),
    tool(
      'BuildModel',
      'Build/adapt a bounded ONNX model from a complete task specification. Fits preprocessing on training data, selects on validation, evaluates held-out data once, and exports a report and TypeScript inference example.',
      modelSpecSchema,
      (spec) => builder.build(spec, signal()),
    ),
  ];
}
