export const OWNER = 'ThomasMoreAI';
export const REPOSITORY = 'legal-skills-open';
const REPO_URL = `https://github.com/${OWNER}/${REPOSITORY}`;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_REQUESTS = 100;

export type Graphql = <T>(
  query: string,
  variables: Record<string, string>,
  signal?: AbortSignal,
) => Promise<T>;

async function boundedText(stream: ReadableStream<Uint8Array>, maximum: number): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error('GitHub response exceeded the size limit');
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    reader.releaseLock();
  }
}

/** Fixed github.com endpoint; gh supplies its existing login or GH_TOKEN/GITHUB_TOKEN. */
export const githubGraphql: Graphql = async <T>(
  query: string,
  variables: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> => {
  const requestSignal = AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]);
  requestSignal.throwIfAborted();
  const executable = Bun.which('gh');
  if (!executable) throw new Error('Install GitHub CLI and run gh auth login, or set GH_TOKEN');
  const child = Bun.spawn(
    [executable, 'api', '--hostname', 'github.com', 'graphql', '--input', '-'],
    {
      stdin: new Blob([JSON.stringify({ query, variables })]),
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_DEBUG: '' },
    },
  );
  const kill = () => child.kill('SIGKILL');
  requestSignal.addEventListener('abort', kill, { once: true });
  if (requestSignal.aborted) kill();
  try {
    const [stdout, , code] = await Promise.all([
      boundedText(child.stdout, 2 * 1024 * 1024),
      boundedText(child.stderr, 16 * 1024),
      child.exited,
    ]);
    requestSignal.throwIfAborted();
    if (code !== 0)
      throw new Error('GitHub GraphQL request failed; check gh auth status and GitHub rate limits');
    const response = JSON.parse(stdout) as { data?: T; errors?: unknown[] };
    if (response.errors?.length || !response.data)
      throw new Error('GitHub returned GraphQL errors or no data');
    return response.data;
  } finally {
    requestSignal.removeEventListener('abort', kill);
    kill();
    await child.exited;
  }
};

interface Entry {
  name: string;
  type: string;
  mode: number;
  oid: string;
}
interface GitObject {
  __typename: string;
  oid: string;
  entries?: Entry[];
  byteSize?: number;
  isBinary?: boolean;
  text?: string | null;
}
interface ObjectResponse {
  repository: { object: GitObject | null } | null;
}

