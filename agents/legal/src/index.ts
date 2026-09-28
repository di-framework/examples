import { parseArgs } from 'node:util';
import { createChatModel, MessageWindowChatMemory } from '@di-framework/ai';
import { createLegalAgent } from './agent.ts';
import { CASE_WORKFLOW_SEQUENCE } from './case-workflow.ts';
import { runInteractive } from './interactive.ts';
import { createTerminal } from './terminal.ts';

export { createLegalAgent, loadLegalPlugin } from './agent.ts';
export { CASE_WORKFLOW } from './case-workflow.ts';
export { runInteractive } from './interactive.ts';

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: false,
    options: {
      help: { type: 'boolean', short: 'h' },
      'no-mcp': { type: 'boolean' },
      intake: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log('Usage: bun start [--no-mcp] [--intake]');
    console.log('Opens an interactive chat using your existing Codex ChatGPT subscription login.');
    console.log(`Case workflow: ${CASE_WORKFLOW_SEQUENCE}`);
    console.log('Type a stage command or a message, /help for commands, or /exit to finish.');
    console.log(
      'MODEL optionally overrides the model. Plugin and case data resolve from the working directory.',
    );
  } else {
    const conversationMemory = new MessageWindowChatMemory({ maxMessages: 40 });
    const conversationId = crypto.randomUUID();
    const legal = await createLegalAgent(
      createChatModel({ provider: 'openai', auth: 'subscription' }),
      {
        conversationMemory,
        conversationId,
        mcp: !values['no-mcp'],
        onWarning: (message) => console.error(message),
      },
    );
    try {
      console.error(`Plugin: ${legal.plugin.name}; skills: ${legal.toolbox.skills.length}`);
      await runInteractive(
        {
          ...legal,
          agent: {
            async chat(message, options) {
              const before = [...conversationMemory.get(conversationId)];
              try {
                const result = await legal.agent.chat(message, options);
                options?.signal?.throwIfAborted();
                return result;
              } catch (error) {
                // Failed or cancelled requests do not leave an unanswered turn in memory.
                conversationMemory.replace(conversationId, before);
                throw error;
              }
            },
          },
          clearHistory: () => conversationMemory.clear(conversationId),
        },
        createTerminal(),
        { intake: values.intake },
      );
    } finally {
      await legal.close();
    }
  }
}
