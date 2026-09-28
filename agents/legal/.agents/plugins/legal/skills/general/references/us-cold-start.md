# US cold-start (from legal-skills-open)

Condensed from
[`us/CLAUDE.md`](https://github.com/ThomasMoreAI/legal-skills-open/blob/main/us/CLAUDE.md)
in [ThomasMoreAI/legal-skills-open](https://github.com/ThomasMoreAI/legal-skills-open)
(Apache-2.0). Prefer the upstream file when available.

## Legal family

Common law (federal plus the 50 states, D.C., and territories). Binding
precedent (stare decisis). Federal and state systems are parallel — always
identify which one governs.

## Sources of law (by priority)

1. U.S. Constitution; treaties.
2. Federal statutes (U.S. Code) and the Code of Federal Regulations (CFR).
3. Federal case law (Supreme Court → Courts of Appeals → District Courts).
4. State constitutions, statutes, regulations, and case law.
5. Local ordinances.

For this agent’s **state packs**, treat materials under
`legal-references/{ST}/` as the working state corpus for (4), after verifying
they are current official texts.

## Citation discipline

- Statutes: title, code, section — e.g. `42 U.S.C. § 12112`; regulations —
  `29 C.F.R. § 1630.2`.
- Cases: name, reporter, court, year — e.g.
  `Hertz Corp. v. Friend, 559 U.S. 77 (2010)`.
- Follow Bluebook form. **Never invent** citations, case numbers, or section
  numbers. If unknown, say so and prompt verification.

Useful catalog skills: `us/general/skills/citation-format`,
`us/litigation/skills/citation-bluebook`,
`us/litigation/skills/legal-research-cite-finder`.

## Current law

Statutes, regulations, and controlling precedent change. State the version/date
assumed and warn the user to confirm currency — federal vs. state and circuit
splits can change the answer.

## Mandatory disclaimer

> This output is informational only and is not legal advice. Verify against the
> current statute/regulation and the rules of the specific court or agency
> before relying on it.
