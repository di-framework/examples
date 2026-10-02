import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MapEvent, TrafficRecord } from './ingest';

/** Count of encrypted envelopes that were stored and not decoded. */
export type TrafficStat = {
  topic: string;
  gatewayId: string;
  channelId: string;
  from: number;
  count: number;
};

export type CollectorStore = {
  saveTraffic(record: TrafficRecord): Promise<void>;
  saveMap(event: MapEvent): Promise<void>;
  addEncrypted(stat: Omit<TrafficStat, 'count'>): Promise<void>;
};

export function memoryStore(): CollectorStore & {
  traffic: TrafficRecord[];
  maps: MapEvent[];
  stats: TrafficStat[];
} {
  const traffic: TrafficRecord[] = [];
  const maps: MapEvent[] = [];
  const stats: TrafficStat[] = [];
  return {
    traffic,
    maps,
    stats,
    async saveTraffic(record) {
      traffic.push(record);
    },
    async saveMap(event) {
      const index = maps.findIndex((entry) => samePlace(entry, event));
      if (index >= 0) maps[index] = event;
      else maps.push(event);
    },
    async addEncrypted(stat) {
      const found = stats.find((entry) => sameStat(entry, stat));
      if (found) found.count += 1;
      else stats.push({ ...stat, count: 1 });
    },
  };
}

export async function openDirectoryStore(directory: string): Promise<CollectorStore> {
  await mkdir(directory, { recursive: true });
  const trafficPath = join(directory, 'traffic.jsonl');
  const mapPath = join(directory, 'maps.jsonl');
  const statsPath = join(directory, 'stats.json');
  let chain = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const run = chain.then(work, work);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  return {
    saveTraffic(record) {
      return enqueue(() => appendFile(trafficPath, `${JSON.stringify(record)}\n`));
    },
    saveMap(event) {
      return enqueue(async () => {
        const maps = await readMaps(mapPath);
        const index = maps.findIndex((entry) => samePlace(entry, event));
        if (index >= 0) maps[index] = event;
        else maps.push(event);
        const body = maps.map((entry) => JSON.stringify(entry)).join('\n');
        await writeFile(mapPath, `${body}\n`);
      });
    },
    addEncrypted(stat) {
      return enqueue(async () => {
        const stats = await readStats(statsPath);
        const found = stats.find((entry) => sameStat(entry, stat));
        if (found) found.count += 1;
        else stats.push({ ...stat, count: 1 });
        await writeFile(statsPath, JSON.stringify(stats));
      });
    },
  };
}

async function readStats(path: string): Promise<TrafficStat[]> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStat);
  } catch {
    return [];
  }
}

function isStat(value: unknown): value is TrafficStat {
  if (value === null || typeof value !== 'object') return false;
  const stat = value as Partial<TrafficStat>;
  return (
    typeof stat.topic === 'string' &&
    typeof stat.gatewayId === 'string' &&
    typeof stat.channelId === 'string' &&
    typeof stat.from === 'number' &&
    typeof stat.count === 'number'
  );
}

async function readMaps(path: string): Promise<MapEvent[]> {
  try {
    const text = await readFile(path, 'utf8');
    const maps: MapEvent[] = [];
    for (const line of text.split('\n')) {
      if (line.trim().length === 0) continue;
      try {
        const parsed = JSON.parse(line) as MapEvent;
        if (typeof parsed.longName === 'string' && typeof parsed.shortName === 'string')
          maps.push(parsed);
      } catch {
        // A torn write is not a place.
      }
    }
    return maps;
  } catch {
    return [];
  }
}

function samePlace(
  left: Pick<MapEvent, 'longName' | 'shortName'>,
  right: Pick<MapEvent, 'longName' | 'shortName'>,
): boolean {
  return left.longName === right.longName && left.shortName === right.shortName;
}

function sameStat(left: Omit<TrafficStat, 'count'>, right: Omit<TrafficStat, 'count'>): boolean {
  return (
    left.topic === right.topic &&
    left.gatewayId === right.gatewayId &&
    left.channelId === right.channelId &&
    left.from === right.from
  );
}

/** Shared catalog container. mesh-site reads the same objects. */
export const MESH_CONTAINER = 'mesh';
const TRAFFIC_OBJECT = 'traffic.jsonl';
const MAPS_OBJECT = 'maps.jsonl';
const STATS_OBJECT = 'stats.json';
const TRAFFIC_CAP = 200;

