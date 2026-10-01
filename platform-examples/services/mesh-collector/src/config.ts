export type Env = Record<string, string | undefined>;

export type CollectorConfig = {
  url: string;
  username: string;
  password: string;
  clientId: string;
  topics: string[];
};

const DEFAULT_TOPICS = ['msh/US/2/e/LongFast/#', 'msh/US/2/map/#'];

export function collectorConfig(env: Env, pid: number, now: number): CollectorConfig {
  const topics = (env.MQTT_TOPICS ?? DEFAULT_TOPICS.join(','))
    .split(',')
    .map((topic) => topic.trim())
    .filter((topic) => topic.length > 0);
  return {
    url: env.MQTT_URL || 'mqtt://mqtt.meshtastic.org:1883',
    username: env.MQTT_USERNAME || 'meshdev',
    password: env.MQTT_PASSWORD || 'large4cats',
    clientId: env.MQTT_CLIENT_ID || `catalog-${pid}-${now}`,
    topics: topics.length > 0 ? topics : [...DEFAULT_TOPICS],
  };
}

/** Platform persistent workloads set DI_STORAGE_DIR. Local runs can set MESH_DATA_DIR. */
export function storageDirectory(env: Env): string {
  return env.DI_STORAGE_DIR || env.MESH_DATA_DIR || 'data';
}
