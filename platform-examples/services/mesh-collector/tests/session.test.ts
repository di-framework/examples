import { describe, expect, test } from 'bun:test';
import { create, toBinary } from '@bufbuild/protobuf';
import { Mqtt } from '@meshtastic/protobufs';
import { collectorConfig } from '../src/config';
import { type MqttLike, runSession } from '../src/session';
import { memoryStore } from '../src/store';

function fakeClient(): MqttLike & {
  subscriptions: string[];
  emit(event: 'connect'): void;
  emit(event: 'message', topic: string, payload: Uint8Array): void;
  emit(event: 'close'): void;
  emit(event: 'error', error: Error): void;
} {
  const listeners = new Map<string, ((...args: never[]) => void)[]>();
  const subscriptions: string[] = [];
  return {
    subscriptions,
    on(event: string, listener: (...args: never[]) => void) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
    },
    subscribe(topic: string) {
      subscriptions.push(topic);
    },
    end() {
      for (const listener of listeners.get('close') ?? []) listener();
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? [])
        (listener as (...values: unknown[]) => void)(...args);
    },
  };
}

describe('mesh collector session', () => {
  test('subscribes on connect and stores a map report', async () => {
    const client = fakeClient();
    const store = memoryStore();
    const done = runSession(
      client,
      ['msh/US/2/e/LongFast/#', 'msh/US/2/map/#'],
      store,
      () => new Date('2026-10-01T00:00:00.000Z'),
    );
    client.emit('connect');
    expect(client.subscriptions).toEqual(['msh/US/2/e/LongFast/#', 'msh/US/2/map/#']);
    const payload = toBinary(
      Mqtt.MapReportSchema,
      create(Mqtt.MapReportSchema, { longName: 'Hill', shortName: 'H', firmwareVersion: '2.5.0' }),
    );
    client.emit('message', 'msh/US/2/map/!node', payload);
    await waitFor(() => store.maps.length === 1);
    expect(store.maps[0]?.longName).toBe('Hill');
    client.emit('close');
    await done;
  });

  test('uses the public broker defaults unless the environment overrides them', () => {
    const config = collectorConfig({}, 42, 1_700_000_000_000);
    expect(config.url).toBe('mqtt://mqtt.meshtastic.org:1883');
    expect(config.username).toBe('meshdev');
    expect(config.clientId).toBe('catalog-42-1700000000000');
    expect(config.topics).toEqual(['msh/US/2/e/LongFast/#', 'msh/US/2/map/#']);
    expect(config.password.length).toBeGreaterThan(0);
    const overridden = collectorConfig(
      { MQTT_URL: 'mqtt://127.0.0.1:1883', MQTT_TOPICS: 'msh/US/2/map/#' },
      1,
      2,
    );
    expect(overridden.url).toBe('mqtt://127.0.0.1:1883');
    expect(overridden.topics).toEqual(['msh/US/2/map/#']);
  });
});

async function waitFor(ready: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('timed out waiting for the collector');
}
