import { BaseballStore } from '../src/store.ts';

// Synthetic data in memory: never writes to a real team's database.
const store = new BaseballStore();
try {
  store.createTeam({
    teamId: 'owls-2026',
    name: 'Owls',
    season: '2026 Fall',
    division: 'Majors',
    inningsPerGame: 6,
  });
  store.savePlayer({
    teamId: 'owls-2026',
    playerId: 'alex-7',
    name: 'Alex',
    number: '7',
    active: true,
    expectedRevision: null,
  });
  store.saveGame({
    teamId: 'owls-2026',
    gameId: '2026-09-12-foxes-1',
    date: '2026-09-12',
    opponent: 'Foxes',
    gameNumber: 1,
    runsFor: 5,
    runsAgainst: 3,
    source: 'Synthetic demo scorebook; one player recorded, partial team coverage',
    expectedRevision: null,
    correctionReason: null,
    lines: [
      {
        playerId: 'alex-7',
        batting: {
          AB: 3,
          H: 2,
          doubles: 1,
          triples: 0,
          HR: 0,
          R: 1,
          RBI: 2,
          BB: 1,
          HBP: 0,
          SO: 1,
          SB: 1,
          CS: 0,
          SF: 0,
          SH: 0,
          CI: 0,
        },
        pitching: { outs: 7, H: 2, R: 1, ER: 1, BB: 1, HBP: 0, SO: 3 },
        pitchCount: 38,
        fielding: { PO: 1, A: 2, E: 0 },
      },
    ],
  });
  console.log(
    JSON.stringify(store.report({ teamId: 'owls-2026', from: null, through: null }), null, 2),
  );
} finally {
  store.close();
}
