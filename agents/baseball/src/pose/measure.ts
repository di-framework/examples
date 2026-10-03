import type { Enhancer } from '../enhance.ts';
import { appendEnhancement } from '../game-log.ts';
import {
  armSlotDegrees as armSlotAngle,
  BODY,
  footImage,
  keypoint,
  type PosePerson,
  type PoseSample,
  torsoPixels,
  releaseHeightFeet as wristHeightFeet,
} from './body.ts';
import {
  alongBasepath,
  BASES,
  DIAMOND,
  distance,
  feetPerPixel,
  type Homography,
  type Point,
  project,
  ROLE_ANCHORS,
  type Role,
  solveHomography,
} from './geometry.ts';

export const FIELD_POSE_ID = 'field-pose';

const FIELDERS = new Set<Role>(['P', 'C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF']);
const MAX_TRACK_GAP_SECONDS = 3;
const MAX_SPEED_FEET_PER_SECOND = 40;

export type DiamondCalibration = {
  image: {
    home: Point;
    first: Point;
    second: Point;
    third: Point;
  };
};

export type FieldPoseData = {
  samples: number;
  tracks: number;
  homeToFirst: { seconds: number; start: number; end: number }[];
  leads: { base: 'first' | 'second' | 'third'; feet: number; time: number }[];
  breaks: {
    from: 'first' | 'second' | 'third';
    to: 'second' | 'third' | 'home';
    start: number;
  }[];
  arrivals: {
    base: 'first' | 'second' | 'third' | 'home';
    time: number;
    kind: 'advance' | 'return';
  }[];
  firstSteps: { role: Role; secondsAfterSwing: number; time: number }[];
  deliveries: {
    time: number;
    strideFeet: number;
    armSlotDegrees: number | null;
    releaseHeightFeet: number | null;
    tempoSeconds: number;
  }[];
  deliverySpread: { strideFeet: number; armSlotDegrees: number | null } | null;
  exchanges: { seconds: number; time: number }[];
  popTimes: { seconds: number; time: number }[];
  handedness: { throw: 'L' | 'R' | null; bat: 'L' | 'R' | null };
  handSpeedFeetPerSecond: number | null;
  torsoVsBasepath: number | null;
  limits: string[];
};

export type FieldPoseReport = { notes: string; data: FieldPoseData };

const LIMITS = [
  'Home-to-first starts at the first step and ends when a foot is within 4 ft of the bag.',
  'Hand speed is wrist speed on the ground-plane scale, not exit velocity.',
  'Release height assumes a 1.8 ft neck-to-hip segment in the image.',
  'Pop time runs from the catcher throw-wrist peak to the middle infielder glove wrist stopping.',
  'Timings do not change candidate counts.',
];

type Side = 'l' | 'r';

type Placed = {
  time: number;
  foot: Point;
  keypoints: PosePerson['keypoints'];
  role: Role | null;
  speed: number;
};

type Track = { id: string; samples: Placed[] };

type SeriesPoint = { time: number; value: number };

/** Turn OpenPose samples into scout timings. Does not read or write play events. */
export function measureFieldPose(
  samples: PoseSample[],
  calibration: DiamondCalibration,
): FieldPoseReport {
  if (!samples.length) throw new Error('Supply pose samples');
  for (const sample of samples) {
    if (!Number.isFinite(sample.time) || sample.time < 0)
      throw new Error('Pose sample times must be finite and non-negative');
  }
  const homography = solveHomography(
    [
      calibration.image.home,
      calibration.image.first,
      calibration.image.second,
      calibration.image.third,
    ],
    [DIAMOND.home, DIAMOND.first, DIAMOND.second, DIAMOND.third],
  );
  const tracks = buildTracks(samples, homography);
  const scale = (image: Point) => feetPerPixel(homography, image);
  const homeToFirst = measureHomeToFirst(tracks);
  const baserunning = measureBaserunning(tracks);
  const swings = batterWristPeaks(tracks, scale);
  const firstSteps = measureFirstSteps(tracks, swings);
  const mound = measureDeliveries(tracks, scale, (image) => project(homography, image));
  const catcher = measureCatcher(tracks, scale);
  const data: FieldPoseData = {
    samples: samples.length,
    tracks: tracks.length,
    homeToFirst,
    leads: baserunning.leads,
    breaks: baserunning.breaks,
    arrivals: baserunning.arrivals,
    firstSteps,
    deliveries: mound.deliveries,
    deliverySpread: mound.spread,
    exchanges: catcher.exchanges,
    popTimes: catcher.popTimes,
    handedness: {
      throw: mound.throwingHand,
      bat: batSide(tracks, swings, homography),
    },
    handSpeedFeetPerSecond: swings.length
      ? round3(Math.max(...swings.map((swing) => swing.value)))
      : null,
    torsoVsBasepath: torsoRatio(tracks, calibration),
    limits: LIMITS,
  };
  return { notes: buildNotes(data), data };
}