type BlobResult = { tag?: string; val?: unknown };

type MeshContainer = {
  objectInfo(name: string): Promise<unknown>;
  getData(name: string, start: number, end: number): Promise<unknown>;
  writeData(name: string, data: AsyncIterable<Uint8Array>): Promise<unknown>;
};

type MeshBlobstore = {
  getContainer(name: string): Promise<unknown>;
  createContainer(name: string): Promise<unknown>;
};

function unwrap<T>(value: unknown): T {
  if (value && typeof value === 'object' && 'tag' in value) {
    const result = value as BlobResult;
    if (result.tag === 'err') throw new Error(`blobstore ${JSON.stringify(result.val)}`);
    if (result.tag === 'ok') return result.val as T;
  }
  return value as T;
}

async function* byteStream(value: string): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode(value);
}

async function streamText(stream: AsyncIterable<Uint8Array | number>): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'number' ? Uint8Array.of(chunk) : chunk);
  }
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

async function openMeshContainer(blobstore: MeshBlobstore): Promise<MeshContainer> {
  try {
    return unwrap<MeshContainer>(await blobstore.getContainer(MESH_CONTAINER));
  } catch {
    try {
      return unwrap<MeshContainer>(await blobstore.createContainer(MESH_CONTAINER));
    } catch {
      return unwrap<MeshContainer>(await blobstore.getContainer(MESH_CONTAINER));
    }
  }
}

async function readObject(container: MeshContainer, name: string): Promise<string | undefined> {
  try {
    const info = unwrap<{ size?: number | bigint }>(await container.objectInfo(name));
    const size = Number(info.size ?? 0);
    if (!Number.isFinite(size) || size <= 0) return '';
    // The blobstore probe reads with end equal to the byte length.
    const body = unwrap<AsyncIterable<Uint8Array | number>>(await container.getData(name, 0, size));
    return await streamText(body);
  } catch {
    return undefined;
  }
}

async function writeObject(container: MeshContainer, name: string, body: string): Promise<void> {
  unwrap(await container.writeData(name, byteStream(body)));
}

/** Collector writes. mesh-site reads the same container through its own binding. */
export async function openBlobStore(blobstore: MeshBlobstore): Promise<CollectorStore> {
  const container = await openMeshContainer(blobstore);
  let chain = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const run = chain.then(work, work);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  return {
    saveTraffic(record) {
      return enqueue(async () => {
        const lines = ((await readObject(container, TRAFFIC_OBJECT)) ?? '')
          .split('\n')
          .filter((line) => line.trim().length > 0);
        lines.push(JSON.stringify(record));
        const kept = lines.slice(-TRAFFIC_CAP);
        await writeObject(container, TRAFFIC_OBJECT, `${kept.join('\n')}\n`);
      });
    },
    saveMap(event) {
      return enqueue(async () => {
        const maps = parseMaps(await readObject(container, MAPS_OBJECT));
        const index = maps.findIndex((entry) => samePlace(entry, event));
        if (index >= 0) maps[index] = event;
        else maps.push(event);
        const body = maps.map((entry) => JSON.stringify(entry)).join('\n');
        await writeObject(container, MAPS_OBJECT, `${body}\n`);
      });
    },
    addEncrypted(stat) {
      return enqueue(async () => {
        const stats = parseStats(await readObject(container, STATS_OBJECT));
        const found = stats.find((entry) => sameStat(entry, stat));
        if (found) found.count += 1;
        else stats.push({ ...stat, count: 1 });
        await writeObject(container, STATS_OBJECT, JSON.stringify(stats));
      });
    },
  };
}

function parseStats(text: string | undefined): TrafficStat[] {
  if (text === undefined || text.trim().length === 0) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStat);
  } catch {
    return [];
  }
}

function parseMaps(text: string | undefined): MapEvent[] {
  if (text === undefined) return [];
  const maps: MapEvent[] = [];
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as MapEvent;
      if (typeof parsed.longName === 'string' && typeof parsed.shortName === 'string')
        maps.push(parsed);
    } catch {
      // A torn write is not a place.
    }
  }
  return maps;
}
