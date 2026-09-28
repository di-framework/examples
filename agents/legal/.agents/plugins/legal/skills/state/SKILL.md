---
name: state
description: >-
  Gather and maintain a comparable U.S. state legal reference corpus through
  scoped intake, official source discovery, and acquisition with provenance.
  Use for collecting state statutes, constitutions, court rules, manuals,
  directories, statistics, and related primary materials.
---

# State

Build the requested state reference pack under `legal-references/{ST}/`, using
an established two-letter state code. Scale coverage to the agreed scope;
Virginia provides category analogues, not assumed court names or legal rules.

For case-specific analysis, follow the case commands in the agent instructions.
A case-specific intake is not corpus intake and does not authorize a corpus
download. Use **general** for applied practice guidance from the external
catalog; catalog skills do not replace primary law.

## Corpus workflow

1. Read [intake](references/intake.md) to establish jurisdiction, categories,
   constraints, and completion criteria. Prefill from available case data and
   ask only for unresolved required answers. Write both intake artifacts.
2. Read [source discovery](references/source-discovery.md) after complete
   corpus intake. Record official portals, inspected download URLs, access
   limits, and evidence for gaps in the source registry.
3. Read [acquisition](references/acquisition.md) only when every `must`
   category is `found`, `paywalled`, or `unavailable`, and manual confirmations
   are resolved. Acquire permitted sources and record actual results.

Read [taxonomy](references/taxonomy.md) when selecting categories, placing
files, or assessing completeness. Load only the reference needed for the
current phase.

## Invariants

- Do not skip corpus intake. A `scope.json` with `mode: "case-specific"` never
  satisfies discovery or acquisition prerequisites.
- Prefer official judiciary, legislature, AOC, code-publisher, and sentencing
  commission sources. Never replace missing primary materials with invented
  summaries; record unavailable sources with evidence.
- Every acquired file needs its source URL, retrieval date, license or terms
  note, and an actual SHA-256 digest. If available tools cannot download or
  hash a file, record that limitation instead of claiming acquisition.
- Preserve original case documents. Acquisition permission does not imply
  permission to commit, redistribute, or promote files into a dataset.
- Respect access limits; do not bypass paywalls or authenticate to non-public
  systems. Keep verification duties and coverage gaps visible in manifests.
