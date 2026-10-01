import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useContainer } from '@di-framework/core/container';
import { Container } from '@di-framework/core/decorators';
import { ServiceBinding, UnboundCallerError } from '@di-framework/core/service-bindings';
import { handle } from '../src/router';

@Container()
class UnboundSite {
  constructor(
    @ServiceBinding('catalog', { caller: 'mesh-unbound', target: 'mesh-catalog' })
    readonly catalog: { snapshot(): Promise<unknown> },
  ) {}
}

const previousStorage = process.env.DI_STORAGE_DIR;

async function withStorage<T>(directory: string, run: () => Promise<T>): Promise<T> {
  process.env.DI_STORAGE_DIR = directory;
  try {
    return await run();
  } finally {
    if (previousStorage === undefined) delete process.env.DI_STORAGE_DIR;
    else process.env.DI_STORAGE_DIR = previousStorage;
  }
}

describe('mesh site', () => {
  test('redirects the host root to the packaged page', async () => {
    const response = await handle(new Request('http://mesh-site/'));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/assets/index.html');
  });

  test('serves the packaged page and script', async () => {
    const page = await handle(new Request('http://mesh-site/assets/index.html'));
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('<title>Mesh</title>');

    const script = await handle(new Request('http://mesh-site/assets/app.js'));
    expect(script.status).toBe(200);
    const source = await script.text();
    expect(source).toContain("fill('maps'");
    expect(source).toContain('setInterval');
    expect(source).not.toContain('fill(catalog.maps');
  });

  test('answers an unknown path with JSON', async () => {
    const response = await handle(new Request('http://mesh-site/missing'));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });

  test('reads the catalog through the private binding and hides raw traffic', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mesh-site-'));
    await writeFile(
      join(directory, 'traffic.jsonl'),
      `${JSON.stringify({
        topic: 'msh/US/2/e/LongFast/!abcd',
        gatewayId: '!abcd',
        channelId: 'LongFast',
        from: 17,
        ts: '2026-10-01T00:00:00.000Z',
        raw: 'c2VjcmV0',
      })}\n`,
    );
    await writeFile(join(directory, 'maps.jsonl'), '');
    await writeFile(join(directory, 'stats.json'), '[]');

    const response = await withStorage(directory, () =>
      handle(new Request('http://mesh-site/api/catalog')),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.traffic).toEqual([
      {
        topic: 'msh/US/2/e/LongFast/!abcd',
        gatewayId: '!abcd',
        channelId: 'LongFast',
        from: 17,
        ts: '2026-10-01T00:00:00.000Z',
      },
    ]);
    expect(JSON.stringify(body)).not.toContain('c2VjcmV0');
  });

  test('refuses a caller that has no grant', async () => {
    const site = useContainer().resolve(UnboundSite);
    await expect(site.catalog.snapshot()).rejects.toBeInstanceOf(UnboundCallerError);
  });
});
