import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

export const TENANT = 'meshtastic';
export const USER = 'dev';
export const SERVICES = ['mesh-collector', 'mesh-site'] as const;
/** wasi:http host of mesh-site; the gateway serves it at `<host>.<tenant>.localhost`. */
export const SITE_HOST = 'mesh-site';
/** Blobstore service both members bind as `objects` (see each service's src/bindings.ts). */
export const OBJECTS_SERVICE = 'mesh-objects';
export const OBJECTS_BINDING = 'objects';

/** Directories that hold build output or installed packages, never sources. */
const SKIPPED = new Set(['node_modules', 'dist', '.di-framework', 'coverage']);

/** Every source file under `root`, as sorted paths relative to it. */
export function sourceFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (SKIPPED.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(relative(root, path));
    }
  };
  walk(root);
  return files.sort();
}

/** Content hash of files and directory trees. A deploy command re-runs when it changes. */
export function sourceHash(roots: string[]): string {
  const hash = createHash('sha256');
  for (const root of roots) {
    const files = statSync(root).isDirectory()
      ? sourceFiles(root).map((file) => [`${basename(root)}/${file}`, join(root, file)])
      : [[basename(root), root]];
    for (const [name, path] of files) {
      hash.update(`${name}\0`);
      hash.update(readFileSync(path as string));
      hash.update('\0');
    }
  }
  return hash.digest('hex');
}

/** A command or path argument that is safe to splice into `sh -c` unquoted. */
const PLAIN = /^[A-Za-z0-9_./:@-]+$/;

export function shellWord(value: string): string {
  return PLAIN.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Build the tenant host image, wait for the cluster registry, and push the image to it.
 * Podman needs `--tls-verify=false` for the plain-HTTP registry; Docker already
 * allows plain HTTP to 127.0.0.1.
 */
export function hostImageCommand(args: {
  containerCli: string;
  context: string;
  localImage: string;
  pushImage: string;
  registry: string;
}): string {
  const cli = shellWord(args.containerCli);
  const insecure = basename(args.containerCli) === 'podman' ? ' --tls-verify=false' : '';
  return [
    'set -eu;',
    `${cli} build -t ${shellWord(args.localImage)} ${shellWord(args.context)};`,
    'attempt=0;',
    `until curl -fsS ${shellWord(`${args.registry}/v2/`)} >/dev/null 2>&1; do`,
    'attempt=$((attempt + 1));',
    'if [ "$attempt" -ge 450 ]; then echo "The cluster registry did not answer" >&2; exit 1; fi;',
    'sleep 2;',
    'done;',
    `${cli} tag ${shellWord(args.localImage)} ${shellWord(args.pushImage)};`,
    `${cli} push${insecure} ${shellWord(args.pushImage)}`,
  ].join(' ');
}

/** Fill a gateway URL pattern such as `http://{host}.{tenant}.localhost:28180`. */
export function routeUrl(pattern: string, host: string, tenant: string): string {
  return `${pattern.replaceAll('{host}', host).replaceAll('{tenant}', tenant)}/`;
}

/** How to open the tenant console for this example with the generated kubeconfig. */
export function consoleCommand(examplesDirectory: string, kubeconfig: string): string {
  return `cd ${shellWord(examplesDirectory)} && KUBECONFIG=${shellWord(kubeconfig)} di-framework platform console`;
}

/** The first container CLI that works here; Docker first, then Podman. */
export function chooseContainerCli(works: (name: string) => boolean): string | undefined {
  return ['docker', 'podman'].find(works);
}
