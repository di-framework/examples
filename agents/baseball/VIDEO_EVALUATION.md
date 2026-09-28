# Recorded-video smoke test

Executed September 22, 2026 using the real `CodexVisionModel` through the locally
authenticated Codex CLI. This is one functional example, not an accuracy benchmark.
No source video, frames, or model output was supplied to the inference as text hints.
The model received sampled frames, timestamps, the extraction schema/instructions,
and previous unverified observations for the second window. It had no browsing or
stats tools and received no audio or official play-by-play.

## Source and reproduction

[MLB's Brandon Nimmo highlight](https://www.mlb.com/mets/video/brandon-nimmo-homers-23-on-a-fly-ball-to-center-field)
shows a Mets solo home run against Texas on September 14, 2025. The downloadable playback
is published in [MLB's game content response](https://statsapi.mlb.com/api/v1/game/776335/content).

From `agents/baseball`, with FFmpeg installed and Codex signed in:

```sh
curl -fL 'https://mlb-cuts-diamond.mlb.com/FORGE/2025/2025-09/14/288cbac3-7829be21-e1566e2a-csvm-diamondgcp-asset_1280x720_59_4000K.mp4' -o /tmp/baseball-mets-clip.mp4
bun start --video /tmp/baseball-mets-clip.mp4 --duration all --mode broadcast --output /tmp/baseball-mets-plays.json
```

Input: 15,200,276 bytes, 29.312616 seconds, 1280×720. Sampling: 1 frame/second,
20-second windows with four-second overlap, broadcast mode. Model: CLI default for the
authenticated account, not an explicitly pinned model ID. A different model/default may return
different observations. `VISION_MODEL` can select an available model explicitly.

## Observed output

| Check                   | Result                                                               |
| ----------------------- | -------------------------------------------------------------------- |
| Source coverage         | 0–29.312616 seconds, two successful windows; status `complete`         |
| Proposed outcome        | One solo home run, Nimmo batting, Winn pitching                       |
| Scoreboard              | Texas 0, Mets 1 then Mets 2; bottom of the sixth, no outs              |
| Evidence                | Delivery/swing frames and the explicit solo-home-run graphic          |
| First event interval    | 0.016683–10.026683 seconds, ID `v0-1`                                  |
| Second window           | Replay linked to `v0-1`; no additional live play                       |
| Candidate counts        | `{}`; the live event has non-null uncertainty                         |
| Uncertain observation   | Ball clearing the wall is difficult to resolve in the sampled frames |
| Saved game/player stats | None; output is a review-required game log                            |

The model used the explicit broadcast graphic as evidence for the home run while
retaining uncertainty about the ball clearing the wall. Sampled frames were inspected
locally to verify that the graphic and the later 2–0 scoreboard are present. The event
remains in the log, but `candidateCounts` excludes events with non-null uncertainty,
even when confidence is high. An empty count here does not mean no home run was observed.
Replay detection in this example worked; it can still fail on different footage.

## What remains unvalidated

This does not establish full-game accuracy, every-pitch coverage, ball tracking,
hit/error attribution, earned runs, roster identification across substitutions,
real-time throughput, or performance on youth games without broadcast graphics.
Testing should expand to walks, strikeouts, ordinary outs, baserunning, scoring
changes, commercial breaks, and longer broadcasts, using scorer-reviewed annotations.
Measure missed/extra events, duplicate events, wrong outcomes, and incorrect identities
separately before using video-derived stats without scorer review.
