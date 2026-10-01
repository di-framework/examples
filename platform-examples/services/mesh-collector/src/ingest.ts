import { fromBinary } from '@bufbuild/protobuf';
import { Mesh, Mqtt } from '@meshtastic/protobufs';

/** Meshtastic PortNum.POSITION_APP. A cleartext position payload. */
const POSITION_PORT = 3;
/** Meshtastic PortNum.MAP_REPORT_APP. An unencrypted map report. */
const MAP_REPORT_PORT = 73;

/** One ServiceEnvelope, stored without decoding an encrypted payload. */
export type TrafficRecord = {
  topic: string;
  gatewayId: string;
  channelId: string;
  from: number;
  ts: string;
  raw: string;
};

/** A decoded /2/map/ report. Latitude and longitude are degrees. */
export type MapEvent = {
  topic: string;
  ts: string;
  longName: string;
  shortName: string;
  latitude: number;
  longitude: number;
  hwModel: number;
  firmwareVersion: string;
};

export type IngestResult =
  | {
      kind: 'traffic';
      record: TrafficRecord;
      encrypted: boolean;
      to?: number;
      id?: number;
      decodedPort?: number;
      position?: { latitude: number; longitude: number };
    }
  | { kind: 'map'; event: MapEvent }
  | { kind: 'invalid' };

export function nodeId(from: number): string {
  return `!${(from >>> 0).toString(16).padStart(8, '0')}`;
}

export function isMapTopic(topic: string): boolean {
  return topic.includes('/2/map/');
}

export function ingest(topic: string, payload: Uint8Array, now: Date): IngestResult {
  if (isMapTopic(topic)) {
    const report = mapReport(payload) ?? mapReportInEnvelope(payload);
    if (!report) return { kind: 'invalid' };
    return { kind: 'map', event: mapEvent(topic, now, report) };
  }

  try {
    const env = fromBinary(Mqtt.ServiceEnvelopeSchema, payload);
    const packet = env.packet;
    const variant = packet?.payloadVariant;
    const encrypted = variant?.case === 'encrypted';
    const decoded = variant?.case === 'decoded' ? variant.value : undefined;
    const position = decoded?.portnum === POSITION_PORT ? positionOf(decoded.payload) : undefined;
    return {
      kind: 'traffic',
      encrypted,
      ...(packet ? { to: packet.to, id: packet.id } : {}),
      ...(decoded ? { decodedPort: decoded.portnum } : {}),
      ...(position ? { position } : {}),
      record: {
        topic,
        gatewayId: env.gatewayId,
        channelId: env.channelId,
        from: packet?.from ?? 0,
        ts: now.toISOString(),
        raw: toBase64(payload),
      },
    };
  } catch {
    return { kind: 'invalid' };
  }
}

function mapReport(payload: Uint8Array) {
  try {
    return fromBinary(Mqtt.MapReportSchema, payload);
  } catch {
    return undefined;
  }
}

/** The public broker publishes map reports as a ServiceEnvelope, port 73. */
function mapReportInEnvelope(payload: Uint8Array) {
  try {
    const env = fromBinary(Mqtt.ServiceEnvelopeSchema, payload);
    const variant = env.packet?.payloadVariant;
    if (variant?.case !== 'decoded' || variant.value.portnum !== MAP_REPORT_PORT) return undefined;
    return mapReport(variant.value.payload);
  } catch {
    return undefined;
  }
}

function mapEvent(
  topic: string,
  now: Date,
  report: {
    longName: string;
    shortName: string;
    latitudeI: number;
    longitudeI: number;
    hwModel: number;
    firmwareVersion: string;
  },
): MapEvent {
  return {
    topic,
    ts: now.toISOString(),
    longName: report.longName,
    shortName: report.shortName,
    latitude: degrees(report.latitudeI),
    longitude: degrees(report.longitudeI),
    hwModel: report.hwModel,
    firmwareVersion: report.firmwareVersion,
  };
}

function positionOf(payload: Uint8Array): { latitude: number; longitude: number } | undefined {
  try {
    const position = fromBinary(Mesh.PositionSchema, payload);
    const latitude = degrees(position.latitudeI ?? 0);
    const longitude = degrees(position.longitudeI ?? 0);
    if (latitude === 0 && longitude === 0) return undefined;
    return { latitude, longitude };
  } catch {
    return undefined;
  }
}

/** Map reports are published as degrees × 1e7. Keep five decimal places. */
function degrees(fixed: number): number {
  return Math.round(fixed / 100) / 1e5;
}

function toBase64(payload: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(payload).toString('base64');
  let binary = '';
  for (const byte of payload) binary += String.fromCharCode(byte);
  return btoa(binary);
}
