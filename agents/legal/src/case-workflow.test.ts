import { expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ChatResponse, FakeChatModel, toolCall, toolCallResponse } from '@di-framework/ai';
import { createLegalAgent } from './agent.ts';
import { type ChatTerminal, runInteractive } from './interactive.ts';

function terminal(lines: string[]) {
  const output: string[] = [];
  let interrupt = () => {};
  const io: ChatTerminal = {
    readLine: async () => lines.shift() ?? null,
    write: (text) => {
      output.push(text);
    },
    onInterrupt: (handler) => {
      interrupt = handler;
      return () => {
        interrupt = () => {};
      };
    },
    close: () => {},
  };
  return { io, output, interrupt: () => interrupt() };
}

test('the seven requested stages, follow-ups and reruns use the same chat agent', async () => {
  const ui = terminal([
    '/intake',
    'The audience is our case reviewer.',
    '/timeline',
    '/issues',
    '/gaps',
    '/research',
    '/verify',
    '/brief',
    '/clear',
    '/timeline',
    '/exit',
  ]);
  const turns: string[] = [];
  let closed = 0;
  await runInteractive(
    {
      agent: {
        chat: async (message, options) => {
          expect(options?.signal).toBeInstanceOf(AbortSignal);
          turns.push(message);
          return { content: 'Stage response' };
        },
      },
      clearHistory: () => {
        turns.push('clear');
      },
      close: async () => {
        closed++;
      },
    },
    ui.io,
  );
  expect(turns).toEqual([
    '/intake',
    'The audience is our case reviewer.',
    '/timeline',
    '/issues',
    '/gaps',
    '/research',
    '/verify',
    '/brief',
    'clear',
    '/timeline',
  ]);
  expect(closed).toBe(1);
  expect(ui.output.filter((line) => line === 'Stage response')).toHaveLength(9);
});

for (const outcome of ['missing input', 'provider failure', 'cancellation'] as const) {
  test(`${outcome} does not advance to another workflow stage`, async () => {
    const ui = terminal(['/research', '/exit']);
    const turns: string[] = [];
    await runInteractive(
      {
        agent: {
          chat: async (message, options) => {
            turns.push(message);
            if (outcome === 'provider failure') throw new Error('Provider unavailable');
            if (outcome === 'cancellation') {
              queueMicrotask(ui.interrupt);
              await new Promise<void>((_, reject) => {
                options?.signal?.addEventListener('abort', () => reject(new Error('Aborted')), {
                  once: true,
                });
              });
            }
            return { content: 'Which jurisdiction should I use?' };
          },
        },
        clearHistory: () => {},
        close: async () => {},
      },
      ui.io,
    );
    expect(turns).toEqual(['/research']);
    expect(ui.output).toContain(
      outcome === 'cancellation'
        ? 'Request cancelled.'
        : outcome === 'provider failure'
          ? 'Request failed: Provider unavailable'
          : 'Which jurisdiction should I use?',
    );
  });
}