export function fieldPoseLayer(samples: PoseSample[], calibration: DiamondCalibration): Enhancer {
  return {
    id: FIELD_POSE_ID,
    async enhance(log, options) {
      options?.signal?.throwIfAborted();
      const report = measureFieldPose(samples, calibration);
      return appendEnhancement(log, {
        id: FIELD_POSE_ID,
        model: 'openpose-body25',
        at: new Date().toISOString(),
        notes: report.notes,
        data: report.data as Record<string, unknown>,
      });
    },
  };
}

function buildTracks(samples: PoseSample[], homography: Homography): Track[] {
  const ordered = [...samples].sort((a, b) => a.time - b.time);
  const finished: Track[] = [];
  let open: Track[] = [];
  let nextId = 1;
  for (const sample of ordered) {
    const nodes: Omit<Placed, 'speed'>[] = [];
    for (const person of sample.people) {
      const imageFoot = footImage(person);
      if (!imageFoot) continue;
      let foot: Point;
      try {
        foot = project(homography, imageFoot);
      } catch {
        continue;
      }
      if (!Number.isFinite(foot.x) || !Number.isFinite(foot.y)) continue;
      nodes.push({
        time: sample.time,
        foot,
        keypoints: person.keypoints,
        role: null,
      });
    }
    const roles = assignRoles(nodes.map((node) => node.foot));
    nodes.forEach((node, index) => {
      node.role = roles[index] ?? null;
    });

    const pairs: { track: Track; index: number; dist: number; gap: number }[] = [];
    for (const track of open) {
      const last = track.samples[track.samples.length - 1]!;
      const gap = sample.time - last.time;
      if (gap < 0 || gap > MAX_TRACK_GAP_SECONDS) continue;
      const limit = Math.max(3, MAX_SPEED_FEET_PER_SECOND * Math.max(gap, 1e-3));
      nodes.forEach((node, index) => {
        const dist = distance(last.foot, node.foot);
        if (dist <= limit) pairs.push({ track, index, dist, gap });
      });
    }
    pairs.sort((a, b) => a.dist - b.dist);
    const usedTracks = new Set<Track>();
    const usedNodes = new Set<number>();
    for (const pair of pairs) {
      if (usedTracks.has(pair.track) || usedNodes.has(pair.index)) continue;
      usedTracks.add(pair.track);
      usedNodes.add(pair.index);
      pair.track.samples.push({
        ...nodes[pair.index]!,
        speed: pair.gap > 0 ? pair.dist / pair.gap : 0,
      });
    }
    nodes.forEach((node, index) => {
      if (usedNodes.has(index)) return;
      open.push({ id: `p${nextId++}`, samples: [{ ...node, speed: 0 }] });
    });

    const still: Track[] = [];
    for (const track of open) {
      const last = track.samples[track.samples.length - 1]!.time;
      if (sample.time - last <= MAX_TRACK_GAP_SECONDS) still.push(track);
      else finished.push(track);
    }
    open = still;
  }
  return finished.concat(open);
}

