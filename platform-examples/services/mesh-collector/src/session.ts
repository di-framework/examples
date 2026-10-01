import { connect, type MqttClient } from 'mqtt';
import { type CollectorConfig, collectorConfig, type Env, storageDirectory } from './config';
import { ingest, nodeId } from './ingest';
import { type CollectorStore, openDirectoryStore } from './store';

export type MqttLike = {
  on(event: 'connect', listener: () => void): void;
  on(event: 'message', listener: (topic: string, payload: Uint8Array) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'close', listener: () => void): void;
  subscribe(topic: string): void;
  end(force?: boolean): void;
};

export type CollectorDeps = {
  env: Env;
  pid: number;
  now: () => number;
  wait: (ms: number) => Promise<void>;
  connect: (config: CollectorConfig) => MqttLike;
  store?: CollectorStore;
};

export async function accept(
  topic: string,
  payload: Uint8Array,
  store: CollectorStore,
  now = new Date(),
): Promise<void> {
  const result = ingest(topic, payload, now);
  if (result.kind === 'invalid') {
    console.error(`Ignored undecodable payload on ${topic}`);
    return;
  }
  if (result.kind === 'map') {
    console.log('map', topic, result.event);
    await store.saveMap(result.event);
    return;
  }
  console.log({
    topic,
    channelId: result.record.channelId,
    gatewayId: result.record.gatewayId,
    from: result.record.from,
    to: result.to,
    id: result.id,
    encrypted: result.encrypted,
    decodedPort: result.decodedPort,
  });
  await store.saveTraffic(result.record);
  if (result.position) {
    const id = nodeId(result.record.from);
    await store.saveMap({
      topic: result.record.topic,
      ts: result.record.ts,
      longName: id,
      shortName: id.slice(-4),
      latitude: result.position.latitude,
      longitude: result.position.longitude,
      hwModel: 0,
      firmwareVersion: '',
    });
  }
  if (result.encrypted) {
    await store.addEncrypted({
      topic: result.record.topic,
      gatewayId: result.record.gatewayId,
      channelId: result.record.channelId,
      from: result.record.from,
    });
  }
}

export function runSession(
  client: MqttLike,
  topics: readonly string[],
  store: CollectorStore,
  now: () => Date = () => new Date(),
): Promise<void> {
  client.on('connect', () => {
    for (const topic of topics) client.subscribe(topic);
  });
  client.on('message', (topic, payload) => {
    void accept(topic, payload, store, now()).catch((error: unknown) => {
      console.error('Mesh collector failed to store a message', error);
    });
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    client.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    client.on('close', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
  });
}

export async function runCollector(deps: CollectorDeps = defaultDeps()): Promise<void> {
  const config = collectorConfig(deps.env, deps.pid, deps.now());
  const store = deps.store ?? (await openDirectoryStore(storageDirectory(deps.env)));
  for (;;) {
    const client = deps.connect(config);
    try {
      await runSession(client, config.topics, store, () => new Date(deps.now()));
    } catch (error) {
      console.error('Mesh collector session ended', error);
    } finally {
      client.end(true);
    }
    await deps.wait(5_000);
  }
}

function defaultDeps(): CollectorDeps {
  return {
    env: process.env,
    pid: process.pid,
    now: Date.now,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    connect: (config) =>
      connect(config.url, {
        clientId: config.clientId,
        username: config.username,
        password: config.password,
        protocolVersion: 4,
        clean: true,
      }) as MqttClient,
  };
}
