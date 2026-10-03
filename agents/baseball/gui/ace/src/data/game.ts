import type {
  Assignee,
  HalfInning,
  PlateAppearance,
  Player,
  PlayResult,
  SeriesKind,
  ThemeId,
} from './types';

type Decoration = {
  result?: PlayResult;
  fielderId?: string;
  firstStep?: number;
  runnerId?: string;
  leadFeet?: number;
  breakSeconds?: number;
  strideFeet?: number;
  armSlotDegrees?: number;
  exchangeSeconds?: number;
  popSeconds?: number;
  outlier?: {
    theme: ThemeId;
    title: string;
    playerId: string;
    badge: string;
  };
};

export const players: Player[] = [
  {
    id: 'brooks',
    name: 'Devon Brooks',
    number: '3',
    team: 'Coastal',
    position: 'CF',
    series: 'lead_feet',
  },
  {
    id: 'reyes',
    name: 'Luis Reyes',
    number: '2',
    team: 'Coastal',
    position: '2B',
    series: 'first_step_seconds',
  },
  {
    id: 'vargas',
    name: 'Elena Vargas',
    number: '18',
    team: 'Coastal',
    position: 'SS',
    series: 'first_step_seconds',
  },
  {
    id: 'shaw',
    name: 'Nia Shaw',
    number: '21',
    team: 'Coastal',
    position: '1B',
    series: 'first_step_seconds',
  },
  {
    id: 'cole',
    name: 'Andre Cole',
    number: '33',
    team: 'Coastal',
    position: 'RF',
    series: 'first_step_seconds',
  },
  {
    id: 'ibrahim',
    name: 'Samir Ibrahim',
    number: '5',
    team: 'Coastal',
    position: '3B',
    series: 'first_step_seconds',
  },
  {
    id: 'dunn',
    name: 'Morgan Dunn',
    number: '44',
    team: 'Coastal',
    position: 'DH',
    series: 'lead_feet',
  },
  {
    id: 'okada',
    name: 'Hana Okada',
    number: '8',
    team: 'Coastal',
    position: 'C',
    series: 'pop_seconds',
  },
  {
    id: 'chen',
    name: 'Maya Chen',
    number: '11',
    team: 'Coastal',
    position: 'P',
    series: 'arm_slot_degrees',
  },
  {
    id: 'nguyen',
    name: 'Casey Nguyen',
    number: '12',
    team: 'State',
    position: 'LF',
    series: 'lead_feet',
  },
  {
    id: 'walsh',
    name: 'Riley Walsh',
    number: '9',
    team: 'State',
    position: '2B',
    series: 'first_step_seconds',
  },
  {
    id: 'hale',
    name: 'Jordan Hale',
    number: '6',
    team: 'State',
    position: 'SS',
    series: 'first_step_seconds',
  },
  {
    id: 'kim',
    name: 'Soo-jin Kim',
    number: '7',
    team: 'State',
    position: 'CF',
    series: 'first_step_seconds',
  },
  {
    id: 'alvarez',
    name: 'Mateo Alvarez',
    number: '15',
    team: 'State',
    position: '1B',
    series: 'first_step_seconds',
  },
  {
    id: 'stone',
    name: 'Avery Stone',
    number: '4',
    team: 'State',
    position: '3B',
    series: 'first_step_seconds',
  },
  {
    id: 'wright',
    name: 'Blake Wright',
    number: '28',
    team: 'State',
    position: 'RF',
    series: 'first_step_seconds',
  },
  {
    id: 'park',
    name: 'Priya Park',
    number: '22',
    team: 'State',
    position: 'C',
    series: 'pop_seconds',
  },
  {
    id: 'ortega',
    name: 'Luis Ortega',
    number: '27',
    team: 'State',
    position: 'P',
    series: 'stride_feet',
  },
];

const coastalOrder = ['brooks', 'reyes', 'vargas', 'shaw', 'cole', 'ibrahim', 'dunn', 'okada'];
const stateOrder = ['nguyen', 'walsh', 'hale', 'kim', 'alvarez', 'stone', 'wright', 'park'];
const stateFielders = ['walsh', 'hale', 'kim'];
const coastalFielders = ['reyes', 'vargas', 'cole'];

const routineResults: PlayResult[] = [
  'strikeout',
  'groundout',
  'flyout',
  'single',
  'walk',
  'groundout',
  'flyout',
  'strikeout',
];

