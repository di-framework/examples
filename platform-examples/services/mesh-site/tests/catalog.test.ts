import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogDirectory, readCatalog } from '../src/catalog';

function mapLine(index: number): string {
  return JSON.stringify({
    topic: `msh/US/2/map/${index}`,
    ts: '2026-10-01T00:00:00.000Z',
    longName: `Node ${index}`,
    shortName: 'ND',
    latitude: 37.7,
    longitude: -122.4,
    hwModel: 1,
    firmwareVersion: '2.5.0',
  });
}

function trafficLine(index: number): string {
  return JSON.stringify({
    topic: `msh/US/2/e/LongFast/${index}`,
    gatewayId: '!abcd',
    channelId: 'LongFast',
    from: index,
    ts: '2026-10-01T00:00:00.000Z',
    raw: 'c2VjcmV0',
  });
}

describe('mesh catalog', () => {
  test('prefers the platform storage directory', () => {
    expect(catalogDirectory({})).toBe('data');
    expect(catalogDirectory({ MESH_DATA_DIR: 'mesh' })).toBe('mesh');
    expect(catalogDirectory({ DI_STORAGE_DIR: '', MESH_DATA_DIR: 'mesh' })).toBe('mesh');
    expect(catalogDirectory({ DI_STORAGE_DIR: '/data', MESH_DATA_DIR: 'mesh' })).toBe('/data');
  });

  test('reads map rows, traffic without the raw payload, and encrypted counts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mesh-catalog-'));
    await writeFile(
      join(directory, 'maps.jsonl'),
      `${mapLine(1)}\nnot json\n${JSON.stringify({ topic: 'incomplete' })}\n`,
    );
    await writeFile(join(directory, 'traffic.jsonl'), `${trafficLine(4)}\n`);
    await writeFile(
      join(directory, 'stats.json'),
      JSON.stringify([
        {
          topic: 'msh/US/2/e/LongFast/4',
          gatewayId: '!abcd',
          channelId: 'LongFast',
          from: 4,
          count: 2,
        },
        { topic: 'skipped' },
      ]),
    );

    const snapshot = await readCatalog(directory);
    expect(snapshot.maps).toEqual([
      {
        topic: 'msh/US/2/map/1',
        ts: '2026-10-01T00:00:00.000Z',
        longName: 'Node 1',
        shortName: 'ND',
        latitude: 37.7,
        longitude: -122.4,
        hwModel: 1,
        firmwareVersion: '2.5.0',
      },
    ]);
    expect(snapshot.traffic).toEqual([
      {
        topic: 'msh/US/2/e/LongFast/4',
        gatewayId: '!abcd',
        channelId: 'LongFast',
        from: 4,
        ts: '2026-10-01T00:00:00.000Z',
      },
    ]);
    expect(snapshot.traffic[0]).not.toHaveProperty('raw');
    expect(snapshot.stats).toEqual([
      {
        topic: 'msh/US/2/e/LongFast/4',
        gatewayId: '!abcd',
        channelId: 'LongFast',
        from: 4,
        count: 2,
      },
    ]);
  });

  test('returns empty lists when the files are missing or stats are not an array', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mesh-catalog-empty-'));
    expect(await readCatalog(directory)).toEqual({ maps: [], traffic: [], stats: [] });
    await writeFile(join(directory, 'stats.json'), JSON.stringify({ topic: 'nope' }));
    await writeFile(join(directory, 'maps.jsonl'), 'null\n');
    expect(await readCatalog(directory)).toEqual({ maps: [], traffic: [], stats: [] });
    await writeFile(join(directory, 'stats.json'), 'not json');
    expect((await readCatalog(directory)).stats).toEqual([]);
  });

  test('keeps the latest map and traffic rows', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mesh-catalog-cap-'));
    await writeFile(
      join(directory, 'maps.jsonl'),
      `${Array.from({ length: 101 }, (_, index) => mapLine(index)).join('\n')}\n`,
    );
    await writeFile(
      join(directory, 'traffic.jsonl'),
      `${Array.from({ length: 51 }, (_, index) => trafficLine(index)).join('\n')}\n`,
    );
    const snapshot = await readCatalog(directory);
    expect(snapshot.maps).toHaveLength(100);
    expect(snapshot.maps[0]?.topic).toBe('msh/US/2/map/1');
    expect(snapshot.maps.at(-1)?.topic).toBe('msh/US/2/map/100');
    expect(snapshot.traffic).toHaveLength(50);
    expect(snapshot.traffic[0]?.from).toBe(1);
    expect(snapshot.traffic.at(-1)?.from).toBe(50);
  });
});
