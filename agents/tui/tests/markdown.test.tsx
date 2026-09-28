import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, render } from 'ink-testing-library';
import React from 'react';
import { Markdown } from '../src/markdown';

afterEach(cleanup);

const stripAnsi = (value: string | undefined) => value?.replace(/\x1B\[[0-9;]*m/g, '') ?? '';

describe('Markdown component', () => {
  it('renders headings, emphasis, and links', () => {
    const { lastFrame } = render(
      <Markdown
        content={`# Title\n\nThis is **bold** and _italic_.\nVisit [docs](https://example.test).`}
      />,
    );
    const output = stripAnsi(lastFrame());
    expect(output).toContain('Title');
    expect(output).toContain('bold');
    expect(output).toContain('italic');
    expect(output).toContain('docs (https://example.test)');
  });

  it('renders lists and fenced code blocks', () => {
    const { lastFrame } = render(
      <Markdown content={`- item one\n- item two\n\n\`\`\`ts\nconst answer = 42;\n\`\`\``} />,
    );
    const output = stripAnsi(lastFrame());
    expect(output).toContain('• item one');
    expect(output).toContain('• item two');
    expect(output).toContain('ts');
    expect(output).toContain('const answer = 42;');
  });

  it('renders nothing for empty content', () => {
    const { lastFrame } = render(<Markdown content={''} />);
    expect(stripAnsi(lastFrame())).toBe('');
  });
});