function assignRoles(feet: Point[]): (Role | null)[] {
  const result: (Role | null)[] = feet.map(() => null);
  const pairs: { index: number; role: Role; ratio: number; dist: number }[] = [];
  feet.forEach((foot, index) => {
    for (const slot of ROLE_ANCHORS) {
      const dist = distance(foot, slot.at);
      if (dist <= slot.radius)
        pairs.push({ index, role: slot.role, ratio: dist / slot.radius, dist });
    }
  });
  pairs.sort((a, b) => a.ratio - b.ratio || a.dist - b.dist);
  const usedPeople = new Set<number>();
  const usedRoles = new Set<Role>();
  for (const pair of pairs) {
    if (usedPeople.has(pair.index) || usedRoles.has(pair.role)) continue;
    usedPeople.add(pair.index);
    usedRoles.add(pair.role);
    result[pair.index] = pair.role;
  }
  feet.forEach((foot, index) => {
    if (result[index]) return;
    let best: { role: Role; dist: number } | null = null;
    for (const base of BASES) {
      const dist = distance(foot, base.at);
      if (dist <= 18 && (!best || dist < best.dist))
        best = { role: base.id === 'first' ? 'R1' : base.id === 'second' ? 'R2' : 'R3', dist };
    }
    if (best) result[index] = best.role;
  });
  return result;
}

function measureHomeToFirst(tracks: Track[]): FieldPoseData['homeToFirst'] {
  const events: FieldPoseData['homeToFirst'] = [];
  for (const track of tracks) {
    const samples = track.samples;
    let arrival = -1;
    for (let index = 0; index < samples.length; index++) {
      // 0.05 ft of slack keeps a sample that lands on the 4 ft line from failing on float error.
      if (distance(samples[index]!.foot, DIAMOND.first) <= 4.05) {
        arrival = index;
        break;
      }
    }
    if (arrival <= 0) continue;
    const earlier: number[] = [];
    for (let index = 0; index < arrival; index++) {
      if (distance(samples[index]!.foot, DIAMOND.home) <= 12) earlier.push(index);
    }
    if (!earlier.length) continue;
    let startIndex = earlier[0]!;
    for (const index of earlier) {
      const sample = samples[index]!;
      const next = samples[index + 1];
      const moving =
        sample.speed >= 8 ||
        (next !== undefined && next.speed >= 8 && distance(sample.foot, DIAMOND.home) <= 8);
      if (moving) {
        startIndex = index;
        break;
      }
    }
    const start = samples[startIndex]!;
    const end = samples[arrival]!;
    const seconds = end.time - start.time;
    const progressed =
      alongBasepath(DIAMOND.home, DIAMOND.first, end.foot).along -
      alongBasepath(DIAMOND.home, DIAMOND.first, start.foot).along;
    if (seconds < 2.2 || seconds > 12 || progressed < 70) continue;
    events.push({
      seconds: round3(seconds),
      start: round3(start.time),
      end: round3(end.time),
    });
  }
  return events;
}

function measureBaserunning(tracks: Track[]) {
  const leads: FieldPoseData['leads'] = [];
  const breaks: FieldPoseData['breaks'] = [];
  const arrivals: FieldPoseData['arrivals'] = [];
  for (const track of tracks) {
    for (const base of BASES) {
      const projected = track.samples.map((sample) => ({
        sample,
        ...alongBasepath(base.at, base.nextAt, sample.foot),
      }));
      const hold = projected.filter(
        (row) => row.sample.speed < 8 && row.along >= 3 && row.along <= 25 && row.off < 8,
      );
      if (!hold.length) continue;
      const lead = hold.reduce((best, row) => (row.along > best.along ? row : best));
      leads.push({
        base: base.id,
        feet: round3(lead.along),
        time: round3(lead.sample.time),
      });
      let previousAlong = lead.along;
      let breakStart: number | null = null;
      for (const row of projected) {
        if (row.sample.time <= lead.sample.time) continue;
        if (row.sample.speed >= 12 && row.along > previousAlong + 0.5) {
          breakStart = row.sample.time;
          breaks.push({ from: base.id, to: base.next, start: round3(breakStart) });
          break;
        }
        previousAlong = row.along;
      }
      if (breakStart === null) continue;
      let peakAlong = 0;
      for (const row of projected) {
        if (row.sample.time < breakStart) continue;
        if (distance(row.sample.foot, base.nextAt) <= 6) {
          arrivals.push({ base: base.next, time: round3(row.sample.time), kind: 'advance' });
          break;
        }
        peakAlong = Math.max(peakAlong, row.along);
        if (peakAlong > 15 && distance(row.sample.foot, base.at) <= 5) {
          arrivals.push({ base: base.id, time: round3(row.sample.time), kind: 'return' });
          break;
        }
      }
    }
  }
  return { leads, breaks, arrivals };
}

