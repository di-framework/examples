# Intake domain → legal-skills-open practice map

Canonical practice slugs come from
[ThomasMoreAI/legal-skills-open `practices.json`](https://github.com/ThomasMoreAI/legal-skills-open/blob/main/practices.json).
US plugins live under `us/{practice}/`.

## Default mapping (legal-agent intake → catalog)

| Intake `domains` value         | ThomasMore `practice`                    | Typical US plugin               |
| ------------------------------ | ---------------------------------------- | ------------------------------- |
| `family` / `custody`           | `family`                                 | `us/family/`                    |
| `estate` / `probate`           | `trusts-and-estates`                     | `us/trusts-and-estates/`        |
| `criminal`                     | `criminal`                               | `us/criminal/`                  |
| `civil` / `litigation`         | `litigation`                             | `us/litigation/`                |
| `contracts`                    | `contracts`                              | `us/contracts/`                 |
| `employment` / `labor`         | `employment`                             | `us/employment/`                |
| `real-estate` / `property`     | `real-estate`                            | `us/real-estate/`               |
| `tax`                          | `tax`                                    | `us/tax/`                       |
| `corporate` / `business`       | `corporate`                              | `us/corporate/`                 |
| `ip` / `intellectual-property` | `ip`                                     | `us/ip/`                        |
| `privacy` / `data-protection`  | `data-protection`                        | `us/data-protection/`           |
| `immigration`                  | `immigration`                            | `us/immigration/`               |
| `bankruptcy`                   | `bankruptcy`                             | `us/bankruptcy/`                |
| `healthcare`                   | `healthcare`                             | `us/healthcare/`                |
| `insurance`                    | `insurance`                              | `us/insurance/`                 |
| `regulatory` / `admin`         | `regulatory`                             | `us/regulatory/`                |
| `general` / unspecified        | `general` (+ `litigation` for procedure) | `us/general/`, `us/litigation/` |

When intake lists multiple domains, discover skills in **each** mapped practice;
prefer the narrower practice over `general`.

## Corpus categories that unlock common practices

| Corpus key (after acquisition)                                   | Practices that commonly need it                         |
| ---------------------------------------------------------------- | ------------------------------------------------------- |
| `statutory_code`, `constitution`                                 | almost all; especially `general` / `statutory-analysis` |
| `rules_of_court`, `trial_court_manual`, `family_juvenile_manual` | `litigation`, `family`, `criminal`                      |
| `benchbook`                                                      | `litigation`, `criminal`, `family`                      |
| `crime_codes`                                                    | `criminal`, `white-collar`                              |
| `caseload_stats`, `annual_reports`                               | research / eval — not drafting skills                   |
| `appointed_counsel`                                              | `criminal`, `family`                                    |

## Writing `thomasmorePractices` in `scope.json`

```json
"thomasmorePractices": ["family", "litigation"],
"thomasmoreJurisdiction": "us"
```

Use catalog kebab-case slugs only (see table above). Prefer `us` unless the user
explicitly needs another ISO country folder or `cross-jurisdiction`.
