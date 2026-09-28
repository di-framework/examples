import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createChatModel } from '@di-framework/ai';
import { createMlResearcherAgent } from './agent.ts';
import { runInteractive } from './interactive.ts';

export { createMlResearcherAgent } from './agent.ts';
export { ModelBuilder } from './build.ts';
export { createMlResearcherCommands } from './commands.ts';
export { runInteractive } from './interactive.ts';
export { ResearchRun } from './repositories.ts';
export { modelSpecSchema } from './spec.ts';

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        help: { type: 'boolean', short: 'h' },
        'ml-repo': { type: 'string' },
        'framework-repo': { type: 'string' },
        'ml-ref': { type: 'string' },
        'framework-ref': { type: 'string' },
        'runs-dir': { type: 'string' },
        resume: { type: 'string' },
        'data-dir': { type: 'string', multiple: true },
        'timeout-seconds': { type: 'string' },
      },
    });
    if (values.help)
      console.log(`Usage: bun start [--ml-repo PATH] [--framework-repo PATH]
  [--ml-ref REF] [--framework-ref REF] [--runs-dir PATH] [--resume RUN_ID]
  [--data-dir PATH ...] [--timeout-seconds 600]
Describe an objective or use /build DESCRIPTION. Model inference uses the existing subscription login.
Research uses hf; general web search optionally uses BRAVE_API_KEY. Local model builds require Cargo.
Worktrees and artifacts remain under runs/ after exit. MODEL overrides the inference model.`);
    else {
      const seconds = Number(values['timeout-seconds'] ?? 600);
      if (!Number.isFinite(seconds) || seconds < 1)
        throw new Error('--timeout-seconds must be positive');
      const session = await createMlResearcherAgent(
        createChatModel({ provider: 'openai', auth: 'subscription' }),
        {
          repositories: {
            ml: {
              path: resolve(
                values['ml-repo'] ?? resolve(import.meta.dir, '../../../../di-framework-ml'),
              ),
              ref: values['ml-ref'],
            },
            framework: {
              path: resolve(
                values['framework-repo'] ?? resolve(import.meta.dir, '../../../../di-framework'),
              ),
              ref: values['framework-ref'],
            },
          },
          runsDir: values['runs-dir'],
          resume: values.resume,
          readDirectories: values['data-dir'],
          timeoutMs: seconds * 1000,
        },
      );
      try {
        console.error(`Run: ${session.run.manifest.id}\nArtifacts: ${session.run.store.root}`);
        await runInteractive(session);
      } finally {
        await session.close();
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
