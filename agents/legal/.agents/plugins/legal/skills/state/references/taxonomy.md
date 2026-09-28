# Comparable corpus taxonomy

Maps the Virginia baseline datasets to portable folders under `legal-references/{ST}/`.

## Baseline categories (VA → generic)

| Corpus key               | Virginia example                                | Acquire for any state                                           |
| ------------------------ | ----------------------------------------------- | --------------------------------------------------------------- |
| `statutory_code`         | Code of Virginia (LIS CSV)                      | Full or title-level official code dump / HTML archive           |
| `constitution`           | VA Constitution                                 | State constitution (official text)                              |
| `authorities`            | Authorities, Charters, Compacts, UncodifiedActs | Parallel non-code primary materials if published                |
| `courts_directory`       | District courts directory                       | Trial/appellate court directory (names, venues, types)          |
| `rules_of_court`         | Rules of Court PDF                              | Statewide rules of court / procedure                            |
| `trial_court_manual`     | GD Manual                                       | Limited/general jurisdiction trial-court procedure manual       |
| `family_juvenile_manual` | J&DR Manual                                     | Family / juvenile / domestic relations procedure manual         |
| `benchbook`              | District Court Benchbook                        | Judges’ benchbook or equivalent practice deskbook               |
| `appointed_counsel`      | CAC / indigency guidelines                      | Indigency, appointed counsel, or commissioner manuals if public |
| `crime_codes`            | VCC Book                                        | Charging/sentencing offense codes if the state publishes them   |
| `caseload_stats`         | Circuit/GDC/JDR filings & disps                 | Published court caseload statistics                             |
| `annual_reports`         | State of the Judiciary                          | Judiciary annual / state-of-the-judiciary reports               |
| `misc_procedure`         | Small claims, facility guidelines, UST          | Small claims, forms indexes, other public AOC resources         |

## Folder contract

```
{ST}/
  00-intake/
    intake.md                 # answered alignment questions
    scope.json                # machine-readable scope freeze
  01-source-registry/
    sources.md                # human registry
    sources.json              # structured URLs + hosts
  02-primary-law/
    statutory-code/           # ← virginia_code
    constitution/             # ← constitutional_law
    authorities/              # ← case_law_authorities
  03-court-system/
    courts-directory/         # ← courts (+ directory PDFs)
    rules-of-court/           # ← other/rulesofcourt
    caseload-stats/           # ← caseload_stats (+ appellate if found)
    annual-reports/           # ← annual_reports
  04-procedure-manuals/
    trial-court/              # ← gdman
    family-juvenile/          # ← jdrman
    benchbook/                # ← benchbook
    appointed-counsel/        # ← cac_manual
  05-specialized/
    crime-codes/              # ← vcc
    small-claims/             # ← other/small_claims…
    other/                    # ← residual other/
  06-manifests/
    coverage-matrix.md
    acquisition-log.md
    provenance.jsonl          # one JSON object per acquired file
  README.md
```

## Completeness grades

| Grade            | Meaning                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `core-complete`  | statutory_code + constitution + rules_of_court + courts_directory + ≥1 procedure manual                   |
| `practice-ready` | core-complete + family/juvenile or trial manual + benchbook + caseload_stats                              |
| `parity-with-va` | practice-ready + crime_codes (or documented N/A) + annual_reports + authorities (or N/A) + misc_procedure |
| `partial`        | Any intentional subset frozen in intake `scope.json`                                                      |
| `blocked`        | Official sources not locatable / paywalled / ToS forbids bulk copy                                        |

## File naming

- Prefer source filenames when stable: `rulesofcourt.pdf`
- Otherwise: `{yyyy-mm-dd}_{slug}.{ext}`
- Add a sibling `.meta.json` when `provenance.jsonl` is insufficient, such as when preserving multiple candidate source URLs.

## Format preference (in order)

1. Official bulk CSV / JSON / XML
2. Official PDF manuals
3. Official HTML (save complete page + note canonical URL)
4. Last resort: documented deep link only (no scrape of interactive paywalled DBs)

## Completion and promotion

Report the grade supported by acquired materials, not the requested target.
Unavailable or paywalled `must` categories can end an acquisition pass without
meeting its desired completeness grade.

This pack is a research acquisition workspace. Promoting it into a framework
dataset with refresh scripts, ETL, or embeddings is a separate engineering task
requiring an explicit promotion request after coverage is assessed.
