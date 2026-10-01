import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create, toBinary } from '@bufbuild/protobuf';
import { Mesh, Mqtt } from '@meshtastic/protobufs';
import { ingest } from '../src/ingest';
import { accept } from '../src/session';
import { memoryStore, openDirectoryStore } from '../src/store';

const now = new Date('2026-10-01T00:00:00.000Z');

function envelope(encrypted: boolean): Uint8Array {
  const packet = create(Mesh.MeshPacketSchema, {
    from: 0x11,
    to: 0xffffffff,
    id: 7,
    payloadVariant: encrypted
      ? { case: 'encrypted', value: new Uint8Array([1, 2, 3]) }
      : { case: 'decoded', value: create(Mesh.DataSchema, { portnum: 1 }) },
  });
  return toBinary(
    Mqtt.ServiceEnvelopeSchema,
    create(Mqtt.ServiceEnvelopeSchema, {
      packet,
      channelId: 'LongFast',
      gatewayId: '!abcd',
    }),
  );
}

function mapReport(): Uint8Array {
  return toBinary(
    Mqtt.MapReportSchema,
    create(Mqtt.MapReportSchema, {
      longName: 'Hill Node',
      shortName: 'HN',
      latitudeI: 377_000_000,
      longitudeI: -1_224_000_000,
      hwModel: 1,
      firmwareVersion: '2.5.0',
    }),
  );
}

describe('mesh collector ingest', () => {
  test('stores an encrypted envelope as opaque traffic and a stat', async () => {
    const payload = envelope(true);
    const store = memoryStore();
    await accept('msh/US/2/e/LongFast/!abcd', payload, store, now);
    expect(store.traffic).toEqual([
      {
        topic: 'msh/US/2/e/LongFast/!abcd',
        gatewayId: '!abcd',
        channelId: 'LongFast',
        from: 0x11,
        ts: '2026-10-01T00:00:00.000Z',
        raw: Buffer.from(payload).toString('base64'),
      },
    ]);
    expect(store.stats).toEqual([
      {
        topic: 'msh/US/2/e/LongFast/!abcd',
        gatewayId: '!abcd',
        channelId: 'LongFast',
        from: 0x11,
        count: 1,
      },
    ]);
    expect(store.maps).toEqual([]);
    await accept('msh/US/2/e/LongFast/!abcd', payload, store, now);
    expect(store.stats[0]?.count).toBe(2);
  });

  test('keeps a decoded envelope without an encrypted stat', async () => {
    const result = ingest('msh/US/2/e/LongFast/!abcd', envelope(false), now);
    expect(result.kind).toBe('traffic');
    if (result.kind !== 'traffic') return;
    expect(result.encrypted).toBe(false);
    expect(result.decodedPort).toBe(1);
    expect(result.record.raw.length).toBeGreaterThan(0);
  });

  test('decodes a broker map report wrapped in a service envelope', async () => {
    const report = toBinary(
      Mqtt.MapReportSchema,
      create(Mqtt.MapReportSchema, {
        longName: 'KE4PMP_JR',
        shortName: 'JRR1',
        latitudeI: 321_519_616,
        longitudeI: -816_185_344,
        hwModel: 4,
        firmwareVersion: '2.7.0',
      }),
    );
    const payload = toBinary(
      Mqtt.ServiceEnvelopeSchema,
      create(Mqtt.ServiceEnvelopeSchema, {
        packet: create(Mesh.MeshPacketSchema, {
          from: 0xdad88120,
          payloadVariant: {
            case: 'decoded',
            value: create(Mesh.DataSchema, { portnum: 73, payload: report }),
          },
        }),
        channelId: 'LongFast',
        gatewayId: '!dad88120',
      }),
    );
    const store = memoryStore();
    await accept('msh/US/2/map/', payload, store, now);
    expect(store.maps).toEqual([
      {
        topic: 'msh/US/2/map/',
        ts: '2026-10-01T00:00:00.000Z',
        longName: 'KE4PMP_JR',
        shortName: 'JRR1',
        latitude: 32.15196,
        longitude: -81.61853,
        hwModel: 4,
        firmwareVersion: '2.7.0',
      },
    ]);
    expect(store.traffic).toEqual([]);
  });

  test('plots a cleartext position and keeps one row per node', async () => {
    const position = (latitudeI: number) =>
      toBinary(
        Mqtt.ServiceEnvelopeSchema,
        create(Mqtt.ServiceEnvelopeSchema, {
          packet: create(Mesh.MeshPacketSchema, {
            from: 0x11,
            to: 0xffffffff,
            id: 9,
            payloadVariant: {
              case: 'decoded',
              value: create(Mesh.DataSchema, {
                portnum: 3,
                payload: toBinary(
                  Mesh.PositionSchema,
                  create(Mesh.PositionSchema, {
                    latitudeI,
                    longitudeI: -733_216_768,
                    altitude: 44,
                  }),
                ),
              }),
            },
          }),
          channelId: 'LongFast',
          gatewayId: '!abcd',
        }),
      );
    const store = memoryStore();
    await accept('msh/US/2/e/LongFast/!00000011', position(409_206_784), store, now);
    await accept('msh/US/2/e/LongFast/!00000011', position(410_000_000), store, now);
    expect(store.traffic).toHaveLength(2);
    expect(store.maps).toEqual([
      {
        topic: 'msh/US/2/e/LongFast/!00000011',
        ts: '2026-10-01T00:00:00.000Z',
        longName: '!00000011',
        shortName: '0011',
        latitude: 41,
        longitude: -73.32168,
        hwModel: 0,
        firmwareVersion: '',
      },
    ]);
  });

  test('decodes a map report into a coarse position event', async () => {
    const store = memoryStore();
    await accept('msh/US/2/map/!abcd', mapReport(), store, now);
    expect(store.maps).toEqual([
      {
        topic: 'msh/US/2/map/!abcd',
        ts: '2026-10-01T00:00:00.000Z',
        longName: 'Hill Node',
        shortName: 'HN',
        latitude: 37.7,
        longitude: -122.4,
        hwModel: 1,
        firmwareVersion: '2.5.0',
      },
    ]);
    expect(store.traffic).toEqual([]);
  });

  test('ignores a payload that is not the expected message', async () => {
    const store = memoryStore();
    await accept('msh/US/2/e/LongFast/!abcd', new Uint8Array([0xff, 0xff, 0xff]), store, now);
    expect(store.traffic).toEqual([]);
    expect(store.stats).toEqual([]);
  });

  test('appends the traffic file and rewrites encrypted counts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mesh-collector-'));
    const store = await openDirectoryStore(directory);
    const payload = envelope(true);
    await accept('msh/US/2/e/LongFast/!abcd', payload, store, now);
    await accept('msh/US/2/e/LongFast/!abcd', payload, store, now);
    const lines = (await readFile(join(directory, 'traffic.jsonl'), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      gatewayId: '!abcd',
      channelId: 'LongFast',
      from: 0x11,
    });
    expect(JSON.parse(await readFile(join(directory, 'stats.json'), 'utf8'))).toEqual([
      {
        topic: 'msh/US/2/e/LongFast/!abcd',
        gatewayId: '!abcd',
        channelId: 'LongFast',
        from: 0x11,
        count: 2,
      },
    ]);
  });
});
