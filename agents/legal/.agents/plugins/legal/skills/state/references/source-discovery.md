# Official source discovery

Prerequisite: complete corpus intake under
`legal-references/{ST}/00-intake/`, following the gate in
[intake](intake.md). Merely finding `scope.json` is insufficient, and
`mode: "case-specific"` does not satisfy this prerequisite.

Write:

- `legal-references/{ST}/01-source-registry/sources.md`
- `legal-references/{ST}/01-source-registry/sources.json`

## Search order (official first)

Use available search or fetch tools and official links actually inspected.
When only web fetching is available, navigate known official portals; do not
claim a search engine or exhaustive search was used. Record access and tooling
limits as unresolved discovery work.

1. State **Administrative Office of the Courts / Judiciary** site
2. State **legislature / code publisher / LRC / LIS**
3. State **constitution** page (often legislature or SOS)
4. **Sentencing commission** / crime-code publisher
5. State **open-data / CKAN** portals (stats only — verify official)
6. Live APIs for **gap fill only** if intake allows: LegiScan (statutes metadata), CourtListener (opinions — not a substitute for code dumps), GovInfo (federal only)

## Per-category discovery checklist

For each `must`/`should` category in scope:

```
- [ ] Canonical landing URL
- [ ] Direct file URL(s) or bulk export path
- [ ] Format (pdf|csv|html|xml|zip)
- [ ] Last-updated / edition year if shown
- [ ] Access notes (TLS quirks, http-only, ToS, login)
- [ ] Confidence: high (official direct) | medium (official but nested) | low (secondary index)
```

## `sources.json` schema

```json
{
  "stateCode": "NC",
  "retrievedAt": "2026-09-10",
  "categories": [
    {
      "key": "rules_of_court",
      "priority": "must",
      "status": "found",
      "title": "North Carolina Rules of Appellate Procedure",
      "publisher": "North Carolina Judicial Branch",
      "landingUrl": "https://…",
      "files": [
        {
          "url": "https://…/rules.pdf",
          "localName": "rulesofcourt.pdf",
          "format": "pdf",
          "edition": "2025"
        }
      ],
      "accessNotes": "",
      "confidence": "high",
      "vaAnalogue": "other/rulesofcourt.pdf"
    }
  ]
}
```

`status` values: `found` | `candidate` | `unavailable` | `paywalled` | `needs-manual-confirm`

## Court-name translation aid

When mapping manuals, translate VA labels:

| VA label         | Look for in target state                                              |
| ---------------- | --------------------------------------------------------------------- |
| General District | limited jurisdiction / district / municipal / magistrate court manual |
| J&DR             | family, juvenile, domestic relations, child support procedure         |
| Circuit          | superior / circuit / county trial court of general jurisdiction       |
| Benchbook        | judges’ benchbook, deskbook, chambers manual (public editions only)   |
| VCC              | offense code book, charge codes, sentencing reference                 |

## Evidence for `unavailable`

When adequate inspected evidence establishes that no public official equivalent
is available, record `unavailable` with the following evidence. An inaccessible
tool or an unsuccessful single fetch does not establish unavailability:

- Queries / portal paths tried
- Date
- Closest substitute (if any) marked `candidate` — do not auto-acquire candidates without user confirm

## Gate

Acquisition may begin when every `must` category is `found`, `paywalled`, or
`unavailable` (with evidence). Resolve all `needs-manual-confirm` with the user
first. Preserve `candidate` and unresolved categories as such; do not recast
access failures as completed discovery.
