import { json } from './artifacts.ts';
import { hash } from './data.ts';
import { assertProcess } from './process.ts';
import type { ResearchRun } from './repositories.ts';

export interface ResearchRequest {
  kind: 'papers' | 'models' | 'datasets' | 'web' | 'url';
  action: 'search' | 'read' | 'info';
  query: string;
  limit?: number;
}
export interface ResearchOptions {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  braveApiKey?: string;
  hfCommand?: string;
}
export class ResearchClient {
  constructor(
    private readonly run: ResearchRun,
    private readonly options: ResearchOptions = {},
  ) {}
  async query(input: ResearchRequest, signal?: AbortSignal) {
    const limit = Math.max(1, Math.min(10, input.limit ?? 5));
    let url: string;
    let content: string;
    let truncated = false;
    if (['papers', 'models', 'datasets'].includes(input.kind)) {
      const action =
        input.action === 'search'
          ? input.kind === 'papers'
            ? 'search'
            : 'list'
          : input.action === 'read'
            ? input.kind === 'papers'
              ? 'read'
              : 'card'
            : 'info';
      const args = [input.kind, action, '--format', 'json'];
      if (input.action === 'search') args.push('--limit', String(limit));
      if (input.action === 'search' && input.kind !== 'papers')
        args.push(`--search=${input.query}`);
      else args.push('--', input.query);
      const result = assertProcess(
        await this.run.execute({
          command: this.options.hfCommand ?? 'hf',
          args,
          cwd: this.run.store.root,
          timeoutMs: 60_000,
          signal,
        }),
      );
      content = result.stdout;
      truncated = result.truncated;
      url =
        input.action === 'search'
          ? `https://huggingface.co/${input.kind}?search=${encodeURIComponent(input.query)}`
          : `https://huggingface.co/${input.kind === 'models' ? '' : `${input.kind}/`}${input.query}`;
    } else {
      const headers: Record<string, string> = {};
      if (input.kind === 'web') {
        const key = this.options.braveApiKey ?? process.env.BRAVE_API_KEY;
        if (!key)
          throw new Error(
            'General web search needs BRAVE_API_KEY; Hub discovery and URL fetching remain available',
          );
        url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(input.query)}&count=${limit}`;
        headers['X-Subscription-Token'] = key;
      } else {
        const parsed = new URL(input.query);
        if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password)
          throw new Error('Use a public HTTP(S) URL without credentials');
        url = parsed.href;
      }
      const response = await (this.options.fetch ?? fetch)(url, {
        headers,
        signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]),
      });
      if (!response.ok) throw new Error(`Research fetch failed: HTTP ${response.status}`);
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      content = '';
      try {
        if (reader)
          for (;;) {
            const next = await reader.read();
            if (next.done) {
              content += decoder.decode();
              break;
            }
            content += decoder.decode(next.value, { stream: true });
            if (content.length > 80_000) {
              content = content.slice(0, 80_000);
              truncated = true;
              break;
            }
          }
      } finally {
        await reader?.cancel();
      }
      url = response.url || url;
    }
    const id = crypto.randomUUID();
    const record = {
      id,
      request: input,
      url,
      accessedAt: new Date().toISOString(),
      hash: hash(content),
      truncated,
      content,
    };
    await this.run.store.write(`sources/${id}.json`, json(record));
    return record;
  }
}