function pathValue(value: string): string {
  if (
    value.length > 512 ||
    /[\\:]/.test(value) ||
    [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    (value !== '' && value.split('/').some((part) => !part || part === '.' || part === '..'))
  )
    throw new Error('Use a repository-relative path without traversal or revision syntax');
  return value;
}
function integer(value: number, min: number, max: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value;
}

/** Narrow repository browser: no caller-supplied GraphQL, mutations, or repository selection. */
export class LegalCatalog {
  private snapshot?: { commit: string; branch: string };
  private requests = 0;
  private directories = new Map<string, Entry[]>();
  private files = new Map<string, { oid: string; text: string; byteSize: number }>();

  constructor(private readonly graphql: Graphql = githubGraphql) {}

  private async query<T>(
    query: string,
    variables: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    if (++this.requests > MAX_REQUESTS)
      throw new Error('Catalog request limit reached; open a new MCP session');
    return this.graphql<T>(query, { owner: OWNER, name: REPOSITORY, ...variables }, signal);
  }

  async open(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!this.snapshot) {
      const data = await this.query<{
        repository: {
          defaultBranchRef: { name: string; target: { oid: string } } | null;
        } | null;
      }>(
        'query Snapshot($owner:String!,$name:String!){repository(owner:$owner,name:$name){defaultBranchRef{name target{oid}}}}',
        {},
        signal,
      );
      const branch = data.repository?.defaultBranchRef;
      if (!branch || !/^[a-f0-9]{40}$/.test(branch.target.oid))
        throw new Error('Catalog has no accessible default-branch commit');
      // Concurrent first calls must all retain the first resolved commit.
      this.snapshot ??= { commit: branch.target.oid, branch: branch.name };
    }
    return {
      ...this.snapshot,
      repository: `${OWNER}/${REPOSITORY}`,
      sourceUrl: `${REPO_URL}/tree/${this.snapshot.commit}`,
      licensePath: 'LICENSE',
      next: 'List the root, then jurisdiction/practice/skills; read SKILL.md and referenced files. Preserve their license and attribution.',
    };
  }

  private async object(path: string, fields: string, signal?: AbortSignal) {
    const { commit } = await this.open(signal);
    const data = await this.query<ObjectResponse>(
      `query Object($owner:String!,$name:String!,$expression:String!){repository(owner:$owner,name:$name){object(expression:$expression){__typename oid ${fields}}}}`,
      { expression: `${commit}:${path}` },
      signal,
    );
    const object = data.repository?.object;
    if (!object) throw new Error(`No catalog object at ${path || '/'}`);
    return object;
  }

  async list(path = '', offset = 0, limit = 40, signal?: AbortSignal) {
    pathValue(path);
    integer(offset, 0, 2000, 'offset');
    integer(limit, 1, 100, 'limit');
    const snapshot = await this.open(signal);
    let entries = this.directories.get(path);
    if (!entries) {
      const object = await this.object(path, '... on Tree{entries{name type mode oid}}', signal);
      if (object.__typename !== 'Tree' || !object.entries)
        throw new Error('Path is not a directory');
      if (object.entries.length > 2000)
        throw new Error('Directory exceeds 2000 entries; narrow the path');
      entries = [...object.entries].sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      );
      this.directories.set(path, entries);
    }
    return {
      repository: snapshot.repository,
      commit: snapshot.commit,
      path,
      total: entries.length,
      entries: entries.slice(offset, offset + limit).map((entry) => ({
        ...entry,
        path: path ? `${path}/${entry.name}` : entry.name,
        readable: entry.type === 'blob' && entry.mode !== 40960,
      })),
      nextOffset: offset + limit < entries.length ? offset + limit : null,
    };
  }

  async read(path: string, offset = 0, limit = 12_000, signal?: AbortSignal) {
    pathValue(path);
    integer(offset, 0, MAX_FILE_BYTES, 'offset');
    integer(limit, 1, 16_000, 'limit');
    if (!path) throw new Error('A file path is required');
    const snapshot = await this.open(signal);
    let file = this.files.get(path);
    if (!file) {
      const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      await this.list(parent, 0, 1, signal);
      const entry = this.directories
        .get(parent)
        ?.find((entry) => entry.name === path.split('/').at(-1));
      if (entry?.type !== 'blob' || entry.mode === 40960)
        throw new Error('Only regular catalog files can be read');
      const metadata = await this.object(path, '... on Blob{byteSize isBinary}', signal);
      if (
        metadata.__typename !== 'Blob' ||
        metadata.isBinary ||
        metadata.byteSize == null ||
        metadata.byteSize > MAX_FILE_BYTES
      )
        throw new Error('File is binary or exceeds 256 KiB');
      const blob = await this.object(path, '... on Blob{byteSize isBinary text}', signal);
      if (
        typeof blob.text !== 'string' ||
        blob.isBinary ||
        Buffer.byteLength(blob.text) > MAX_FILE_BYTES
      )
        throw new Error('GitHub did not return a bounded text file');
      file = { oid: blob.oid, text: blob.text, byteSize: metadata.byteSize };
      this.files.set(path, file);
    }
    if (offset > file.text.length) throw new Error('offset is past the end of the file');
    const text = file.text.slice(offset, offset + limit);
    return {
      repository: snapshot.repository,
      commit: snapshot.commit,
      path,
      blobOid: file.oid,
      byteSize: file.byteSize,
      sourceUrl: `${REPO_URL}/blob/${snapshot.commit}/${path.split('/').map(encodeURIComponent).join('/')}`,
      offset,
      text,
      totalCharacters: file.text.length,
      nextOffset: offset + text.length < file.text.length ? offset + text.length : null,
      contentKind: 'repository text; preserve skill frontmatter, licensing, and attribution',
    };
  }
}
