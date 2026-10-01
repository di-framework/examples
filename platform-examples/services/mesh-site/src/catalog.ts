import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Shared catalog container written by mesh-collector. */
export const MESH_CONTAINER = 'mesh';
const TRAFFIC_OBJECT = 'traffic.jsonl';
const MAPS_OBJECT = 'maps.jsonl';
const STATS_OBJECT = 'stats.json';

export type MapView = {
  topic: string;
  ts: string;
  longName: string;
  shortName: string;
  latitude: number;
  longitude: number;
  hwModel: number;
  firmwareVersion: string;
};

export type TrafficView = {
  topic: string;
  gatewayId: string;
  channelId: string;
  from: number;
  ts: string;
};

export type StatView = {
  topic: string;
  gatewayId: string;
  channelId: string;
  from: number;
  count: number;
};

export type CatalogSnapshot = {
  maps: MapView[];
  traffic: TrafficView[];
  stats: StatView[];
};

const TRAFFIC_LIMIT = 50;
const MAP_LIMIT = 100;

type Env = Record<string, string | undefined>;

export function catalogDirectory(env: Env): string {
  return env.DI_STORAGE_DIR || env.MESH_DATA_DIR || 'data';
}

export async function readCatalog(directory: string): Promise<CatalogSnapshot> {
  const [mapsText, trafficText, statsText] = await Promise.all([
    readFile(join(directory, 'maps.jsonl'), 'utf8').catch(() => ''),
    readFile(join(directory, 'traffic.jsonl'), 'utf8').catch(() => ''),
    readFile(join(directory, 'stats.json'), 'utf8').catch(() => ''),
  ]);
  return catalogFromText(mapsText, trafficText, statsText);
}

type MeshContainer = {
  objectInfo(name: string): Promise<unknown>;
  getData(name: string, start: number, end: number): Promise<unknown>;
};

type MeshBlobstore = {
  getContainer(name: string): Promise<unknown>;
  createContainer(name: string): Promise<unknown>;
};

/** Read the collector's blobstore objects. A missing container or object is an empty catalog. */
export async function readBlobCatalog(blobstore: MeshBlobstore): Promise<CatalogSnapshot> {
  try {
    const container = await openMeshContainer(blobstore);
    const [mapsText, trafficText, statsText] = await Promise.all([
      readObject(container, MAPS_OBJECT),
      readObject(container, TRAFFIC_OBJECT),
      readObject(container, STATS_OBJECT),
    ]);
    return catalogFromText(mapsText ?? '', trafficText ?? '', statsText ?? '');
  } catch {
    return { maps: [], traffic: [], stats: [] };
  }
}

function catalogFromText(
  mapsText: string,
  trafficText: string,
  statsText: string,
): CatalogSnapshot {
  const maps = parseLines(mapsText, isMapView);
  const traffic = parseLines(trafficText, isTrafficRecord);
  return {
    maps: maps.slice(-MAP_LIMIT),
    traffic: traffic.slice(-TRAFFIC_LIMIT).map((record) => ({
      topic: record.topic,
      gatewayId: record.gatewayId,
      channelId: record.channelId,
      from: record.from,
      ts: record.ts,
    })),
    stats: parseStats(statsText),
  };
}

function parseLines<T>(text: string, accept: (value: unknown) => value is T): T[] {
  const rows: T[] = [];
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (accept(parsed)) rows.push(parsed);
    } catch {
      // A torn write at the end of the object is not a record.
    }
  }
  return rows;
}

function parseStats(text: string): StatView[] {
  if (text.trim().length === 0) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStatView);
  } catch {
    return [];
  }
}

type BlobResult = { tag?: string; val?: unknown };

function unwrap<T>(value: unknown): T {
  if (value && typeof value === 'object' && 'tag' in value) {
    const result = value as BlobResult;
    if (result.tag === 'err') throw new Error(`blobstore ${JSON.stringify(result.val)}`);
    if (result.tag === 'ok') return result.val as T;
  }
  return value as T;
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
    const body = unwrap<AsyncIterable<Uint8Array | number>>(await container.getData(name, 0, size));
    return await streamText(body);
  } catch {
    return undefined;
  }
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

function isMapView(value: unknown): value is MapView {
  if (!isRecord(value)) return false;
  return (
    typeof value.topic === 'string' &&
    typeof value.ts === 'string' &&
    typeof value.longName === 'string' &&
    typeof value.shortName === 'string' &&
    typeof value.latitude === 'number' &&
    typeof value.longitude === 'number' &&
    typeof value.hwModel === 'number' &&
    typeof value.firmwareVersion === 'string'
  );
}

type TrafficRecord = TrafficView & { raw?: string };

function isTrafficRecord(value: unknown): value is TrafficRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.topic === 'string' &&
    typeof value.gatewayId === 'string' &&
    typeof value.channelId === 'string' &&
    typeof value.from === 'number' &&
    typeof value.ts === 'string'
  );
}

function isStatView(value: unknown): value is StatView {
  if (!isRecord(value)) return false;
  return (
    typeof value.topic === 'string' &&
    typeof value.gatewayId === 'string' &&
    typeof value.channelId === 'string' &&
    typeof value.from === 'number' &&
    typeof value.count === 'number'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