function measureFirstSteps(tracks: Track[], swings: SeriesPoint[]): FieldPoseData['firstSteps'] {
  const steps: FieldPoseData['firstSteps'] = [];
  for (const swing of swings) {
    for (const track of tracks) {
      const role = modeRole(track.samples);
      if (!role || !FIELDERS.has(role)) continue;
      const step = track.samples.find(
        (sample) =>
          sample.time > swing.time && sample.time <= swing.time + 2.5 && sample.speed >= 10,
      );
      if (!step) continue;
      steps.push({
        role,
        time: round3(step.time),
        secondsAfterSwing: round3(step.time - swing.time),
      });
    }
  }
  return steps;
}

function measureDeliveries(
  tracks: Track[],
  scale: (image: Point) => number,
  projectPoint: (image: Point) => Point,
) {
  const deliveries: FieldPoseData['deliveries'] = [];
  let throwingHand: 'L' | 'R' | null = null;
  let bestPeak = 0;
  for (const track of tracks) {
    if (modeRole(track.samples) !== 'P') continue;
    const hands = wristPeaks(track, scale);
    if (hands.peak < 20 || !hands.side) continue;
    if (hands.peak > bestPeak) {
      bestPeak = hands.peak;
      throwingHand = hands.side === 'r' ? 'R' : 'L';
    }
    for (const peak of hands.peaks) {
      const plant = [...track.samples]
        .reverse()
        .find(
          (sample) =>
            sample.time < peak.time &&
            peak.time - sample.time <= 0.6 &&
            sample.speed < 6 &&
            (strideFeet(sample, projectPoint) ?? 0) >= 3,
        );
      const release = track.samples.find((sample) => sample.time === peak.time);
      if (!plant || !release) continue;
      const stride = strideFeet(plant, projectPoint);
      if (stride === null) continue;
      const elbow = keypoint(
        { keypoints: release.keypoints },
        hands.side === 'r' ? BODY.rElbow : BODY.lElbow,
      );
      const wrist = keypoint(
        { keypoints: release.keypoints },
        hands.side === 'r' ? BODY.rWrist : BODY.lWrist,
      );
      deliveries.push({
        time: round3(peak.time),
        strideFeet: round3(stride),
        armSlotDegrees: elbow && wrist ? round3(armSlotAngle(elbow, wrist)) : null,
        releaseHeightFeet:
          wrist === null
            ? null
            : roundOrNull(wristHeightFeet({ keypoints: release.keypoints }, wrist)),
        tempoSeconds: round3(peak.time - plant.time),
      });
    }
  }
  const strides = deliveries.map((delivery) => delivery.strideFeet);
  const slots = deliveries
    .map((delivery) => delivery.armSlotDegrees)
    .filter((slot): slot is number => slot !== null);
  const spread =
    strides.length >= 2
      ? { strideFeet: round3(stdev(strides) ?? 0), armSlotDegrees: roundOrNull(stdev(slots)) }
      : null;
  return { deliveries, spread, throwingHand };
}

function measureCatcher(tracks: Track[], scale: (image: Point) => number) {
  const exchanges: FieldPoseData['exchanges'] = [];
  const popTimes: FieldPoseData['popTimes'] = [];
  for (const track of tracks) {
    if (modeRole(track.samples) !== 'C') continue;
    const right = wristSeries(track, 'r', scale);
    const left = wristSeries(track, 'l', scale);
    const throwSide: Side = maxValue(right) >= maxValue(left) ? 'r' : 'l';
    const throwing = throwSide === 'r' ? right : left;
    const glove = throwSide === 'r' ? left : right;
    if (maxValue(throwing) < 20) continue;
    const throwPeaks = peaks(throwing, 20, 0.8);
    for (const valley of valleys(glove, 8, 0.3)) {
      const peak = throwPeaks.find(
        (point) => point.time - valley.time >= 0.05 && point.time - valley.time <= 0.55,
      );
      if (!peak) continue;
      exchanges.push({
        seconds: round3(peak.time - valley.time),
        time: round3(peak.time),
      });
    }
    for (const peak of throwPeaks) {
      const pop = infielderCatch(tracks, scale, peak.time);
      if (pop) popTimes.push(pop);
    }
  }
  return { exchanges, popTimes };
}

