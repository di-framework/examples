# Legal Reference Corpus Rules & Conventions

When gathering or organizing state legal reference materials for this agent, adhere to the following conventions:

## 1. Official Sources Only

- Prefer official judiciary, legislature, AOC, LIS/LRC, or sentencing-commission hosts.
- Do not invent unofficial summaries as substitutes for primary sources.
- If a category has no public equivalent, mark `unavailable` with search evidence — do not fake placeholders as content.

## 2. Provenance & Storage

- Record provenance (URL, retrieved date, license/terms note, sha256) for every acquired file.
- Store outputs under `legal-references/{STATE_CODE}/` only.
- Never write ad-hoc dumps into `packages/datasets` unless the user explicitly requests promotion.

## 3. Workflow Order

- Acquisition: **state** skill: intake → source discovery → acquisition.
- Applied legal tasks: **general**. When specialized practice guidance is useful, map intake domains to `us/{practice}/` and use the local GitHub GraphQL MCP (`catalog_open` / `catalog_list` / `catalog_read`) or the [legal-skills-open](https://github.com/ThomasMoreAI/legal-skills-open) catalog.
- Do not skip intake. A scope marked `mode: "case-specific"` does not complete corpus intake. Do not start acquisition until every `must` category is `found`, `paywalled`, or `unavailable`.
- Do not use catalog skills as substitutes for acquired primary law under `legal-references/`.

## 4. ThomasMore / legal-skills-open

- Default jurisdiction: `us`. Practice slugs must match catalog kebab-case (see `skills/general/references/practice-map.md`).
- Prefer the local `legal-skills-open` MCP. Pin a commit, navigate listed directories, and fetch skills and references from that same snapshot. Preserve source URLs and blob OIDs. Fall back to GitHub raw/local clone if MCP is unavailable.
- Preserve skill attribution (`author`, `author_url`, `license`, `version`). Follow US citation discipline and the mandatory disclaimer in `skills/general/references/us-cold-start.md`.
- Never invent citations.

## 5. Framing & Safety

- Educational / personal research framing only — not legal advice.
- Note verification duty in manifests and state READMEs.
- Do not bypass paywalls or authenticate to non-public systems.
