---
name: case-law-research
description: >-
  Find and qualify judicial authority for a framed legal issue — plan
  searches across the CourtListener tools, run a multi-modal sweep, rank
  what is found as binding or persuasive for the target forum, and record
  search provenance including what was not found. Use when a task requires
  locating case law; use case-read for close reading of what is retained.
license: UNLICENSED
---

# Case-law research

Locate the judicial authority a framed issue needs and qualify it for the
target forum. Searching produces candidates; `case-read` extracts what a
retained opinion actually decides, and `general` governs citation,
verification and output method. Research here answers "what cases exist and
which matter," never "is this still good law" — no citator is available.

## Plan before searching

For each issue, fix what a responsive case must contain: the doctrinal
question, the target jurisdiction and its court hierarchy (which courts bind
this forum, which merely persuade), the relevant period, and the procedural
posture that would make a holding comparable. Draft search terms in two
registers — the doctrine's terms of art and the fact pattern's ordinary
language — and plan more than one search modality per issue; no single query
establishes coverage.

## Tools and their limits

The `courtlistener` MCP exposes two retrieval paths with different coverage:

- **`semantic_search_opinions`** — meaning-based search over _imported_
  CourtListener opinion chunks (DI Framework S3 Vectors; the query is
  embedded locally and only the vector leaves the machine). Coverage grows
  during import: a missing result never establishes that no relevant law
  exists. The index carries no court or date metadata, and similarity
  scores are retrieval signals, not legal authority. Results are chunks with
  opinion IDs, not cluster IDs.
- **`get_opinion_chunk`** — read an imported chunk by opinion ID and chunk
  number, paged by character offset. A chunk is not necessarily the whole
  opinion; do not characterize an opinion from one chunk.
- **`search_opinions`** — CourtListener's live REST search (keywords, case
  names, citations), filterable by court code (`scotus`, `ca4`, `va`, …) and
  paged with `next_cursor`. Requires `COURTLISTENER_API_TOKEN` in the MCP
  server environment; treat token absence as a recorded access failure, not
  a reason to skip the issue.
- **`get_opinion`** — full opinion text by the _nested_ opinion ID from
  `search_opinions` (never a cluster ID), paged by character offset. It does
  not determine whether the case remains good law.

Official court and government sites via web fetching are the fallback and the
verification path for anything the tools surface. Web search and shell
execution are unavailable; do not imply otherwise.

## Execute a sweep

Run modalities that fail differently, and let each round feed the next:

1. **Concept search** with `semantic_search_opinions` for the issue phrased
   both doctrinally and factually.
2. **Keyword, name and citation search** with `search_opinions`, filtered to
   the binding courts first, then widened to persuasive jurisdictions.
3. **Citation chaining**: retrieve promising opinions and mine the
   authorities they apply — the anchor precedents an opinion marshals are
   often the cases the issue actually turns on. Search those by name and
   citation.
4. **Vocabulary iteration**: reuse the terms of art discovered in retrieved
   opinions as new queries; courts' own phrasing outperforms invented
   synonyms.

Page through result sets rather than stopping at the first plausible hit,
and record every query verbatim with its tool, filters, date and result
count — including zero-result queries. A negative log is part of the work
product: it bounds what "no authority found" can honestly mean.

## Qualify each candidate

Before a case enters the working list:

- Establish its court and that court's relation to the target forum —
  binding, persuasive, or merely illustrative — from the court's actual
  position in its hierarchy, not its style (`case-read` caption discipline).
- Confirm case identity: name, citation, court, date and the opinion ID
  actually retrieved. Keep opinion IDs and cluster IDs distinct, and never
  cite from a search snippet or single chunk — retain only cases whose
  relevant text was actually read, applying `case-read` to each.
- Classify what the case is _for_: the proposition it supports for this
  issue, with a precise locator, and whether it helps, hurts, or bounds the
  argument. Contrary authority is retained, not filtered out.

## Currency and treatment

No citator is available through these tools. Record subsequent treatment as
**not checked** unless verified through an inspected source; finding a
citation is not verifying it. Searching later opinions for the case name is
a partial signal worth recording as such — it can surface negative
treatment, but silence proves nothing. Similarity scores, retrieval rank and
recency establish neither validity nor weight. Carry every unresolved
currency check forward explicitly into the research memo and any brief.

## Output

Record results per issue under the established `legal-references/{ST}/`
case-work paths, feeding the `/research` stage memo: for each retained case,
the citation, court, date, opinion/cluster IDs, retrieval tool and date, the
proposition supported with locator, binding status for the target forum,
treatment status, and remaining doubts; plus the query log with misses and
access failures. This is research method for educational and
personal-research use, not legal advice, and no search result authorizes
filing or external contact.
