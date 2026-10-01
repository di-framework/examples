import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

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
  const [maps, traffic, stats] = await Promise.all([
    readJsonLines(join(directory, 'maps.jsonl'), isMapView),
    readJsonLines(join(directory, 'traffic.jsonl'), isTrafficRecord),
    readStats(join(directory, 'stats.json')),
  ]);
  return {
    maps: maps.slice(-MAP_LIMIT),
    traffic: traffic.slice(-TRAFFIC_LIMIT).map((record) => ({
      topic: record.topic,
      gatewayId: record.gatewayId,
      channelId: record.channelId,
      from: record.from,
      ts: record.ts,
    })),
    stats,
  };
}

async function readJsonLines<T>(
  path: string,
  accept: (value: unknown) => value is T,
): Promise<T[]> {
  let text = '';
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  const rows: T[] = [];
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (accept(parsed)) rows.push(parsed);
    } catch {
      // A torn write at the end of the file is not a record.
    }
  }
  return rows;
}

async function readStats(path: string): Promise<StatView[]> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStatView);
  } catch {
    return [];
  }
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
