import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { ChatResponse, FakeChatModel, toolCall, toolCallResponse } from '@di-framework/ai';
import { validateSkillDirectory } from '@di-framework/ai-utils';
import { createLegalAgent } from './agent.ts';

const names = [
  'case-law-research',
  'case-read',
  'civil-procedure',
  'constitutional',
  'general',
  'jurisprudence',
  'state',
];

test('the consolidated skills are valid and activate through the agent tool loop', async () => {
  const workspace = resolve(import.meta.dir, '..');
  const model = new FakeChatModel((prompt) => {
    const name = prompt.getUserMessage().text ?? '';
    const toolResult = prompt.messages.find((message) => message.messageType === 'tool');
    if (!toolResult) return toolCallResponse([toolCall(name, 'Skill', { command: name })]);
    expect(toolResult.responses).toHaveLength(1);
    expect(toolResult.responses[0]?.responseData).toContain(
      resolve(workspace, '.agents/plugins/legal/skills', name),
    );
    return ChatResponse.of('Skill activated');
  });
  const legal = await createLegalAgent(model, { workspace, mcp: false });
  try {
    expect(legal.toolbox.skills.map((skill) => skill.name).sort()).toEqual([...names].sort());
    for (const name of names) {
      const validation = validateSkillDirectory(resolve(legal.plugin.basePath, 'skills', name));
      expect(
        validation.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
      ).toEqual([]);
      expect(validation.valid).toBe(true);
      expect((await legal.agent.chat(name)).content).toBe('Skill activated');
      expect(legal.toolbox.runtime.activeSkill()?.name).toBe(name);
      expect(legal.toolbox.runtime.isToolAllowed('Read')).toBe(true);
    }
    expect(model.calls).toHaveLength(names.length * 2);
  } finally {
    await legal.close();
  }
});
