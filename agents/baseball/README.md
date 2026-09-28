# Baseball spectator

> STATUS: Prototype

An AI baseball spectator with one job: **record what it sees** into a durable game log.

- **Finished files** — `/record` or `--record` over a local mp4
- **Live OBS streams** — RTSP / RTMP / SRT via `LIVE_URL` in `.env`
- **Enhancers** — plug in more models later to refine the same log without rewriting it

Sideline / parent-cam is the default observation mode. The log is observation data, not an
official scorebook. Season SQLite tracking remains available as a legacy `--stats` path.

## Requirements

From the repo root:

```sh
bun install
cd agents/baseball
```

Also:

- [FFmpeg](https://ffmpeg.org/download.html) with `ffmpeg` and `ffprobe` on PATH (`brew install ffmpeg` on macOS)
- Codex CLI sign-in for the default vision path (or inject your own vision `ChatModel`)

Copy env defaults:

```sh
cp .env.example .env
```

## Quick start

### 1. Live from OBS (recommended at the field)

Point OBS (or MediaMTX / nginx-rtmp / any encoder) at a local publish URL, then set:

```env
# agents/baseball/.env  (Bun loads this automatically)
LIVE_URL=rtsp://127.0.0.1:8554/live
```

Start the spectator:

```sh
bun start --live --output live.json
# Ctrl+C stops; the log is finalized and printed.
```

Or in the interactive TUI (`bun start`):

```text
/live
```

`/live` with no args uses `LIVE_URL`. Override per run:

```sh
bun start --live --url rtmp://127.0.0.1/live/obs --output live.json
```

```text
/live rtsp://127.0.0.1:8554/other
/live demo
```

`--demo` / `/live demo` uses a lavfi test pattern (no OBS) for plumbing checks.

Live capture remuxes the stream into short segment files, observes each closed segment into
the game log, and lags by about one segment. Only `rtsp://`, `rtsps://`, `rtmp://`,
`rtmps://`, and `srt://` are accepted — not http(s) VOD pages or MLB.TV.

RTSP uses TCP transport for more reliable sideline Wi‑Fi.

### 2. Record a finished game file

```sh
bun start --record /path/to/game.mp4 --output game.json
```

Full file by default (sideline mode). Checkpoints `game.json` after each window. Human
summary on stdout; progress on stderr.

In chat:

```text
/record /path/to/game.mp4
What did you catch early in the game?
```

Quick two-minute sample: `/video PATH` or `bun start --video PATH`.

### 3. Enhance the same log later

```sh
bun start --enhance game.json --with summary --output game.json
```

New models append an `enhancements[]` layer; they do not replace observer `windows` / `events`.

```ts
import {
  createBaseballSpectator,
  enhancer,
  formatRecordingSummary,
  summaryLayer,
} from "./src/index.ts";

const spectator = createBaseballSpectator({
  chatModel,
  visionModel,
  priors: {
    teamName: "Owls",
    teamColors: "navy/white",
    focusPlayers: [{ number: "7", name: "Emma" }],
  },
  enhancers: [summaryLayer(chatModel)],
});

const log = await spectator.record("/path/to/game.mp4", { enhance: true });
console.log(formatRecordingSummary(log));

await spectator.recordLive({ /* uses LIVE_URL when url omitted */ });

await spectator.enhance([
  enhancer({
    id: "identity",
    model: anotherModel,
    instructions:
      "Resolve jersey numbers to names from priors only; never invent players.",
  }),
]);
```

## Commands and flags

| Command / flag | What it does |
| --- | --- |
| `bun start` | Interactive spectator TUI |
| `bun start --live` | Live pull from `LIVE_URL` until Ctrl+C |
| `bun start --live --url …` | Override stream URL |
| `bun start --live --demo` | Synthetic pattern (no OBS) |
| `bun start --record FILE` | Observe a finished local video (full file) |
| `bun start --video FILE` | Short sample (default 120s) |
| `bun start --enhance LOG` | Append a model layer (`--with summary`) |
| `/live` | Same as `--live` using `LIVE_URL` |
| `/record PATH` | Same as `--record` |
| `/video PATH` | Two-minute sample |
| `--output path.json` | Checkpoint the game log while running |
| `--segment N` | Live segment length in seconds (1–20, default 5) |
| `--max-seconds N` | Stop live capture after N seconds of timeline |
| `--fps 0.5..2` | Frame sample rate (default 1) |
| `--mode sideline\|broadcast` | Observation bias (default sideline) |
| `bun start --stats` | Legacy season-tracker chat |

## How observation works

**Files:** FFmpeg decodes ~20s windows with 4s overlap, scales to ≤1280px wide, samples at
`--fps`. The vision model returns structured events (plays, scoreboard snapshots, evidence
timestamps, confidence, replay/duplicate links). High-confidence live non-duplicates feed
`candidateCounts`.

**Live:** FFmpeg pulls the OBS URL into `seg_XXXXX.mp4` segments; each closed segment is
observed the same way and appended to one `GameLog`.

**Output:** Durable JSON with `windows`, `events`, `coverage`, `warnings`, and
`enhancements[]`. Evidence frame hashes are kept; video frames are not. Seek the original
file or OBS recording to cited seconds. In events, `presentation: "live"` means original
presentation vs replay — not “this is a livestream.”

Limits: sparse sampling and no audio can miss plays; youth sideline footage is harder than
broadcasts; identity and replay detection need review. Smoke notes for a finished Mets clip:
[VIDEO_EVALUATION.md](VIDEO_EVALUATION.md).

Vision defaults to `CodexVisionModel` (`codex exec --image`). Set `VISION_MODEL` to pin a
CLI model, or inject any image-capable DI Framework `ChatModel`. Sampled frames leave the
machine for that provider; the game log stays local.

## Legacy season tracker

Not part of the spectator. For the older SQLite roster / `save_game` / season-report agent:

```sh
bun start --stats
bun start --report TEAM_ID
bun start --export TEAM_ID > season.csv
bun start --photo /path/to/scorebook.jpg
bun run demo
```

Default DB: `agents/baseball/data/baseball.sqlite` (gitignored). Photos and chat for this
path still use Codex / the configured model. Spreadsheet and GameChanger sync are not
implemented.

## Verify

```sh
bun test
bun run typecheck
bun run demo
```

Tests cover game-log / enhancer plumbing, live demo segments (when FFmpeg is present),
file observer windows, and the legacy store — mostly with fake models, no credentials.
