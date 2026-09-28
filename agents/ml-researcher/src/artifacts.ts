import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export function within(root: string, path: string) {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

/** Resolve existing ancestors too, so a symlink cannot bypass the root. */
export async function safePath(root: string, path: string): Promise<string> {
  const base = await realpath(root);
  const candidate = resolve(base, path);
  if (!within(base, candidate)) throw new Error('Path is outside its configured root');
  let ancestor = candidate;
  for (;;) {
    try {
      if (!within(base, await realpath(ancestor)))
        throw new Error('Symlink escapes configured root');
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (ancestor === base) throw error;
      ancestor = dirname(ancestor);
    }
  }
}

export interface ArtifactStore {
  root: string;
  write(path: string, content: string): Promise<string>;
  read(path: string): Promise<string>;
}
export class FileArtifacts implements ArtifactStore {
  constructor(readonly root: string) {}
  async write(path: string, content: string) {
    const destination = await safePath(this.root, path);
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, content, { flag: 'wx' });
    await rename(temporary, destination);
    return destination;
  }
  async read(path: string) {
    return readFile(await safePath(this.root, path), 'utf8');
  }
}
export const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
export const identifier = (value: string) => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value))
    throw new Error('Use a short alphanumeric identifier with hyphens or underscores');
  return value;
};
