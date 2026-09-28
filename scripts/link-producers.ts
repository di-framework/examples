import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface PackageEntry {
  name: string;
  directory: string;
  peerDependencies?: Record<string, string>;
}

const SINGLETON_PEER_DEPENDENCIES = new Set(['graphql']);

export function resolvePackageDirectory(startDir: string, packageName: string): string | undefined {
  const res = Bun.spawnSync(['bun', '-e', `console.log(import.meta.resolve("${packageName}"))`], {
    cwd: startDir,
  });
  if (res.exitCode !== 0 || !res.stdout.toString().trim()) return undefined;
  const rawUrl = res.stdout.toString().trim();
  try {
    const filePath = new URL(rawUrl).pathname;
    let current = dirname(filePath);
    while (current !== '/' && current !== '.') {
      const pkgJsonPath = resolve(current, 'package.json');
      if (existsSync(pkgJsonPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
          if (pkg.name === packageName) {
            return current;
          }
        } catch {
          // ignore error and continue up
        }
      }
      current = dirname(current);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function discoverProducerPackages(producerPath: string): PackageEntry[] {
  const absPath = resolve(producerPath);
  if (!existsSync(absPath)) {
    throw new Error(`Producer path not found: ${absPath}`);
  }

  const packagesDir = resolve(absPath, 'packages');
  const results: PackageEntry[] = [];

  if (existsSync(packagesDir)) {
    const entries = readdirSync(packagesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pkgJsonPath = resolve(packagesDir, entry.name, 'package.json');
      if (!existsSync(pkgJsonPath)) continue;
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
      if (pkg.name) {
        results.push({
          name: pkg.name,
          directory: resolve(packagesDir, entry.name),
          peerDependencies: pkg.peerDependencies,
        });
      }
    }
  } else {
    const rootPkgJson = resolve(absPath, 'package.json');
    if (existsSync(rootPkgJson)) {
      const pkg = JSON.parse(readFileSync(rootPkgJson, 'utf8'));
      if (pkg.name) {
        results.push({
          name: pkg.name,
          directory: absPath,
          peerDependencies: pkg.peerDependencies,
        });
      }
    }
  }

  return results;
}

export async function linkProducers(
  producerPaths: string[],
  examplesWorkspace = resolve(import.meta.dir, '..'),
): Promise<string[]> {
  if (producerPaths.length === 0) {
    throw new Error('At least one producer checkout path must be provided');
  }

  const allPackages: PackageEntry[] = [];
  const producerRevisions: Record<string, string> = {};

  for (const producerPath of producerPaths) {
    const absPath = resolve(producerPath);
    const packages = discoverProducerPackages(absPath);
    if (packages.length === 0) {
      console.warn(`Warning: No packages discovered at producer path ${absPath}`);
      continue;
    }
    allPackages.push(...packages);

    const rev = Bun.spawnSync(['git', '-C', absPath, 'rev-parse', 'HEAD']);
    if (rev.exitCode === 0) {
      producerRevisions[absPath] = rev.stdout.toString().trim();
    }
  }

  if (allPackages.length === 0) {
    throw new Error('No packages discovered across any provided producer paths');
  }

  console.log(
    `Discovered ${allPackages.length} package(s) from ${producerPaths.length} producer(s).`,
  );

  // Run bun link in each producer package directory
  for (const { name, directory } of allPackages) {
    console.log(`Registering bun link for ${name} in ${directory}...`);
    const linkChild = Bun.spawn(['bun', 'link'], {
      cwd: directory,
      stdout: 'inherit',
      stderr: 'inherit',
    });
    const exitCode = await linkChild.exited;
    if (exitCode !== 0) {
      throw new Error(`Failed to link ${name} from ${directory}`);
    }
  }

  // Update overrides in examples package.json
  const manifestPath = resolve(examplesWorkspace, 'package.json');
  const manifest = await Bun.file(manifestPath).json();
  manifest.overrides = manifest.overrides ?? {};

  for (const { name } of allPackages) {
    manifest.overrides[name] = `link:${name}`;
  }

  // Link external singleton peer dependencies required by packages (e.g. graphql)
  const processedPeers = new Set<string>();
  for (const { directory, peerDependencies } of allPackages) {
    if (!peerDependencies) continue;
    for (const peerName of Object.keys(peerDependencies)) {
      if (!SINGLETON_PEER_DEPENDENCIES.has(peerName) || processedPeers.has(peerName)) continue;
      processedPeers.add(peerName);

      const peerDir = resolvePackageDirectory(directory, peerName);
      if (peerDir) {
        console.log(
          `Registering bun link for singleton peer dependency ${peerName} in ${peerDir}...`,
        );
        const peerChild = Bun.spawn(['bun', 'link'], {
          cwd: peerDir,
          stdout: 'inherit',
          stderr: 'inherit',
        });
        const peerExit = await peerChild.exited;
        if (peerExit === 0) {
          manifest.overrides[peerName] = `link:${peerName}`;
        }
      }
    }
  }

  await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Updated overrides in ${manifestPath}`);

  // Run bun install in examples workspace
  console.log(`Installing linked packages in ${examplesWorkspace}...`);
  const installChild = Bun.spawn(['bun', 'install'], {
    cwd: examplesWorkspace,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const installExit = await installChild.exited;
  if (installExit !== 0) {
    throw new Error(`bun install failed in ${examplesWorkspace}`);
  }

  // Verify links
  for (const { name, directory } of allPackages) {
    const nodeModulesPath = resolve(examplesWorkspace, 'node_modules', name);
    if (existsSync(nodeModulesPath)) {
      const actual = realpathSync(nodeModulesPath);
      const expected = realpathSync(directory);
      if (actual !== expected) {
        throw new Error(`Link mismatch for ${name}: expected ${expected}, got ${actual}`);
      }
      console.log(`✓ Verified link: ${name} → ${actual}`);
    }
  }

  // Write revision metadata
  const localDir = resolve(examplesWorkspace, '.local');
  mkdirSync(localDir, { recursive: true });
  await Bun.write(
    resolve(localDir, 'producers.json'),
    `${JSON.stringify({ producers: producerRevisions, linkedAt: new Date().toISOString() }, null, 2)}\n`,
  );

  return allPackages.map((p) => p.name);
}

if (import.meta.main) {
  try {
    const paths = process.argv.slice(2);
    if (paths.length === 0) {
      console.error('Usage: bun scripts/link-producers.ts <producer-path> [producer-path...]');
      process.exit(1);
    }
    await linkProducers(paths);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
