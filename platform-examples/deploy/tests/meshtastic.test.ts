import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chooseContainerCli,
  consoleCommand,
  hostImageCommand,
  routeUrl,
  shellWord,
  sourceFiles,
  sourceHash,
} from '../src/meshtastic';

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'meshtastic-deploy-'));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  return root;
}

describe('source hashing', () => {
  test('lists sources and skips installed packages and build output', () => {
    const root = tree({
      'src/index.ts': 'a',
      'package.json': '{}',
      'node_modules/x/index.js': 'x',
      'dist/app.wasm': 'w',
      '.di-framework/cache': 'c',
    });
    expect(sourceFiles(root)).toEqual(['package.json', 'src/index.ts']);
  });

  test('changes with content, not with build output', () => {
    const root = tree({ 'src/index.ts': 'a' });
    const before = sourceHash([root]);
    writeFileSync(join(root, 'dist.txt'), 'new file');
    const added = sourceHash([root]);
    expect(added).not.toBe(before);
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'dist', 'out.js'), 'ignored');
    expect(sourceHash([root])).toBe(added);
    writeFileSync(join(root, 'src/index.ts'), 'b');
    expect(sourceHash([root])).not.toBe(added);
  });

  test('hashes single files alongside directories', () => {
    const root = tree({ 'di-framework.deploy.toml': 'one', 'svc/a.ts': 'a' });
    const manifest = join(root, 'di-framework.deploy.toml');
    const before = sourceHash([join(root, 'svc'), manifest]);
    writeFileSync(manifest, 'two');
    expect(sourceHash([join(root, 'svc'), manifest])).not.toBe(before);
  });
});

describe('commands', () => {
  test('quotes only words that need it', () => {
    expect(shellWord('/usr/bin/podman')).toBe('/usr/bin/podman');
    expect(shellWord('/Volumes/my disk/x')).toBe("'/Volumes/my disk/x'");
    expect(shellWord("it's")).toBe("'it'\\''s'");
  });

  test('podman pushes to the plain-HTTP registry with TLS verification off', () => {
    const script = hostImageCommand({
      containerCli: '/opt/podman/bin/podman',
      context: '/work/tenant-host',
      localImage: 'localhost/di-framework/wash:2.8.0-wasi-tls',
      pushImage: '127.0.0.1:25000/di-framework/wash:2.8.0-wasi-tls',
      registry: 'http://127.0.0.1:25000',
    });
    expect(script).toStartWith('set -eu; /opt/podman/bin/podman build -t ');
    expect(script).toContain('curl -fsS http://127.0.0.1:25000/v2/');
    expect(script).toContain(
      '/opt/podman/bin/podman push --tls-verify=false 127.0.0.1:25000/di-framework/wash:2.8.0-wasi-tls',
    );
  });

  test('docker pushes without the podman-only flag', () => {
    const script = hostImageCommand({
      containerCli: 'docker',
      context: 'tenant-host',
      localImage: 'local/wash',
      pushImage: '127.0.0.1:25000/wash',
      registry: 'http://127.0.0.1:25000',
    });
    expect(script).toContain('docker push 127.0.0.1:25000/wash');
    expect(script).not.toContain('--tls-verify');
  });

  test('fills the gateway URL pattern', () => {
    expect(routeUrl('http://{host}.{tenant}.localhost:28180', 'mesh-site', 'meshtastic')).toBe(
      'http://mesh-site.meshtastic.localhost:28180/',
    );
  });

  test('opens the console from the example directory with the tenant kubeconfig', () => {
    expect(
      consoleCommand('/w/platform-examples', '/w/platform-examples/deploy/.t.kubeconfig'),
    ).toBe(
      'cd /w/platform-examples && KUBECONFIG=/w/platform-examples/deploy/.t.kubeconfig di-framework platform console',
    );
  });

  test('prefers docker, falls back to podman', () => {
    expect(chooseContainerCli(() => true)).toBe('docker');
    expect(chooseContainerCli((name) => name === 'podman')).toBe('podman');
    expect(chooseContainerCli(() => false)).toBeUndefined();
  });
});