test('workspace agent instructions govern literal commands and reload in a new session', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'legal-instructions-'));
  try {
    await mkdir(join(workspace, '.agents/plugin'), { recursive: true });
    await cp(
      resolve(import.meta.dir, '../.agents/plugins/legal'),
      join(workspace, '.agents/plugin/legal'),
      { recursive: true },
    );
    const instructionsPath = join(workspace, '.agents/AGENTS.md');
    await writeFile(instructionsPath, 'Custom workflow: use REVIEW-NOTE-A for /timeline.\n');
    const firstModel = new FakeChatModel(() => ChatResponse.of('First response'));
    const first = await createLegalAgent(firstModel, { workspace, mcp: false });
    try {
      await first.agent.chat('/timeline');
      expect(firstModel.calls[0]?.getUserMessage().text).toBe('/timeline');
      expect(firstModel.calls[0]?.getSystemMessage().text).toContain('REVIEW-NOTE-A');
      expect(firstModel.calls[0]?.getSystemMessage().text).not.toContain(
        'For intake, activate state',
      );
    } finally {
      await first.close();
    }
    await writeFile(instructionsPath, 'Custom workflow: use REVIEW-NOTE-B for /timeline.\n');
    const secondModel = new FakeChatModel(() => ChatResponse.of('Second response'));
    const second = await createLegalAgent(secondModel, {
      workspace,
      mcp: false,
    });
    try {
      await second.agent.chat('/timeline');
      expect(secondModel.calls[0]?.getUserMessage().text).toBe('/timeline');
      expect(secondModel.calls[0]?.getSystemMessage().text).toContain('REVIEW-NOTE-B');
      expect(secondModel.calls[0]?.getSystemMessage().text).not.toContain('REVIEW-NOTE-A');
    } finally {
      await second.close();
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('a new agent session can read a previous stage artifact through the real workspace tools', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'legal-workflow-'));
  try {
    await mkdir(join(workspace, '.agents/plugin'), { recursive: true });
    await cp(
      resolve(import.meta.dir, '../.agents/plugins/legal'),
      join(workspace, '.agents/plugin/legal'),
      { recursive: true },
    );
    await cp(
      resolve(import.meta.dir, '../.agents/AGENTS.md'),
      join(workspace, '.agents/AGENTS.md'),
    );
    await mkdir(join(workspace, 'case-data'));
    const caseData = '# Sample case\nState: VA\nObjective: Review the supplied chronology.\n';
    await writeFile(join(workspace, 'case-data/README.md'), caseData);
    const evidencePath = join(workspace, 'case-data/notes.md');
    const timelinePath = join(workspace, 'legal-references/VA/case-work/timeline.md');
    const issuesPath = join(workspace, 'legal-references/VA/case-work/issues.md');
    await writeFile(evidencePath, 'SOURCE-E1: A meeting was reported on 2026-09-01.\n');
    const timeline =
      '# Sample case timeline\nE1 | 2026-09-01 | Reported meeting | notes.md SOURCE-E1\n';
    let timelineCalls = 0;
    const timelineModel = new FakeChatModel((prompt) => {
      const toolResults = JSON.stringify(
        prompt.messages.filter((message) => message.messageType === 'tool'),
      );
      switch (timelineCalls++) {
        case 0:
          expect(prompt.getUserMessage().text).toBe('/timeline');
          return toolCallResponse([
            toolCall('timeline-skill', 'Skill', { command: 'jurisprudence' }),
          ]);
        case 1:
          expect(toolResults).toContain(
            join(workspace, '.agents/plugin/legal/skills/jurisprudence'),
          );
          return toolCallResponse([toolCall('evidence', 'Read', { filePath: evidencePath })]);
        case 2:
          expect(toolResults).toContain('SOURCE-E1: A meeting was reported');
          return toolCallResponse([
            toolCall('save-timeline', 'Write', {
              filePath: timelinePath,
              content: timeline,
            }),
          ]);
        default:
          expect(toolResults).toContain('Successfully created file:');
          return ChatResponse.of('Saved the provisional timeline.');
      }
    });
    const first = await createLegalAgent(timelineModel, {
      workspace,
      mcp: false,
    });
    const firstUi = terminal(['/timeline', '/exit']);
    await runInteractive({ ...first, clearHistory: () => {} }, firstUi.io);
    expect(firstUi.output).toContain('Saved the provisional timeline.');
    expect(timelineCalls).toBe(4);
    expect(await readFile(timelinePath, 'utf8')).toBe(timeline);

    let issueCalls = 0;
    const issuesModel = new FakeChatModel((prompt) => {
      const toolResults = JSON.stringify(
        prompt.messages.filter((message) => message.messageType === 'tool'),
      );
      switch (issueCalls++) {
        case 0:
          expect(prompt.getUserMessage().text).toBe('/issues');
          expect(JSON.stringify(prompt.messages)).not.toContain('Saved the provisional timeline.');
          return toolCallResponse([
            toolCall('issues-skill', 'Skill', { command: 'jurisprudence' }),
          ]);
        case 1:
          expect(toolResults).toContain(
            join(workspace, '.agents/plugin/legal/skills/jurisprudence'),
          );
          return toolCallResponse([toolCall('prior-timeline', 'Read', { filePath: timelinePath })]);
        case 2:
          expect(toolResults).toContain('E1 | 2026-09-01 | Reported meeting');
          return toolCallResponse([
            toolCall('save-issues', 'Write', {
              filePath: issuesPath,
              content: '# Sample case issues\nI1: What supports the reported meeting in E1?\n',
            }),
          ]);
        default:
          expect(toolResults).toContain('Successfully created file:');
          return ChatResponse.of('Saved provisional issues linked to timeline E1.');
      }
    });
    const second = await createLegalAgent(issuesModel, {
      workspace,
      mcp: false,
    });
    const secondUi = terminal(['/issues', '/exit']);
    await runInteractive({ ...second, clearHistory: () => {} }, secondUi.io);
    expect(secondUi.output).toContain('Saved provisional issues linked to timeline E1.');
    expect(issueCalls).toBe(4);
    expect(await readFile(issuesPath, 'utf8')).toContain(
      'I1: What supports the reported meeting in E1?',
    );
    expect(await readFile(timelinePath, 'utf8')).toBe(timeline);
    expect(await readFile(join(workspace, 'case-data/README.md'), 'utf8')).toBe(caseData);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