function infielderCatch(
  tracks: Track[],
  scale: (image: Point) => number,
  throwTime: number,
): FieldPoseData['popTimes'][number] | null {
  for (const track of tracks) {
    const role = modeRole(track.samples);
    if (role !== 'SS' && role !== '2B') continue;
    const series = fasterWristSeries(track, scale);
    let armed = false;
    for (const point of series) {
      if (point.time <= throwTime || point.time > throwTime + 2.6) continue;
      if (point.value >= 15) armed = true;
      if (armed && point.value <= 8 && point.time - throwTime >= 0.4) {
        return { seconds: round3(point.time - throwTime), time: round3(point.time) };
      }
    }
  }
  return null;
}

function batterWristPeaks(tracks: Track[], scale: (image: Point) => number) {
  const byTime = new Map<number, number>();
  for (const track of tracks) {
    if (!track.samples.some((sample) => distance(sample.foot, DIAMOND.home) <= 8)) continue;
    for (const point of fasterWristSeries(track, scale)) {
      const previous = byTime.get(point.time);
      if (previous === undefined || point.value > previous) byTime.set(point.time, point.value);
    }
  }
  const series = [...byTime.entries()]
    .map(([time, value]) => ({ time, value }))
    .sort((a, b) => a.time - b.time);
  return peaks(series, 25, 0.8);
}

function batSide(tracks: Track[], swings: SeriesPoint[], homography: Homography): 'L' | 'R' | null {
  const swing = swings[0];
  if (!swing) return null;
  const xs: number[] = [];
  for (const track of tracks) {
    for (const sample of track.samples) {
      if (sample.time < swing.time - 0.3 || sample.time > swing.time - 0.02) continue;
      if (distance(sample.foot, DIAMOND.home) > 8) continue;
      const left = keypoint({ keypoints: sample.keypoints }, BODY.lWrist);
      const right = keypoint({ keypoints: sample.keypoints }, BODY.rWrist);
      if (!left || !right) continue;
      const mid = project(homography, {
        x: (left.x + right.x) / 2,
        y: (left.y + right.y) / 2,
      });
      xs.push(mid.x);
    }
  }
  if (!xs.length) return null;
  const x = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  if (x < -0.4) return 'R';
  if (x > 0.4) return 'L';
  return null;
}

function torsoRatio(tracks: Track[], calibration: DiamondCalibration): number | null {
  const basepath = distance(calibration.image.home, calibration.image.first);
  if (basepath < 1) return null;
  const preferred =
    tracks.find((track) => modeRole(track.samples) === 'B') ??
    tracks.find((track) => modeRole(track.samples) === 'P') ??
    tracks[0];
  if (!preferred) return null;
  let torso = 0;
  for (const sample of preferred.samples) {
    const pixels = torsoPixels({ keypoints: sample.keypoints });
    if (pixels !== null && pixels > torso) torso = pixels;
  }
  if (torso <= 0) return null;
  return round3(torso / basepath);
}

function wristPeaks(track: Track, scale: (image: Point) => number) {
  const right = wristSeries(track, 'r', scale);
  const left = wristSeries(track, 'l', scale);
  const side: Side | null =
    maxValue(right) === 0 && maxValue(left) === 0
      ? null
      : maxValue(right) >= maxValue(left)
        ? 'r'
        : 'l';
  const series = side === 'l' ? left : right;
  return { side, peak: maxValue(series), peaks: side ? peaks(series, 20, 0.8) : [] };
}

