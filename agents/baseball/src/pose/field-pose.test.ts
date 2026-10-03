import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyEnhancers } from '../enhance.ts';
import { draftToGameLog, parseGameLog } from '../game-log.ts';
import type { VideoDraft } from '../video-schema.ts';
import { BODY, type PosePerson, type PoseSample, parseOpenPoseDocument } from './body.ts';
import {
  DIAMOND,
  distance,
  type Point,
  project,
  ROLE_ANCHORS,
  solveHomography,
} from './geometry.ts';
import { type DiamondCalibration, fieldPoseLayer, measureFieldPose } from './measure.ts';
import { loadPoseDirectory, parseCalibration, runOpenPose } from './openpose.ts';

const toImage = (point: Point): Point => ({ x: 500 + point.x * 2, y: 800 - point.y * 2 });

const calibration: DiamondCalibration = {
  image: {
    home: toImage(DIAMOND.home),
    first: toImage(DIAMOND.first),
    second: toImage(DIAMOND.second),
    third: toImage(DIAMOND.third),
  },
};

function person(points: Partial<Record<number, Point>>): PosePerson {
  const keypoints = Array.from({ length: 25 }, () => ({ x: 0, y: 0, c: 0 }));
  for (const [index, point] of Object.entries(points)) {
    keypoints[Number(index)] = { x: point!.x, y: point!.y, c: 0.9 };
  }
  return { keypoints };
}

function heels(foot: Point) {
  const image = toImage(foot);
  return { [BODY.lHeel]: image, [BODY.rHeel]: image };
}

function anchor(role: string) {
  const slot = ROLE_ANCHORS.find((entry) => entry.role === role);
  if (!slot) throw new Error(`missing ${role}`);
  return slot.at;
}

