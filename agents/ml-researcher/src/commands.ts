import type { ChatCommand } from '@di-framework/tui/core';
export const RESEARCH_STAGES = [
  ['build', 'Build and evaluate a model from a description', 'DESCRIPTION'],
  ['objective', 'Research, implement, and verify an objective', 'TEXT'],
  ['inspect', 'Inspect repository capabilities and gaps', undefined],
  ['research', 'Research primary sources and approaches', undefined],
  ['experiment', 'Run a reproducible local experiment', undefined],
  ['implement', 'Implement changes in task worktrees', undefined],
  ['verify', 'Verify changes and model results', undefined],
  ['report', 'Save an evidence-based report', undefined],
] as const;
export interface CommandSession {
  runStage(stage: string, args: string, signal?: AbortSignal): Promise<string>;
  run: { manifest: unknown };
}
export function createMlResearcherCommands(session: CommandSession): ChatCommand[] {
  return [
    ...RESEARCH_STAGES.map(
      ([name, description, args]): ChatCommand => ({
        name: `/${name}`,
        description,
        arguments: args,
        run: (input, { signal }) => session.runStage(name, input, signal),
      }),
    ),
    {
      name: '/status',
      description: 'Show objective, revisions, and worktree paths',
      run: () => JSON.stringify(session.run.manifest, null, 2),
    },
  ];
}
