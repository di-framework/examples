import { describe, expect, test } from 'bun:test';
import { resetGuests, setGuests } from '@di-framework/bindings';
import { MeshObjects } from '../src/bindings';
import { openBlobStore } from '../src/store';

describe('blob store', () => {
  test('writes traffic, one map per node, and encrypted counts', async () => {
    const objects = new Map<string, Uint8Array>();
    const container = {
      async objectInfo(name: string) {
        const body = objects.get(name);
        if (body === undefined) return { tag: 'err', val: 'no-such-object' };
        return { tag: 'ok', val: { size: body.length } };
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
      async writeData(name: string, data: AsyncIterable<Uint8Array>) {
        const chunks: Uint8Array[] = [];
        for await (const chunk of data) chunks.push(chunk);
        const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        objects.set(name, bytes);
        return { tag: 'ok' };
      },
    };
    setGuests({
      objects: {
        async getContainer(name: string) {
          if (name !== 'mesh' || objects.size === 0)
            return { tag: 'err', val: 'no-such-container' };
          return { tag: 'ok', val: container };
        },
        async createContainer(name: string) {
          if (name !== 'mesh') return { tag: 'err', val: 'access-denied' };
          return { tag: 'ok', val: container };
        },
      },
    });
    try {
      const store = await openBlobStore(new MeshObjects());
      await store.saveTraffic({
        topic: 'msh/US/2/e/LongFast/!abcd',
        gatewayId: '!abcd',
        channelId: 'LongFast',
        from: 17,
        ts: '2026-10-01T00:00:00.000Z',
        raw: 'abc',
      });
      await store.saveMap({
        topic: 'msh/US/2/map/',
        ts: '2026-10-01T00:00:00.000Z',
        longName: 'KE4PMP_JR',
        shortName: 'JRR1',
        latitude: 32.15196,
        longitude: -81.61853,
        hwModel: 1,
        firmwareVersion: '2.5.0',
      });
      await store.saveMap({
        topic: 'msh/US/2/map/',
        ts: '2026-10-01T00:00:01.000Z',
        longName: 'KE4PMP_JR',
        shortName: 'JRR1',
        latitude: 32.2,
        longitude: -81.7,
        hwModel: 1,
        firmwareVersion: '2.5.0',
      });
      await store.addEncrypted({
        topic: 'msh/US/2/e/LongFast/!abcd',
        gatewayId: '!abcd',
        channelId: 'LongFast',
        from: 17,
      });
      await store.addEncrypted({
        topic: 'msh/US/2/e/LongFast/!abcd',
        gatewayId: '!abcd',
        channelId: 'LongFast',
        from: 17,
      });
      const text = (name: string) => new TextDecoder().decode(objects.get(name));
      expect(text('traffic.jsonl')).toContain('LongFast');
      expect(text('maps.jsonl').match(/KE4PMP_JR/g)).toHaveLength(1);
      expect(text('maps.jsonl')).toContain('32.2');
      expect(JSON.parse(text('stats.json'))).toEqual([
        {
          topic: 'msh/US/2/e/LongFast/!abcd',
          gatewayId: '!abcd',
          channelId: 'LongFast',
          from: 17,
          count: 2,
        },
      ]);
    } finally {
      resetGuests();
    }
  });
});
