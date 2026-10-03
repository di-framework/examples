/** Field plane in feet. Origin is the back tip of home plate, +x is the first-base side, +y is toward center field. */

export type Point = { x: number; y: number };

export const BASE_PATH_FEET = 90;

const half = BASE_PATH_FEET / Math.SQRT2;

export const DIAMOND = {
  home: { x: 0, y: 0 },
  first: { x: half, y: half },
  second: { x: 0, y: BASE_PATH_FEET * Math.SQRT2 },
  third: { x: -half, y: half },
  rubber: { x: 0, y: 60.5 },
} as const;

export type Role =
  | 'P'
  | 'C'
  | 'B'
  | '1B'
  | '2B'
  | 'SS'
  | '3B'
  | 'LF'
  | 'CF'
  | 'RF'
  | 'R1'
  | 'R2'
  | 'R3';

/** Where a defender usually stands, and how far a detection may sit from that spot. */
export const ROLE_ANCHORS: readonly { role: Role; at: Point; radius: number }[] = [
  { role: 'C', at: { x: 0, y: -6 }, radius: 12 },
  { role: 'P', at: DIAMOND.rubber, radius: 18 },
  { role: 'B', at: { x: 0, y: 2 }, radius: 8 },
  { role: '1B', at: { x: 45, y: 95 }, radius: 22 },
  { role: '3B', at: { x: -45, y: 95 }, radius: 22 },
  { role: '2B', at: { x: 45, y: 130 }, radius: 30 },
  { role: 'SS', at: { x: -45, y: 130 }, radius: 30 },
  { role: 'LF', at: { x: -100, y: 230 }, radius: 55 },
  { role: 'CF', at: { x: 0, y: 270 }, radius: 55 },
  { role: 'RF', at: { x: 100, y: 230 }, radius: 55 },
];

export const BASES = [
  { id: 'first', at: DIAMOND.first, next: 'second', nextAt: DIAMOND.second },
  { id: 'second', at: DIAMOND.second, next: 'third', nextAt: DIAMOND.third },
  { id: 'third', at: DIAMOND.third, next: 'home', nextAt: DIAMOND.home },
] as const;

export function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Distance along the basepath and perpendicular to it, in feet. */
export function alongBasepath(from: Point, to: Point, foot: Point) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const vx = foot.x - from.x;
  const vy = foot.y - from.y;
  return {
    along: vx * ux + vy * uy,
    off: Math.abs(vx * -uy + vy * ux),
  };
}

export type Homography = readonly number[];

/**
 * Map image pixels onto the diamond from the four base correspondences.
 * Image y increases downward, matching a camera frame. Field y increases toward center field.
 */
export function solveHomography(
  image: readonly [Point, Point, Point, Point],
  field: readonly [Point, Point, Point, Point],
): Homography {
  const matrix: number[][] = [];
  const target: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = image[i]!;
    const { x: X, y: Y } = field[i]!;
    matrix.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    target.push(X);
    matrix.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    target.push(Y);
  }
  const h = solveLinear(matrix, target);
  const homography = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1] as Homography;
  for (let i = 0; i < 4; i++) {
    const got = project(homography, image[i]!);
    if (distance(got, field[i]!) > 0.5) throw new Error('Diamond calibration could not be solved');
  }
  return homography;
}

export function project(h: Homography, point: Point): Point {
  const den = h[6]! * point.x + h[7]! * point.y + h[8]!;
  if (!Number.isFinite(den) || Math.abs(den) < 1e-9)
    throw new Error('Point is outside the calibrated field view');
  return {
    x: (h[0]! * point.x + h[1]! * point.y + h[2]!) / den,
    y: (h[3]! * point.x + h[4]! * point.y + h[5]!) / den,
  };
}

/** Ground-plane feet represented by one image pixel at this location. */
export function feetPerPixel(h: Homography, image: Point) {
  const origin = project(h, image);
  const dx = distance(origin, project(h, { x: image.x + 1, y: image.y }));
  const dy = distance(origin, project(h, { x: image.x, y: image.y + 1 }));
  const scale = (dx + dy) / 2;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Field scale is not usable here');
  return scale;
}

function solveLinear(matrix: number[][], target: number[]) {
  const n = target.length;
  const rows = matrix.map((row, index) => [...row, target[index]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(rows[row]![col]!) > Math.abs(rows[pivot]![col]!)) pivot = row;
    }
    const swap = rows[col]!;
    rows[col] = rows[pivot]!;
    rows[pivot] = swap;
    const diag = rows[col]![col]!;
    if (Math.abs(diag) < 1e-8) throw new Error('Diamond calibration is degenerate');
    for (let col2 = col; col2 <= n; col2++) rows[col]![col2] = rows[col]![col2]! / diag;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = rows[row]![col]!;
      for (let col2 = col; col2 <= n; col2++)
        rows[row]![col2] = rows[row]![col2]! - factor * rows[col]![col2]!;
    }
  }
  return rows.map((row) => row[n]!);
}
