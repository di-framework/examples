/** Terminal help only. Agent behavior lives in the workspace .agents/AGENTS.md. */
export const CASE_WORKFLOW = [
  {
    command: '/intake',
    description: 'Establish the case, objective, scope and missing information',
  },
  {
    command: '/timeline',
    description: 'Build a sourced chronology and flag disputed dates',
  },
  {
    command: '/issues',
    description: 'Frame and prioritize the questions the case raises',
  },
  {
    command: '/gaps',
    description: 'Prioritize missing facts, documents and authorities',
  },
  {
    command: '/research',
    description: 'Research the issues against available primary sources',
  },
  {
    command: '/verify',
    description: 'Check claims and citations, recording the limits of each check',
  },
  {
    command: '/brief',
    description: 'Synthesize a case brief with sources and unresolved questions',
  },
] as const;

export const CASE_WORKFLOW_SEQUENCE = CASE_WORKFLOW.map((step) => step.command).join(' → ');