function along(from: Point, to: Point, feet: number): Point {
  const len = distance(from, to);
  return {
    x: from.x + ((to.x - from.x) / len) * feet,
    y: from.y + ((to.y - from.y) / len) * feet,
  };
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function draft(): VideoDraft {
  return {
    source: 'Video demo.mp4',
    reviewRequired: true,
    status: 'complete',
    coverage: {
      start: 0,
      requestedEnd: 5,
      analyzedThrough: 5,
      videoDuration: 5,
      fps: 1,
    },
    windows: [],
    candidateCounts: { single: 1 },
    warnings: [],
  };
}

test('homography maps the bases and the rubber', () => {
  const homography = solveHomography(
    [
      calibration.image.home,
      calibration.image.first,
      calibration.image.second,
      calibration.image.third,
    ],
    [DIAMOND.home, DIAMOND.first, DIAMOND.second, DIAMOND.third],
  );
  expect(distance(project(homography, toImage(DIAMOND.rubber)), DIAMOND.rubber)).toBeLessThan(0.05);
  expect(distance(project(homography, toImage(DIAMOND.first)), DIAMOND.first)).toBeLessThan(0.05);
});

test('parseOpenPoseDocument keeps BODY_25 people and drops short arrays', () => {
  const flat = new Array(75).fill(0);
  flat[21 * 3] = 10;
  flat[21 * 3 + 1] = 20;
  flat[21 * 3 + 2] = 0.9;
  const people = parseOpenPoseDocument({
    people: [{ pose_keypoints_2d: [1, 2] }, { pose_keypoints_2d: flat, pose_keypoints_3d: [] }],
  });
  expect(people).toHaveLength(1);
  expect(people[0]?.keypoints[BODY.lHeel]).toEqual({ x: 10, y: 20, c: 0.9 });
  expect(() => parseOpenPoseDocument({ version: 1 })).toThrow('people');
});

test('home-to-first is the first step through the foot reaching the bag', () => {
  const samples: PoseSample[] = [];
  for (let step = 0; step <= 45; step++) {
    const time = step / 10;
    const foot = lerp(DIAMOND.home, DIAMOND.first, time / 4.5);
    samples.push({ time, people: [person(heels(foot))] });
  }
  const report = measureFieldPose(samples, calibration);
  expect(report.data.homeToFirst).toEqual([{ seconds: 4.3, start: 0, end: 4.3 }]);
  expect(report.notes).toContain('do not change candidate counts');
});

test('a held lead, a break, and an arrival are timed off the basepath', () => {
  const samples: PoseSample[] = [];
  for (let step = 0; step <= 4; step++) {
    samples.push({
      time: step / 10,
      people: [person(heels(along(DIAMOND.first, DIAMOND.second, 10)))],
    });
  }
  for (let step = 1; step <= 40; step++) {
    samples.push({
      time: 0.4 + step / 10,
      people: [person(heels(along(DIAMOND.first, DIAMOND.second, 10 + step * 2)))],
    });
  }
  const report = measureFieldPose(samples, calibration);
  expect(report.data.leads[0]).toMatchObject({ base: 'first', feet: 10 });
  expect(report.data.breaks[0]).toMatchObject({ from: 'first', to: 'second', start: 0.5 });
  expect(report.data.arrivals[0]).toMatchObject({ base: 'second', kind: 'advance' });
  expect(report.data.arrivals[0]?.time).toBeGreaterThan(0.5);
});

test('a runner who breaks and comes back is a return', () => {
  const at = (feet: number) => along(DIAMOND.first, DIAMOND.second, feet);
  const samples: PoseSample[] = [
    { time: 0, people: [person(heels(at(10)))] },
    { time: 0.1, people: [person(heels(at(10)))] },
    { time: 0.3, people: [person(heels(at(16)))] },
    { time: 0.5, people: [person(heels(at(10)))] },
    { time: 0.7, people: [person(heels(at(4)))] },
  ];
  const report = measureFieldPose(samples, calibration);
  expect(report.data.breaks[0]?.start).toBe(0.3);
  expect(report.data.arrivals).toEqual([{ base: 'first', time: 0.7, kind: 'return' }]);
});

test('fielder first step is timed from the batter wrist peak', () => {
  const box = toImage({ x: 0, y: 1 });
  const hands = toImage({ x: -2, y: 1 });
  const ss = anchor('SS');
  const samples: PoseSample[] = [];
  for (let step = 0; step <= 7; step++) {
    const time = step / 10;
    const moved = time >= 0.2 ? (time >= 0.3 ? 9 : 8) : 0;
    const ssFoot = time >= 0.6 ? { x: ss.x + 3, y: ss.y } : ss;
    samples.push({
      time,
      people: [
        person({
          ...heels({ x: 0, y: 1 }),
          [BODY.neck]: { x: box.x, y: box.y - 80 },
          [BODY.midHip]: { x: box.x, y: box.y - 44 },
          [BODY.lWrist]: hands,
          [BODY.rWrist]: { x: hands.x + moved, y: hands.y },
        }),
        person(heels(ssFoot)),
      ],
    });
  }
  const report = measureFieldPose(samples, calibration);
  expect(report.data.handSpeedFeetPerSecond).toBeCloseTo(40, 0);
  expect(report.data.handedness.bat).toBe('R');
  expect(report.data.torsoVsBasepath).toBeCloseTo(0.2, 2);
  expect(report.data.firstSteps).toEqual([{ role: 'SS', secondsAfterSwing: 0.4, time: 0.6 }]);
});

test('repeated deliveries record stride, arm slot, release height, and throwing hand', () => {
  const back = toImage({ x: 0, y: 55.5 });
  const front = toImage({ x: 0, y: 65.5 });
  const elbow = { x: 530, y: 640 };
  const rest = { x: 530, y: 640 };
  const gone = { x: 560, y: 610 };
  const samples: PoseSample[] = [];
  for (const cycle of [1, 3, 5]) {
    for (const [offset, wrist] of [
      [-0.15, rest],
      [0, rest],
      [0.15, gone],
      [0.3, gone],
    ] as const) {
      samples.push({
        time: Math.round((cycle + offset) * 1000) / 1000,
        people: [
          person({
            [BODY.lHeel]: back,
            [BODY.rHeel]: front,
            [BODY.lAnkle]: { x: 500, y: 679 },
            [BODY.rAnkle]: { x: 500, y: 679 },
            [BODY.neck]: { x: 500, y: 603 },
            [BODY.midHip]: { x: 500, y: 639 },
            [BODY.rElbow]: elbow,
            [BODY.rWrist]: wrist,
            [BODY.lWrist]: rest,
          }),
        ],
      });
    }
  }
  const report = measureFieldPose(samples, calibration);
  expect(report.data.deliveries).toHaveLength(3);
  expect(report.data.deliveries[0]).toMatchObject({
    strideFeet: 10,
    armSlotDegrees: 45,
    releaseHeightFeet: 3.45,
    tempoSeconds: 0.15,
  });
  expect(report.data.deliverySpread).toEqual({ strideFeet: 0, armSlotDegrees: 0 });
  expect(report.data.handedness.throw).toBe('R');
});

test('catcher exchange and pop time use wrist speed peaks', () => {
  const catcher = toImage(anchor('C'));
  const ss = toImage(anchor('SS'));
  const glove = {
    1.55: { x: 500, y: 812 },
    1.7: { x: 470, y: 812 },
    1.85: { x: 470, y: 812 },
    2: { x: 500, y: 812 },
  };
  const times = [1.55, 1.7, 1.85, 2, 2.05, 2.2, 3.5, 3.95];
  const samples: PoseSample[] = times.map((time) => {
    const gloveAt =
      time < 1.7 ? glove[1.55] : time < 1.85 ? glove[1.7] : time < 2 ? glove[1.85] : glove[2];
    const thrown = time >= 2.05;
    const ssWrist = time >= 3.5 ? { x: ss.x + 80, y: ss.y } : { x: ss.x, y: ss.y };
    return {
      time,
      people: [
        person({
          [BODY.lHeel]: catcher,
          [BODY.rHeel]: catcher,
          [BODY.lWrist]: gloveAt!,
          [BODY.rWrist]: thrown ? { x: 570, y: 780 } : { x: 520, y: 812 },
        }),
        person({
          [BODY.lHeel]: ss,
          [BODY.rHeel]: ss,
          [BODY.lWrist]: ssWrist,
          [BODY.rWrist]: ssWrist,
        }),
      ],
    };
  });
  const report = measureFieldPose(samples, calibration);
  expect(report.data.exchanges).toEqual([{ seconds: 0.2, time: 2.05 }]);
  expect(report.data.popTimes).toEqual([{ seconds: 1.9, time: 3.95 }]);
});

test('field-pose appends a layer and leaves candidate counts alone', async () => {
  const samples: PoseSample[] = [
    { time: 0, people: [person(heels(DIAMOND.home))] },
    { time: 2, people: [person(heels(lerp(DIAMOND.home, DIAMOND.first, 0.5)))] },
    { time: 4.3, people: [person(heels(DIAMOND.first))] },
  ];
  const log = draftToGameLog(draft(), { mode: 'sideline' });
  const enhanced = await fieldPoseLayer(samples, calibration).enhance(log);
  expect(enhanced.windows).toEqual(log.windows);
  expect(enhanced.candidateCounts).toEqual({ single: 1 });
  expect(enhanced.enhancements[0]?.id).toBe('field-pose');
  expect(enhanced.enhancements[0]?.model).toBe('openpose-body25');
  const parsed = parseGameLog(JSON.parse(JSON.stringify(enhanced)));
  expect(parsed.enhancements[0]?.data).toHaveProperty('homeToFirst');
  await expect(applyEnhancers(enhanced, [fieldPoseLayer(samples, calibration)])).rejects.toThrow(
    'already present',
  );
});

test('loadPoseDirectory reads a times manifest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pose-json-'));
  try {
    const flat = new Array(75).fill(0);
    await writeFile(
      join(directory, 'frame_keypoints.json'),
      JSON.stringify({ people: [{ pose_keypoints_2d: flat }] }),
    );
    await writeFile(
      join(directory, 'times.json'),
      JSON.stringify([{ file: 'frame_keypoints.json', time: 1.25 }]),
    );
    const samples = await loadPoseDirectory(directory);
    expect(samples).toEqual([{ time: 1.25, people: [{ keypoints: expect.any(Array) }] }]);
    expect(parseCalibration(calibration)).toEqual(calibration);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('runOpenPose reports a missing binary', async () => {
  const imageDirectory = await mkdtemp(join(tmpdir(), 'pose-images-'));
  try {
    await expect(
      runOpenPose({
        bin: join(imageDirectory, 'missing-openpose'),
        imageDirectory,
        outputDirectory: join(imageDirectory, 'out'),
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow(/OpenPose/);
  } finally {
    await rm(imageDirectory, { recursive: true, force: true });
  }
});

test('degenerate calibration is rejected', () => {
  const collapsed = { x: 0, y: 0 };
  expect(() =>
    measureFieldPose([{ time: 0, people: [] }], {
      image: { home: collapsed, first: collapsed, second: collapsed, third: collapsed },
    }),
  ).toThrow(/[Dd]egenerate|could not be solved/);
});