function fasterWristSeries(track: Track, scale: (image: Point) => number) {
  const byTime = new Map<number, number>();
  for (const side of ['l', 'r'] as const) {
    for (const point of wristSeries(track, side, scale)) {
      const previous = byTime.get(point.time);
      if (previous === undefined || point.value > previous) byTime.set(point.time, point.value);
    }
  }
  return [...byTime.entries()]
    .map(([time, value]) => ({ time, value }))
    .sort((a, b) => a.time - b.time);
}

function wristSeries(track: Track, side: Side, scale: (image: Point) => number): SeriesPoint[] {
  const index = side === 'l' ? BODY.lWrist : BODY.rWrist;
  const series: SeriesPoint[] = [];
  let previous: { time: number; point: Point } | null = null;
  for (const sample of track.samples) {
    const point = keypoint({ keypoints: sample.keypoints }, index);
    if (!point) {
      previous = null;
      continue;
    }
    if (previous && sample.time > previous.time) {
      series.push({
        time: sample.time,
        value: (distance(point, previous.point) * scale(point)) / (sample.time - previous.time),
      });
    }
    previous = { time: sample.time, point };
  }
  return series;
}

function strideFeet(sample: Placed, projectPoint: (image: Point) => Point) {
  const left = keypoint({ keypoints: sample.keypoints }, BODY.lHeel);
  const right = keypoint({ keypoints: sample.keypoints }, BODY.rHeel);
  if (!left || !right) return null;
  return distance(projectPoint(left), projectPoint(right));
}

function modeRole(samples: Placed[]): Role | null {
  const counts = new Map<Role, number>();
  for (const sample of samples) {
    if (!sample.role) continue;
    counts.set(sample.role, (counts.get(sample.role) ?? 0) + 1);
  }
  let best: Role | null = null;
  let count = 0;
  for (const [role, n] of counts) {
    if (n > count) {
      best = role;
      count = n;
    }
  }
  return best;
}

function peaks(series: SeriesPoint[], minimum: number, gap: number) {
  const found: SeriesPoint[] = [];
  for (let index = 1; index < series.length - 1; index++) {
    const point = series[index]!;
    if (point.value < minimum) continue;
    if (point.value < series[index - 1]!.value || point.value <= series[index + 1]!.value) continue;
    if (found.length && point.time - found[found.length - 1]!.time < gap) continue;
    found.push(point);
  }
  return found;
}

function valleys(series: SeriesPoint[], maximum: number, gap: number) {
  const found: SeriesPoint[] = [];
  for (let index = 1; index < series.length - 1; index++) {
    const point = series[index]!;
    if (point.value > maximum) continue;
    if (point.value > series[index - 1]!.value || point.value >= series[index + 1]!.value) continue;
    if (found.length && point.time - found[found.length - 1]!.time < gap) continue;
    found.push(point);
  }
  return found;
}

function maxValue(series: SeriesPoint[]) {
  return series.reduce((best, point) => Math.max(best, point.value), 0);
}

function stdev(values: number[]) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

function roundOrNull(value: number | null) {
  return value === null || !Number.isFinite(value) ? null : round3(value);
}

function buildNotes(data: FieldPoseData) {
  const bits = [`OpenPose field timings over ${data.samples} frames and ${data.tracks} tracks.`];
  if (data.homeToFirst.length) {
    bits.push(
      `Home-to-first ${data.homeToFirst.map((event) => `${event.seconds.toFixed(2)}s`).join(', ')}.`,
    );
  }
  if (data.leads.length) {
    bits.push(
      `Leads ${data.leads.map((lead) => `${lead.feet.toFixed(1)} ft off ${lead.base}`).join(', ')}.`,
    );
  }
  if (data.firstSteps.length) bits.push(`${data.firstSteps.length} fielder first steps.`);
  if (data.deliveries.length) bits.push(`${data.deliveries.length} mound deliveries.`);
  if (data.exchanges.length) {
    bits.push(
      `Catcher exchange ${data.exchanges.map((event) => `${event.seconds.toFixed(2)}s`).join(', ')}.`,
    );
  }
  if (data.popTimes.length) {
    bits.push(
      `Pop time ${data.popTimes.map((event) => `${event.seconds.toFixed(2)}s`).join(', ')}.`,
    );
  }
  bits.push('Wrist speed is not exit velocity. These timings do not change candidate counts.');
  return bits.join(' ');
}
