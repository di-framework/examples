import { afterEach, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ChatResponse, FakeChatModel, toolCall, toolCallResponse } from '@di-framework/ai';
import { createLegalAgent } from './agent.ts';
import { CASE_DATA_PATH, readCaseData } from './case-data.ts';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), 'legal-case-data-'));
  temporary.push(directory);
  await mkdir(join(directory, '.agents/plugin'), { recursive: true });
  await cp(
    resolve(import.meta.dir, '../.agents/plugins/legal'),
    join(directory, '.agents/plugin/legal'),
    { recursive: true },
  );
  await mkdir(join(directory, 'case-data'));
  return directory;
}

test('case facts enter the user context once across a real Skill loop and refresh per request', async () => {
  const directory = await workspace();
  const file = join(directory, CASE_DATA_PATH);
  await writeFile(file, '# Case\nState: Virginia (VA)\nCase label: FIRST');
  const model = new FakeChatModel((prompt) => {
    const context = prompt.messages.filter((message) =>
      message.text?.includes('"source":"case-data/README.md"'),
    );
    expect(context).toHaveLength(1);
    expect(context[0]?.messageType).toBe('user');
    expect(prompt.getSystemMessage().text).not.toContain('Case label:');
    expect(prompt.getUserMessage().text).toBe('Complete intake');
    return prompt.messages.some((message) => message.messageType === 'tool')
      ? ChatResponse.of('Intake reviewed')
      : toolCallResponse([toolCall('intake', 'Skill', { command: 'state' })]);
  });
  const legal = await createLegalAgent(model, {
    workspace: directory,
    mcp: false,
  });
  try {
    await legal.agent.chat('Complete intake');
    expect(legal.toolbox.runtime.activeSkill()?.name).toBe('state');
    expect(JSON.stringify(model.calls[1]?.messages)).toContain('Case label: FIRST');
    expect(await readCaseData(directory)).toContain('Case label: FIRST');
    await writeFile(file, '# Case\nState: Virginia (VA)\nCase label: UPDATED');
    await legal.agent.chat('Complete intake');
    expect(JSON.stringify(model.calls[2]?.messages)).toContain('Case label: UPDATED');
    expect(JSON.stringify(model.calls[2]?.messages)).not.toContain('Case label: FIRST');
  } finally {
    await legal.close();
  }
});

test('missing or empty README leaves conversational intake available', async () => {
  const directory = await workspace();
  expect(await readCaseData(directory)).toBeUndefined();
  const model = new FakeChatModel('Please supply a state.');
  const legal = await createLegalAgent(model, {
    workspace: directory,
    mcp: false,
  });
  try {
    await legal.agent.chat('Begin intake');
    await writeFile(join(directory, CASE_DATA_PATH), '  \n');
    await legal.agent.chat('Begin intake');
    for (const prompt of model.calls)
      expect(prompt.getUserMessages().map((message) => message.text)).toEqual(['Begin intake']);
  } finally {
    await legal.close();
  }
});

test('oversized summaries and links outside the workspace fail before inference', async () => {
  const directory = await workspace();
  const file = join(directory, CASE_DATA_PATH);
  await writeFile(file, 'x'.repeat(64 * 1024 + 1));
  const model = new FakeChatModel();
  const legal = await createLegalAgent(model, {
    workspace: directory,
    mcp: false,
  });
  try {
    await expect(legal.agent.chat('Begin intake')).rejects.toThrow('exceeds 64 KiB');
    expect(model.calls).toHaveLength(0);
    await rm(file);
    const outside = await mkdtemp(join(tmpdir(), 'legal-outside-'));
    temporary.push(outside);
    await writeFile(join(outside, 'README.md'), 'outside case');
    await symlink(join(outside, 'README.md'), file);
    await expect(readCaseData(directory)).rejects.toThrow('inside the agent workspace');
  } finally {
    await legal.close();
  }
});
