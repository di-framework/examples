import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverProducerPackages, resolvePackageDirectory } from '../scripts/link-producers';

describe('link-producers helper', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'link-producers-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('discovers packages in a monorepo layout (packages/*)', () => {
    const monorepo = join(tempDir, 'producer');
    const pkgA = join(monorepo, 'packages', 'pkg-a');
    const pkgB = join(monorepo, 'packages', 'pkg-b');
    mkdirSync(pkgA, { recursive: true });
    mkdirSync(pkgB, { recursive: true });
    writeFileSync(
      join(pkgA, 'package.json'),
      JSON.stringify({ name: '@di-framework/test-a', version: '6.0.0' }),
    );
    writeFileSync(
      join(pkgB, 'package.json'),
      JSON.stringify({ name: '@di-framework/test-b', version: '6.0.0' }),
    );

    const discovered = discoverProducerPackages(monorepo);
    expect(discovered).toHaveLength(2);
    expect(discovered.map((p) => p.name).sort()).toEqual([
      '@di-framework/test-a',
      '@di-framework/test-b',
    ]);
  });

  it('discovers single package at root if no packages/ directory exists', () => {
    const singlePkg = join(tempDir, 'single');
    mkdirSync(singlePkg, { recursive: true });
    writeFileSync(
      join(singlePkg, 'package.json'),
      JSON.stringify({ name: '@di-framework/single-package', version: '1.0.0' }),
    );

    const discovered = discoverProducerPackages(singlePkg);
    expect(discovered).toHaveLength(1);
    expect(discovered[0].name).toBe('@di-framework/single-package');
    expect(discovered[0].directory).toBe(singlePkg);
  });

  it('throws when producer path does not exist', () => {
    const nonexistent = join(tempDir, 'nonexistent');
    expect(() => discoverProducerPackages(nonexistent)).toThrow('Producer path not found');
  });

  it('resolves installed package directory from start directory', () => {
    const pkgDir = resolvePackageDirectory(process.cwd(), 'typescript');
    expect(pkgDir).toBeDefined();
    expect(pkgDir?.endsWith('typescript')).toBe(true);
  });

  it('returns undefined for non-existent package', () => {
    const pkgDir = resolvePackageDirectory(process.cwd(), 'non-existent-pkg-xyz');
    expect(pkgDir).toBeUndefined();
  });
});
