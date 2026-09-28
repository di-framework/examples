import { expect, test } from 'bun:test';
import { ChatResponse, FakeChatModel } from '@di-framework/ai';
import { applyEnhancers, enhancer, summaryLayer } from './enhance.ts';
import { appendEnhancement, draftToGameLog, type GameLog, parseGameLog } from './game-log.ts';
import { formatRecordingSummary } from './review.ts';
import type { VideoDraft } from './video-schema.ts';

function sampleDraft(): VideoDraft {
  return {
    source: 'Video demo.mp4; 1 bytes; modified 2026-01-01T00:00:00.000Z',
    reviewRequired: true,
    status: 'complete',
    coverage: {
      start: 0,
      requestedEnd: 30,
      analyzedThrough: 30,
      videoDuration: 30,
      fps: 1,
    },
    windows: [
      {
        start: 0,
        end: 20,
        frames: [0, 1, 2],
        model: 'test',
        scoreboard: null,
        scoreboardFrame: null,
        broadcast: 'unknown',
        warnings: [],
        events: [
          {
            id: 'v0-1',
            reviewRequired: true,
            start: 3,
            end: 8,
            kind: 'single',
            presentation: 'live',
            batter: '#7',
            pitcher: null,
            team: 'Owls',
            inning: null,
            half: null,
            runsScored: null,
            confidence: 'high',
            evidenceFrames: [3, 5],
            evidence: 'Batter reaches first',
            uncertainty: null,
            duplicateOf: null,
          },
        ],
      },
    ],
    candidateCounts: { single: 1 },
    warnings: ['Sampled video without audio can miss plays.'],
  };
}

test('draftToGameLog and parseGameLog round-trip with enhancements', () => {
  const log = draftToGameLog(sampleDraft(), {
    mode: 'sideline',
    priors: {
      teamName: 'Owls',
      teamColors: 'blue',
      focusPlayers: [{ number: '7', name: 'Emma' }],
    },
  });
  expect(log.version).toBe(1);
  expect(log.enhancements).toEqual([]);
  const withLayer = appendEnhancement(log, {
    id: 'summary',
    model: 'test',
    at: '2026-01-01T00:00:00.000Z',
    notes: 'One single observed.',
    data: { highlightEventIds: ['v0-1'] },
  });
  const parsed = parseGameLog(JSON.parse(JSON.stringify(withLayer)));
  expect(parsed.enhancements).toHaveLength(1);
  expect(parsed.priors?.focusPlayers?.[0]?.name).toBe('Emma');
  expect(parsed.candidateCounts.single).toBe(1);
});

test('parseGameLog rejects bad payloads', () => {
  expect(() => parseGameLog(null)).toThrow('object');
  expect(() => parseGameLog({ ...sampleDraft(), version: 99 })).toThrow('version');
  expect(() => parseGameLog({ ...sampleDraft(), reviewRequired: false })).toThrow('reviewRequired');
});

test('formatRecordingSummary is human-readable and not a scorebook claim', () => {
  const text = formatRecordingSummary(draftToGameLog(sampleDraft(), { mode: 'sideline' }));
  expect(text).toContain('Game recording');
  expect(text).toContain('0:03–0:08 single');
  expect(text).toContain('single=1');
  expect(text).toContain('not official statistics');
  expect(text).not.toContain('save_game');
});

test('layers append and refuse duplicates', async () => {
  const model = new FakeChatModel(() =>
    ChatResponse.of(
      JSON.stringify({
        notes: 'Coverage looks sparse after 0:20.',
        data: { uncertainEventIds: [] },
      }),
      { model: 'fake-summary' },
    ),
  );
  const log = draftToGameLog(sampleDraft(), { mode: 'sideline' });
  const enhanced = await applyEnhancers(log, [summaryLayer(model)]);
  expect(enhanced.enhancements).toHaveLength(1);
  expect(enhanced.enhancements[0]?.id).toBe('summary');
  expect(enhanced.enhancements[0]?.notes).toContain('sparse');
  expect(enhanced.windows).toEqual(log.windows);
  await expect(applyEnhancers(enhanced, [summaryLayer(model)])).rejects.toThrow('already present');
});

test('enhancer plugs a custom model layer by id', async () => {
  const model = new FakeChatModel(() =>
    ChatResponse.of(JSON.stringify({ notes: 'ok', data: { x: 1 } })),
  );
  const layer = enhancer({
    id: 'identity',
    model,
    instructions: 'Resolve jersey numbers from priors only.',
  });
  const log = await layer.enhance(draftToGameLog(sampleDraft()) as GameLog);
  expect(log.enhancements[0]?.id).toBe('identity');
  expect(log.enhancements[0]?.data).toEqual({ x: 1 });
});
