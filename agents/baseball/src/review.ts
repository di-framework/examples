import type { GameLog } from './game-log.ts';
import type { VideoEvent } from './video-schema.ts';

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '?';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function liveEvents(log: GameLog): VideoEvent[] {
  const seen = new Set<string>();
  const events: VideoEvent[] = [];
  for (const event of log.windows.flatMap((window) => window.events)) {
    if (event.duplicateOf !== null || event.presentation === 'replay') continue;
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    events.push(event);
  }
  return events.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Human-readable recording summary. This is not a season scorebook. */
export function formatRecordingSummary(log: GameLog): string {
  const { coverage } = log;
  const lines: string[] = [
    `# Game recording (${log.status})`,
    `Mode: ${log.mode}`,
    `Source: ${log.source}`,
    `Coverage: ${clock(coverage.start)} → ${clock(coverage.analyzedThrough)} ` +
      `of ${clock(coverage.videoDuration)} requested through ${clock(coverage.requestedEnd)} ` +
      `@ ${coverage.fps} fps`,
  ];
  if (log.priors?.teamName || log.priors?.teamColors || log.priors?.focusPlayers?.length) {
    const focus = (log.priors.focusPlayers ?? [])
      .map((p) => [p.number ? `#${p.number}` : null, p.name].filter(Boolean).join(' '))
      .filter(Boolean)
      .join(', ');
    lines.push(
      `Priors: ${[
        log.priors.teamName,
        log.priors.teamColors ? `colors ${log.priors.teamColors}` : null,
        focus ? `focus ${focus}` : null,
      ]
        .filter(Boolean)
        .join('; ')}`,
    );
  }

  const counts = Object.entries(log.candidateCounts);
  lines.push(
    counts.length
      ? `Candidate counts (high-confidence live, non-duplicate): ${counts
          .map(([kind, n]) => `${kind}=${n}`)
          .join(', ')}`
      : 'Candidate counts: none yet',
  );

  const events = liveEvents(log);
  lines.push('', `## Observed plays (${events.length})`);
  if (!events.length) lines.push('(no non-duplicate live/uncertain events yet)');
  for (const event of events) {
    const who = [event.batter, event.pitcher ? `vs ${event.pitcher}` : null, event.team]
      .filter(Boolean)
      .join(' ');
    const seek = event.evidenceFrames.map(clock).slice(0, 4).join(', ');
    lines.push(
      `- ${clock(event.start)}–${clock(event.end)} ${event.kind} (${event.presentation}, ${event.confidence})` +
        `${who ? ` — ${who}` : ''}`,
    );
    lines.push(`  evidence @ ${seek || clock(event.start)}; ${event.evidence}`);
    if (event.uncertainty) lines.push(`  uncertainty: ${event.uncertainty}`);
  }

  if (log.enhancements.length) {
    lines.push('', `## Enhancements (${log.enhancements.length})`);
    for (const layer of log.enhancements) {
      lines.push(`- ${layer.id} @ ${layer.at} (${layer.model})`);
      if (layer.notes) lines.push(`  ${layer.notes}`);
    }
  }

  if (log.warnings.length) {
    lines.push('', '## Warnings');
    for (const warning of log.warnings) lines.push(`- ${warning}`);
  }

  lines.push(
    '',
    'This log is a spectator recording of observations, not official statistics.',
    'Add models later with enhancers to refine layers on the same file.',
  );
  return lines.join('\n');
}
