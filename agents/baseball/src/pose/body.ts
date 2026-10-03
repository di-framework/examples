import { z } from 'zod';
import { distance, type Point } from './geometry.ts';

/** OpenPose BODY_25 indices. Right and left are the person's, not the camera's. */
export const BODY = {
  nose: 0,
  neck: 1,
  rShoulder: 2,
  rElbow: 3,
  rWrist: 4,
  lShoulder: 5,
  lElbow: 6,
  lWrist: 7,
  midHip: 8,
  rHip: 9,
  rKnee: 10,
  rAnkle: 11,
  lHip: 12,
  lKnee: 13,
  lAnkle: 14,
  rEye: 15,
  lEye: 16,
  rEar: 17,
  lEar: 18,
  lBigToe: 19,
  lSmallToe: 20,
  lHeel: 21,
  rBigToe: 22,
  rSmallToe: 23,
  rHeel: 24,
} as const;

export const MIN_KEYPOINT_CONFIDENCE = 0.2;
const KEYPOINT_COUNT = 25;

export type Keypoint = { x: number; y: number; c: number };
export type PosePerson = { keypoints: Keypoint[] };
export type PoseSample = { time: number; people: PosePerson[] };

const openPoseSchema = z.object({
  people: z.array(
    z.object({
      pose_keypoints_2d: z.array(z.number()),
    }),
  ),
});

/** Read one OpenPose `--write_json` document. People with a bad keypoint array are dropped. */
export function parseOpenPoseDocument(value: unknown): PosePerson[] {
  const parsed = openPoseSchema.safeParse(value);
  if (!parsed.success) throw new Error('OpenPose JSON must contain a people array');
  const people: PosePerson[] = [];
  for (const person of parsed.data.people) {
    const flat = person.pose_keypoints_2d;
    if (flat.length !== KEYPOINT_COUNT * 3) continue;
    const keypoints: Keypoint[] = [];
    let valid = true;
    for (let index = 0; index < KEYPOINT_COUNT; index++) {
      const x = flat[index * 3]!;
      const y = flat[index * 3 + 1]!;
      const c = flat[index * 3 + 2]!;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(c)) {
        valid = false;
        break;
      }
      keypoints.push({ x, y, c });
    }
    if (valid) people.push({ keypoints });
  }
  return people;
}

export function keypoint(person: PosePerson, index: number): Point | null {
  const point = person.keypoints[index];
  if (!point || point.c < MIN_KEYPOINT_CONFIDENCE) return null;
  return { x: point.x, y: point.y };
}

/** Heels when OpenPose saw them, otherwise ankles. */
export function footImage(person: PosePerson): Point | null {
  const heels = [keypoint(person, BODY.lHeel), keypoint(person, BODY.rHeel)].filter(
    (point): point is Point => point !== null,
  );
  const used =
    heels.length > 0
      ? heels
      : [keypoint(person, BODY.lAnkle), keypoint(person, BODY.rAnkle)].filter(
          (point): point is Point => point !== null,
        );
  if (!used.length) return null;
  return {
    x: used.reduce((sum, point) => sum + point.x, 0) / used.length,
    y: used.reduce((sum, point) => sum + point.y, 0) / used.length,
  };
}

/** Degrees above the image horizontal. Image y increases downward. */
export function armSlotDegrees(elbow: Point, wrist: Point) {
  return (Math.atan2(elbow.y - wrist.y, wrist.x - elbow.x) * 180) / Math.PI;
}

/**
 * Wrist height above the ankles, scaled so the neck-to-midhip segment is 1.8 ft.
 * This is a body-proportion estimate, not a surveyed release height.
 */
export function releaseHeightFeet(person: PosePerson, wrist: Point): number | null {
  const neck = keypoint(person, BODY.neck);
  const hip = keypoint(person, BODY.midHip);
  if (!neck || !hip) return null;
  const torso = distance(neck, hip);
  if (torso < 1) return null;
  const ankles = [keypoint(person, BODY.lAnkle), keypoint(person, BODY.rAnkle)].filter(
    (point): point is Point => point !== null,
  );
  if (!ankles.length) return null;
  const ankleY = ankles.reduce((sum, point) => sum + point.y, 0) / ankles.length;
  const above = ankleY - wrist.y;
  if (above <= 0) return null;
  return (above * 1.8) / torso;
}

export function torsoPixels(person: PosePerson): number | null {
  const neck = keypoint(person, BODY.neck);
  const hip = keypoint(person, BODY.midHip);
  if (!neck || !hip) return null;
  const torso = distance(neck, hip);
  return torso >= 1 ? torso : null;
}