const decorations: Record<string, Decoration> = {
  '1-top-0': { result: 'single' },
  '1-top-1': { runnerId: 'brooks', leadFeet: 8.2, breakSeconds: 0.21, result: 'groundout' },
  '2-top-0': {
    runnerId: 'brooks',
    leadFeet: 8.4,
    breakSeconds: 0.22,
    popSeconds: 1.96,
    exchangeSeconds: 0.66,
    result: 'stolen_base',
  },
  '2-top-1': {
    firstStep: 0.71,
    result: 'groundout',
    outlier: { theme: 'first_steps', title: 'Late first step', playerId: 'hale', badge: '0.71s' },
  },
  '2-top-2': { runnerId: 'brooks', leadFeet: 8.1, breakSeconds: 0.2, result: 'flyout' },
  '3-top-0': {
    runnerId: 'brooks',
    leadFeet: 9.0,
    breakSeconds: 0.23,
    popSeconds: 2.28,
    exchangeSeconds: 0.86,
    result: 'stolen_base',
    outlier: { theme: 'battery', title: 'Slow pop', playerId: 'park', badge: '2.28s' },
  },
  '3-top-2': {
    runnerId: 'brooks',
    leadFeet: 14.2,
    breakSeconds: 0.19,
    result: 'flyout',
    outlier: { theme: 'baserunning', title: 'Long lead', playerId: 'brooks', badge: '14.2 ft' },
  },
  '4-top-0': {
    fielderId: 'hale',
    firstStep: 0.64,
    result: 'groundout',
    outlier: { theme: 'first_steps', title: 'Late first step', playerId: 'hale', badge: '0.64s' },
  },
  '4-bottom-0': {
    armSlotDegrees: 62,
    result: 'strikeout',
    outlier: { theme: 'mound', title: 'Arm slot open', playerId: 'chen', badge: '62°' },
  },
  '4-bottom-2': {
    runnerId: 'nguyen',
    leadFeet: 12.8,
    breakSeconds: 0.31,
    result: 'caught_stealing',
    outlier: { theme: 'baserunning', title: 'Long lead', playerId: 'nguyen', badge: '12.8 ft' },
  },
  '5-top-0': {
    strideFeet: 6.8,
    result: 'flyout',
    outlier: { theme: 'mound', title: 'Long stride', playerId: 'ortega', badge: '6.8 ft' },
  },
  '5-top-1': {
    runnerId: 'brooks',
    leadFeet: 13.4,
    breakSeconds: 0.24,
    result: 'flyout',
    outlier: { theme: 'baserunning', title: 'Long lead', playerId: 'brooks', badge: '13.4 ft' },
  },
  '5-top-2': { runnerId: 'brooks', leadFeet: 8.7, breakSeconds: 0.2, result: 'single' },
  '5-bottom-2': { runnerId: 'nguyen', leadFeet: 7.5, breakSeconds: 0.18, result: 'groundout' },
  '6-top-0': {
    runnerId: 'brooks',
    leadFeet: 8.4,
    breakSeconds: 0.21,
    popSeconds: 2.34,
    exchangeSeconds: 0.9,
    result: 'caught_stealing',
    outlier: { theme: 'battery', title: 'Slow pop', playerId: 'park', badge: '2.34s' },
  },
  '6-top-2': {
    fielderId: 'hale',
    firstStep: 0.68,
    result: 'groundout',
    outlier: { theme: 'first_steps', title: 'Late first step', playerId: 'hale', badge: '0.68s' },
  },
  '6-bottom-1': {
    armSlotDegrees: 67,
    result: 'walk',
    outlier: { theme: 'mound', title: 'Arm slot open', playerId: 'chen', badge: '67°' },
  },
  '7-top-1': { runnerId: 'brooks', leadFeet: 7.9, breakSeconds: 0.22, result: 'walk' },
  '7-top-2': {
    runnerId: 'brooks',
    leadFeet: 8.0,
    breakSeconds: 0.2,
    popSeconds: 2.01,
    exchangeSeconds: 0.7,
    result: 'stolen_base',
  },
  '7-bottom-0': { runnerId: 'nguyen', leadFeet: 8.2, breakSeconds: 0.24, result: 'single' },
  '2-bottom-1': { runnerId: 'nguyen', leadFeet: 8.0, breakSeconds: 0.21, result: 'flyout' },
};

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function playerById(id: string): Player {
  const player = players.find((item) => item.id === id);
  if (!player) throw new Error(`Unknown player ${id}`);
  return player;
}

