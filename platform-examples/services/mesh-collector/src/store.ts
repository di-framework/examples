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
