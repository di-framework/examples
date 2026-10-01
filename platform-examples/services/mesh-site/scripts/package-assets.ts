import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageStaticAssets } from '@di-framework/http';

function biomeRoot(start: string): string | undefined {
  let dir = start;
  while (existsSync(dir)) {
    if (existsSync(join(dir, 'biome.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packaged = packageStaticAssets({ directory: join(root, 'public') });
packaged.generatedAt = '2026-10-01T00:00:00.000Z';
packaged.directory = 'public';

const source = `// biome-ignore-all lint/suspicious/noTemplateCurlyInString: packaged file text
import type { StaticAssetPackage } from '@di-framework/http';

const assets = ${JSON.stringify(packaged, null, 2)} as StaticAssetPackage;

export default assets;
`;

const assetModule = join(root, 'src', 'assets.ts');
writeFileSync(assetModule, source);
const workspace = biomeRoot(root);
if (workspace) {
  const formatted = spawnSync('bun', ['x', 'biome', 'check', '--write', assetModule], {
    cwd: workspace,
    stdio: 'inherit',
  });
  if (formatted.status !== 0) process.exit(formatted.status ?? 1);
}
