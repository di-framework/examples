export type HalfInning = 'top' | 'bottom';

export type ThemeId = 'first_steps' | 'baserunning' | 'mound' | 'battery';

export type PlayResult =
  | 'strikeout'
  | 'groundout'
  | 'flyout'
  | 'single'
  | 'double'
  | 'walk'
  | 'stolen_base'
  | 'caught_stealing';

export type SeriesKind =
  | 'stride_feet'
  | 'arm_slot_degrees'
  | 'first_step_seconds'
  | 'lead_feet'
  | 'pop_seconds';

export type Player = {
  id: string;
  name: string;
  number: string;
  team: 'Coastal' | 'State';
  position: string;
  series: SeriesKind;
};

export type RunnerPose = {
  playerId: string;
  name: string;
  number: string;
  leadFeet: number | null;
  breakSeconds: number | null;
  homeToFirstSeconds: number | null;
};

export type FielderPose = {
  playerId: string;
  name: string;
  number: string;
  position: string;
  firstStepSeconds: number;
};

export type BatteryPose = {
  pitcherId: string;
  pitcherName: string;
  pitcherNumber: string;
  catcherId: string;
  catcherName: string;
  catcherNumber: string;
  strideFeet: number;
  armSlotDegrees: number;
  exchangeSeconds: number | null;
  popSeconds: number | null;
};

export type Outlier = {
  theme: ThemeId;
  title: string;
  playerId: string;
  badge: string;
};

export type PlateAppearance = {
  id: string;
  inning: number;
  half: HalfInning;
  outs: number;
  videoStart: number;
  result: PlayResult;
  batterId: string;
  pose: {
    runner: RunnerPose | null;
    fielder: FielderPose;
    battery: BatteryPose;
  };
  outlier: Outlier | null;
};

export type Assignee = {
  id: string;
  name: string;
  number: string;
  duty: string;
};

export type Mark = {
  playId: string;
  playerId: string;
};
