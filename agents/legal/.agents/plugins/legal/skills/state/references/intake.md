# Corpus intake

Freeze research scope **before** downloading. Write answers into:

`legal-references/{ST}/00-intake/intake.md`  
`legal-references/{ST}/00-intake/scope.json`

Use existing workspace templates when available; do not require templates to begin.
Read existing destinations before writing. Do not overwrite case-specific scope
or another case; resolve the workspace conflict first.

## Intake from case data

The agent automatically supplies `case-data/README.md` from its working
directory with each chat request. If available, prefill the questionnaire from
that source before asking the user anything. Read documents it references with
the workspace file tools when they help resolve an answer.

Record which case-data section or document supports each answer. Preserve the
distinction between reported facts, disputed allegations, and verified sources.
Blank fields, UNKNOWN, TBD, and illustrative examples are not answers.
Flag inconsistent facts and ask only for required answers that remain unresolved.

Do not infer permission to redistribute, commit, or acquire materials from
silence. Do not change the original case README unless the user requests it.
When the required information is sufficient, write the intake artifacts below;
otherwise return the focused missing-information questions. The existing scope
and acquisition gates still apply.

## Alignment questions (required)

Answer every question. Use `TBD` only with a follow-up owner/date.

### A. Jurisdiction & purpose

1. **Target state** — full name + two-letter code (e.g. North Carolina / `NC`).
2. **Comparability baseline** — mirror full VA corpus, or a named subset (`core-complete`, `practice-ready`, `parity-with-va`, custom)?
3. **Primary use** — RAG/knowledge base, filing templates, eval questions, human research binder, or engineering dataset promotion?
4. **Practice domains** — family/custody, estate/probate, criminal, civil general, all of the above? Also list ThomasMore `us/{practice}/` slugs for **general** (e.g. `family`, `litigation`); consult its practice mapping when catalog guidance is needed.
5. **Audience** — pro se education, internal engineering, attorney research aid? (Affects tone of README disclaimers.)

### B. Court-system mapping

6. What are the state’s **trial court tiers** (names equivalent to VA Circuit / General District / J&DR)?
7. What are the **appellate courts** (supreme / intermediate)?
8. Which tier handles **family / juvenile / domestic** matters?
9. Is there a separate **probate / surrogate / orphans’** court?
10. Are **rules of court** statewide, by court type, or local?

### C. Source expectations

11. Official **statute** host (legislature / LRC / LIS analogue)? Bulk download available?
12. Official **constitution** source?
13. Official **judiciary / AOC** portal for manuals, stats, directories?
14. **Sentencing / crime-code** publisher (if any)?
15. Known **ToS, robots, CAPTCHA, or cert** constraints?

### D. Acquisition constraints

16. **Allowed formats** — PDF only, HTML OK, bulk CSV preferred?
17. **Max volume** — full code vs priority titles only? List titles if subset (e.g. domestic relations, civil procedure, evidence).
18. **Historical depth** — current only, or N years of annual reports / VCC analogues?
19. **License / redistribution** — may files be committed to git? Local-only?
20. **Deadline / completeness grade** required for this pass?

### E. Comparability checks (map to VA)

For each category, mark `must` / `should` / `skip` / `unknown`:

| Category               | Priority | State analogue name (if known) |
| ---------------------- | -------- | ------------------------------ |
| statutory_code         |          |                                |
| constitution           |          |                                |
| authorities            |          |                                |
| courts_directory       |          |                                |
| rules_of_court         |          |                                |
| trial_court_manual     |          |                                |
| family_juvenile_manual |          |                                |
| benchbook              |          |                                |
| appointed_counsel      |          |                                |
| crime_codes            |          |                                |
| caseload_stats         |          |                                |
| annual_reports         |          |                                |
| misc_procedure         |          |                                |

### F. Success criteria

21. What does **done** mean for this state pack (grade + must-have files)?
22. Who **reviews** provenance before any ETL into `packages/datasets`?
23. Should live APIs (CourtListener / LegiScan / GovInfo) be used only for **gap-filling citation** or also as primary acquisition? Default: gap-filling only.

## Produce `scope.json`

The example below illustrates the shape, not default answers. Include all
category priorities and preserve the remaining questionnaire answers in
`intake.md` (and structured fields where useful). Do not invent constraints,
permission, court mappings, or review commitments.

```json
{
  "mode": "state-corpus",
  "stateCode": "NC",
  "stateName": "North Carolina",
  "baseline": "practice-ready",
  "domains": ["family", "civil"],
  "thomasmoreJurisdiction": "us",
  "thomasmorePractices": ["family", "litigation"],
  "priorities": {
    "statutory_code": "must",
    "constitution": "must",
    "rules_of_court": "must",
    "family_juvenile_manual": "must",
    "benchbook": "should",
    "crime_codes": "skip"
  },
  "titleFilter": null,
  "historicalYears": 3,
  "gitCommitAllowed": false,
  "apisForGapFillOnly": true,
  "doneWhen": "practice-ready grade with provenance.jsonl complete"
}
```

## Gate

Do **not** start source discovery until both artifacts exist, the required
corpus questionnaire answers are resolved, and category priorities are explicit.
A recorded `TBD` identifies follow-up work; it does not make a blocking input
complete. Resolve unknowns affecting `must` items or agree a narrower scope with
the user. Do not silently demote priorities to pass the gate.

A `scope.json` whose `mode` is `case-specific` is never sufficient. Existing
legacy corpus scopes without a mode may be used only after checking the full
corpus questionnaire and constraints; identify new corpus scopes as
`mode: "state-corpus"`.
