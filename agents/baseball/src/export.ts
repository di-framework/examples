import type { BaseballStore } from './store.ts';

// Quote every cell and neutralize spreadsheet formulas in user-supplied names.
const cell = (value: unknown) => {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

export function reportCsv(report: ReturnType<BaseballStore['report']>): string {
  const headers = [
    'playerId',
    'name',
    'number',
    'recordedGames',
    'battingGames',
    'pitchingGames',
    'fieldingGames',
    'pitchCountGames',
    'AB',
    'H',
    'R',
    'RBI',
    'BB',
    'SO',
    'SB',
    'AVG',
    'OBP',
    'SLG',
    'OPS',
    'IP',
    `ERA_${report.eraInnings}`,
    'WHIP',
    'pitchCount',
    'PO',
    'A',
    'E',
    'FPCT',
  ];
  const rows = report.players.map((p) => [
    p.playerId,
    p.name,
    p.number,
    p.recordedGames,
    p.coverage.battingGames,
    p.coverage.pitchingGames,
    p.coverage.fieldingGames,
    p.coverage.pitchCountGames,
    p.batting?.AB,
    p.batting?.H,
    p.batting?.R,
    p.batting?.RBI,
    p.batting?.BB,
    p.batting?.SO,
    p.batting?.SB,
    p.batting?.AVG,
    p.batting?.OBP,
    p.batting?.SLG,
    p.batting?.OPS,
    p.pitching?.IP,
    p.pitching?.ERA,
    p.pitching?.WHIP,
    p.pitchCount,
    p.fielding?.PO,
    p.fielding?.A,
    p.fielding?.E,
    p.fielding?.FPCT,
  ]);
  return [headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