function buildPlays(): PlateAppearance[] {
  const plays: PlateAppearance[] = [];
  let video = 0;
  let coastalSpot = 0;
  let stateSpot = 0;

  for (let inning = 1; inning <= 7; inning += 1) {
    for (const half of ['top', 'bottom'] as const) {
      const order = half === 'top' ? coastalOrder : stateOrder;
      const fielderOrder = half === 'top' ? stateFielders : coastalFielders;
      const pitcher = playerById(half === 'top' ? 'ortega' : 'chen');
      const catcher = playerById(half === 'top' ? 'park' : 'okada');

      for (let slot = 0; slot < 3; slot += 1) {
        const spot = half === 'top' ? coastalSpot : stateSpot;
        if (half === 'top') coastalSpot += 1;
        else stateSpot += 1;
        const batter = playerById(order[spot % order.length] ?? order[0]);
        const id = `${inning}-${half}-${slot}`;
        const deco = decorations[id];
        const result = deco?.result ?? routineResults[(inning + slot) % routineResults.length];
        const fielder = playerById(deco?.fielderId ?? fielderOrder[slot] ?? 'hale');
        const videoStart = video;
        video += 46 + ((inning + slot) % 4) * 6;

        let runner: PlateAppearance['pose']['runner'] = null;
        if (deco?.runnerId) {
          const person = playerById(deco.runnerId);
          runner = {
            playerId: person.id,
            name: person.name,
            number: person.number,
            leadFeet: deco.leadFeet ?? null,
            breakSeconds: deco.breakSeconds ?? null,
            homeToFirstSeconds: null,
          };
        } else if (result === 'groundout' || result === 'single' || result === 'double') {
          runner = {
            playerId: batter.id,
            name: batter.name,
            number: batter.number,
            leadFeet: null,
            breakSeconds: null,
            homeToFirstSeconds: roundTo(4.18 + ((inning + slot) % 5) * 0.07, 2),
          };
        }

        plays.push({
          id,
          inning,
          half,
          outs: slot === 0 ? 0 : slot === 1 ? 1 : 2,
          videoStart,
          result,
          batterId: batter.id,
          pose: {
            runner,
            fielder: {
              playerId: fielder.id,
              name: fielder.name,
              number: fielder.number,
              position: fielder.position,
              firstStepSeconds: roundTo(deco?.firstStep ?? 0.32 + ((inning + slot) % 7) * 0.015, 2),
            },
            battery: {
              pitcherId: pitcher.id,
              pitcherName: pitcher.name,
              pitcherNumber: pitcher.number,
              catcherId: catcher.id,
              catcherName: catcher.name,
              catcherNumber: catcher.number,
              strideFeet: roundTo(deco?.strideFeet ?? 5.02 + ((inning + slot) % 5) * 0.08, 2),
              armSlotDegrees: deco?.armSlotDegrees ?? 40 + ((inning + slot) % 6),
              exchangeSeconds: deco?.exchangeSeconds ?? null,
              popSeconds: deco?.popSeconds ?? null,
            },
          },
          outlier: deco?.outlier ?? null,
        });
      }
    }
  }

  return plays;
}

export const plays: PlateAppearance[] = buildPlays();

export const gameTitle = 'Coastal at State';

const themeTitles: Record<ThemeId, string> = {
  first_steps: 'First steps',
  baserunning: 'Baserunning',
  mound: 'Mound',
  battery: 'Battery',
};

export const themeOrder: ThemeId[] = ['first_steps', 'baserunning', 'mound', 'battery'];

export function themeTitle(theme: ThemeId): string {
  return themeTitles[theme];
}

const resultLabels: Record<PlayResult, { abbrev: string; detail: string }> = {
  strikeout: { abbrev: 'K', detail: 'Strikeout swinging' },
  groundout: { abbrev: 'GO', detail: 'Groundout' },
  flyout: { abbrev: 'FO', detail: 'Flyout' },
  single: { abbrev: '1B', detail: 'Single' },
  double: { abbrev: '2B', detail: 'Double' },
  walk: { abbrev: 'BB', detail: 'Walk' },
  stolen_base: { abbrev: 'SB', detail: 'Stolen base' },
  caught_stealing: { abbrev: 'CS', detail: 'Caught stealing' },
};

