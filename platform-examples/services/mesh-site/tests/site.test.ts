import { describe, expect, test } from 'bun:test';
import { resetGuests, setGuests } from '@di-framework/bindings';
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

function memoryObjects(initial: Record<string, string>) {
  const objects = new Map(
    Object.entries(initial).map(([name, text]) => [name, new TextEncoder().encode(text)]),
  );
  const container = {
    async objectInfo(name: string) {
      const body = objects.get(name);
      if (body === undefined) return { tag: 'err', val: 'no-such-object' };
      return { tag: 'ok', val: { name, container: 'mesh', createdAt: 0, size: body.length } };
    },
    async getData(name: string, start: number, end: number) {
      const body = objects.get(name);
      if (body === undefined) return { tag: 'err', val: 'no-such-object' };
      return {
        tag: 'ok',
        val: (async function* stream() {
          yield body.subarray(start, end);
        })(),
      };
    },
    async writeData() {
      return { tag: 'ok' };
    },
  };
  return {
    async getContainer(name: string) {
      if (name !== 'mesh') return { tag: 'err', val: 'no-such-container' };
      return { tag: 'ok', val: container };
    },
    async createContainer() {
      return { tag: 'err', val: 'container-already-exists' };
    },
  };
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
    setGuests({
      objects: memoryObjects({
        'traffic.jsonl': `${JSON.stringify({
          topic: 'msh/US/2/e/LongFast/!abcd',
          gatewayId: '!abcd',
          channelId: 'LongFast',
          from: 17,
          ts: '2026-10-01T00:00:00.000Z',
          raw: 'c2VjcmV0',
        })}\n`,
        'maps.jsonl': '',
        'stats.json': '[]',
      }),
    });
    try {
      const response = await handle(new Request('http://mesh-site/api/catalog'));
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
    } finally {
      resetGuests();
    }
  });

  test('refuses a caller that has no grant', async () => {
    const site = useContainer().resolve(UnboundSite);
    await expect(site.catalog.snapshot()).rejects.toBeInstanceOf(UnboundCallerError);
  });
});
