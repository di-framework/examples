// Adapted from gsio src/markdown.tsx (MIT); see ../NOTICE.md.
// biome-ignore-all lint/suspicious/noArrayIndexKey: markdown tokens are ordered and have no stable id

import { Box, Text } from 'ink';
import { marked } from 'marked';
import React from 'react';

export type MarkdownProps = {
  content: string;
  color?: string;
};

const lexerOptions = {
  gfm: true,
  breaks: true,
};

export const Markdown: React.FC<MarkdownProps> = ({ content, color }) => {
  const tokens = React.useMemo(() => marked.lexer(content ?? '', lexerOptions), [content]);

  if (!tokens.length) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {tokens.map((token, index) => renderBlockToken(token, color, `block-${index}`, 0))}
    </Box>
  );
};

function renderBlockToken(
  token: any,
  color: string | undefined,
  key: string,
  depth: number,
): React.ReactNode {
  switch (token.type) {
    case 'space':
      return <Text key={key}> </Text>;
    case 'paragraph':
      return (
        <Text key={key} color={color}>
          {renderInlineTokens(token.tokens ?? [], key, color)}
        </Text>
      );
    case 'heading': {
      const headingColors = ['cyan', 'green', 'magenta', 'yellow'];
      const headingColor = headingColors[Math.min(token.depth - 1, headingColors.length - 1)];
      return (
        <Text key={key} color={headingColor} bold>
          {renderInlineTokens(token.tokens ?? [], key, color)}
        </Text>
      );
    }
    case 'code':
      return (
        <Box
          key={key}
          flexDirection="column"
          marginY={0}
          paddingX={1}
          paddingY={0}
          borderStyle="round"
          borderColor="gray"
        >
          {token.lang && (
            <Text color="gray" dimColor>
              {token.lang}
            </Text>
          )}
          <Text color="magenta">{token.text}</Text>
        </Box>
      );
    case 'blockquote':
      return (
        <Box key={key} flexDirection="column">
          {(token.tokens ?? []).map((child: any, idx: number) => (
            <Box key={`${key}-line-${idx}`} flexDirection="row">
              <Text color="gray">{'> '}</Text>
              <Box flexDirection="column">
                {renderBlockToken(child, color, `${key}-child-${idx}`, depth + 1)}
              </Box>
            </Box>
          ))}
        </Box>
      );
    case 'list':
      return (
        <Box key={key} flexDirection="column">
          {token.items?.map((item: any, idx: number) => {
            const start =
              typeof token.start === 'number' && !Number.isNaN(token.start) ? token.start : 1;
            const marker = item.task
              ? `[${item.checked ? 'x' : ' '}]`
              : token.ordered
                ? `${start + idx}.`
                : '•';
            return (
              <Box key={`${key}-item-${idx}`} flexDirection="row">
                <Text color={color}>{marker}</Text>
                <Box flexDirection="column" marginLeft={1}>
                  {renderListItem(item, `${key}-item-${idx}`, color, depth)}
                </Box>
              </Box>
            );
          })}
        </Box>
      );
    case 'table':
      return (
        <Box key={key} flexDirection="column">
          <Text color={color}>
            {token.header.map((cell: any) => inlineTokensToPlain(cell.tokens ?? [])).join(' | ')}
          </Text>
          <Text color="gray">{token.header.map(() => '---').join(' | ')}</Text>
          {token.rows?.map((row: any, idx: number) => (
            <Text key={`${key}-row-${idx}`} color={color}>
              {row.map((cell: any) => inlineTokensToPlain(cell.tokens ?? [])).join(' | ')}
            </Text>
          ))}
        </Box>
      );
    case 'hr':
      return (
        <Text key={key} color="gray">
          ────────────────────────
        </Text>
      );
    case 'html':
      return (
        <Text key={key} color={color}>
          {token.text || ''}
        </Text>
      );
    case 'text':
      if (token.tokens) {
        return (
          <Text key={key} color={color}>
            {renderInlineTokens(token.tokens, key, color)}
          </Text>
        );
      }
      return (
        <Text key={key} color={color}>
          {token.text}
        </Text>
      );
    default:
      return (
        <Text key={key} color={color}>
          {token.raw ?? ''}
        </Text>
      );
  }
}

function renderInlineTokens(
  tokens: any[],
  keyPrefix: string,
  color: string | undefined,
): React.ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${keyPrefix}-inline-${index}`;
    switch (token.type) {
      case 'text':
        if (token.tokens) {
          return (
            <React.Fragment key={key}>
              {renderInlineTokens(token.tokens, key, color)}
            </React.Fragment>
          );
        }
        return <React.Fragment key={key}>{token.text}</React.Fragment>;
      case 'strong':
        return (
          <Text key={key} bold>
            {renderInlineTokens(token.tokens ?? [], key, color)}
          </Text>
        );
      case 'em':
        return (
          <Text key={key} italic>
            {renderInlineTokens(token.tokens ?? [], key, color)}
          </Text>
        );
      case 'codespan':
        return <Text key={key} backgroundColor="gray" color="black">{` ${token.text} `}</Text>;
      case 'br':
        return <Text key={key}>{'\n'}</Text>;
      case 'del':
        return (
          <Text key={key} strikethrough>
            {renderInlineTokens(token.tokens ?? [], key, color)}
          </Text>
        );
      case 'link':
        return (
          <Text key={key} underline color="cyan">
            {renderInlineTokens(token.tokens ?? [], key, color)}
            {token.href ? ` (${token.href})` : ''}
          </Text>
        );
      case 'image':
        return (
          <Text key={key} underline color="cyan">
            {token.text || 'image'}
            {token.href ? ` (${token.href})` : ''}
          </Text>
        );
      case 'escape':
        return <React.Fragment key={key}>{token.text}</React.Fragment>;
      default:
        return <React.Fragment key={key}>{token.raw ?? ''}</React.Fragment>;
    }
  });
}

function renderListItem(
  item: any,
  keyPrefix: string,
  color: string | undefined,
  depth: number,
): React.ReactNode {
  const itemTokens = item.tokens ?? [];
  const isLoose = item.loose;

  return itemTokens.map((token: any, idx: number) => {
    const key = `${keyPrefix}-content-${idx}`;
    if (!isLoose && token.type === 'text') {
      return (
        <Text key={key} color={color}>
          {renderInlineTokens(token.tokens ?? [token], key, color)}
        </Text>
      );
    }
    return renderBlockToken(token, color, key, depth + 1);
  });
}

function inlineTokensToPlain(tokens: any[]): string {
  return tokens
    .map((token) => {
      switch (token.type) {
        case 'text':
        case 'codespan':
        case 'escape':
          return token.text ?? '';
        case 'strong':
        case 'em':
        case 'del':
        case 'link':
          return inlineTokensToPlain(token.tokens ?? []);
        case 'br':
          return '\n';
        default:
          return token.raw ?? '';
      }
    })
    .join('');
}