export function resultAbbrev(result: PlayResult): string {
  return resultLabels[result].abbrev;
}

export function resultDetail(result: PlayResult): string {
  return resultLabels[result].detail;
}

export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  return `${minutes}:${remain.toString().padStart(2, '0')}`;
}

export function inningLabel(inning: number, half: HalfInning): string {
  return `${half === 'top' ? 'Top' : 'Bot'} ${inning}`;
}

export function outsLabel(outs: number): string {
  if (outs === 0) return 'no outs';
  if (outs === 1) return '1 out';
  return `${outs} outs`;
}

export function playById(id: string): PlateAppearance {
  const play = plays.find((item) => item.id === id);
  if (!play) throw new Error(`Unknown play ${id}`);
  return play;
}

export function assignablePlayers(play: PlateAppearance): Assignee[] {
  const rows: Assignee[] = [];
  const push = (id: string, duty: string) => {
    if (rows.some((row) => row.id === id)) return;
    const player = playerById(id);
    rows.push({ id, name: player.name, number: player.number, duty });
  };
  push(play.batterId, 'Batter');
  push(play.pose.battery.pitcherId, 'Pitcher');
  push(play.pose.fielder.playerId, 'Fielder');
  if (play.pose.runner) push(play.pose.runner.playerId, 'Runner');
  push(play.pose.battery.catcherId, 'Catcher');
  const outlierId = play.outlier?.playerId;
  if (!outlierId) return rows;
  return [
    ...rows.filter((row) => row.id === outlierId),
    ...rows.filter((row) => row.id !== outlierId),
  ];
}

const seriesMeta: Record<SeriesKind, { title: string; unit: string; digits: number }> = {
  stride_feet: { title: 'Stride length', unit: 'ft', digits: 1 },
  arm_slot_degrees: { title: 'Arm slot', unit: '°', digits: 0 },
  first_step_seconds: { title: 'First step', unit: 's', digits: 2 },
  lead_feet: { title: 'Lead', unit: 'ft', digits: 1 },
  pop_seconds: { title: 'Pop time', unit: 's', digits: 2 },
};

export function seriesMetaFor(series: SeriesKind): { title: string; unit: string; digits: number } {
  return seriesMeta[series];
}

export function formatSeriesValue(series: SeriesKind, value: number): string {
  const meta = seriesMeta[series];
  const shown = value.toFixed(meta.digits);
  if (meta.unit === '°') return `${shown}°`;
  if (meta.unit === 's') return `${shown}s`;
  return `${shown} ${meta.unit}`;
}

export function metricValue(play: PlateAppearance, player: Player): number | null {
  switch (player.series) {
    case 'stride_feet':
      return play.pose.battery.pitcherId === player.id ? play.pose.battery.strideFeet : null;
    case 'arm_slot_degrees':
      return play.pose.battery.pitcherId === player.id ? play.pose.battery.armSlotDegrees : null;
    case 'first_step_seconds':
      return play.pose.fielder.playerId === player.id ? play.pose.fielder.firstStepSeconds : null;
    case 'lead_feet':
      return play.pose.runner?.playerId === player.id ? (play.pose.runner.leadFeet ?? null) : null;
    case 'pop_seconds':
      return play.pose.battery.catcherId === player.id ? play.pose.battery.popSeconds : null;
    default: {
      const _exhaustive: never = player.series;
      return _exhaustive;
    }
  }
}

export function formatOptionalSeconds(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}s`;
}

export function formatOptionalFeet(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)} ft`;
}

function assertGame(sample: PlateAppearance[]) {
  const ids = new Set(sample.map((play) => play.id));
  if (ids.size !== sample.length) throw new Error('Duplicate plate appearance ids');
  if (sample.length !== 42) throw new Error(`Expected 42 plate appearances, got ${sample.length}`);
  const outliers = sample.filter((play) => play.outlier);
  if (outliers.length !== 11) throw new Error(`Expected 11 outlier marks, got ${outliers.length}`);
  for (const play of outliers) {
    playerById(play.outlier?.playerId ?? '');
  }
  const themes = new Set(outliers.map((play) => play.outlier?.theme));
  for (const theme of themeOrder) {
    if (!themes.has(theme)) throw new Error(`Missing theme ${theme}`);
  }
}

assertGame(plays);
