# Corpus acquisition

Prerequisites:

- Corpus [intake](intake.md) complete, with both `intake.md` and `scope.json`;
  `mode: "case-specific"` does not qualify.
- [Source registry](source-discovery.md) ready: every `must` category is
  `found`, `paywalled`, or `unavailable`, with evidence and manual confirmations
  resolved.

## Folder setup

Create the relevant folders under `legal-references/{ST}/` using the
[folder contract](taxonomy.md). Use the established state code and available
workspace tools; never write a literal placeholder or silently overwrite
existing materials.

## Acquisition steps

For each `found` entry in `sources.json` with priority `must` or `should`:

1. **Download** to the correct folder using the registry `localName`.
2. **Verify** non-empty file and reasonable Content-Type / magic bytes (PDF starts `%PDF`, zip is zip, etc.).
3. **Append** one line to `06-manifests/provenance.jsonl`:

```json
{
  "stateCode": "NC",
  "category": "rules_of_court",
  "localPath": "03-court-system/rules-of-court/rulesofcourt.pdf",
  "sourceUrl": "https://…",
  "retrievedAt": "2026-09-10T18:00:00Z",
  "licenseOrTerms": "observed source terms; record uncertainty explicitly",
  "sha256": "…",
  "bytes": 12345,
  "edition": "2025",
  "confidence": "high"
}
```

4. **Log** human notes in `06-manifests/acquisition-log.md` (success / skip / failure).
5. Mark category status in `06-manifests/coverage-matrix.md`.

### Tooling and hashing

Calculate SHA-256 from the actual stored bytes using a supported tool (for
example, `shasum -a 256 path/to/file` when shell access is available). Web
fetching alone may not provide raw downloads or a digest. If required tools
are unavailable, record the limitation and source link; do not invent a hash,
byte count, local file, or successful acquisition. Example metadata is not an
acquisition record.

### Download hygiene

- Use supported download tools with redirects and HTTP failure handling; use a clear User-Agent when the tool allows it.
- Respect `protocol` overrides (some hosts are http-only).
- Do not bypass paywalls or authenticate to non-public systems.
- If TLS is broken on an **official** host (rare), note it in the log; only proceed if the user explicitly accepts the risk (VA LIS pattern in-repo is historical — do not normalize cert bypass).
- HTML sources: save the canonical URL in provenance; store `.html` plus a one-line `SOURCE.txt` with the URL.

## Coverage matrix

Maintain `06-manifests/coverage-matrix.md`:

| Category               | Priority | Status      | Path                            | Notes                   |
| ---------------------- | -------- | ----------- | ------------------------------- | ----------------------- |
| statutory_code         | must     | acquired    | 02-primary-law/statutory-code/… |                         |
| constitution           | must     | acquired    | …                               |                         |
| family_juvenile_manual | must     | unavailable | —                               | searched AOC 2026-09-10 |

Status values: `acquired` | `partial` | `unavailable` | `paywalled` | `skipped` | `failed`

## State README

Write `legal-references/{ST}/README.md`:

- State name/code, intake baseline grade, domains
- What was acquired vs gaps
- Disclaimer: educational research materials; verify against official sources; not legal advice
- Pointers to manifests

## Stop conditions

- Stop after `must` items are `acquired`, `unavailable`, or `paywalled`.
- Stay within the agreed formats, volume, historical depth, and storage constraints. If a proposed download exceeds that scope, resolve the scope before proceeding. Local storage permission does not imply git commit permission.
- Never copy acquisitions into `packages/datasets/data/` without an explicit promotion request.

## Quality bar

Done for this pass when:

1. Coverage matrix matches intake priorities
2. Every `acquired` file has a provenance.jsonl line with sha256
3. State README exists
4. Grade in README matches taxonomy definitions (`partial` / `core-complete` / `practice-ready` / `parity-with-va` / `blocked`)
