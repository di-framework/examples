# Legal agent

A case research agent built with di-framework. Fill in the facts, walk through a
short workflow, and get a sourced brief.

## Setup

Sign in with Codex (`codex login`), then from this directory:

```sh
bun install
bun start
```

Put what you know in `case-data/README.md`. Leave unknowns as `UNKNOWN`.

## CourtListener search

The plugin starts the CourtListener MCP at
`.agents/plugins/legal/mcp/caselaw.ts`. Semantic search uses DI Framework's
`S3VectorStore` with the private `courtlistener/modernbert-768` index in
`us-west-2`. Query inference uses `@di-framework/ml` from the sibling checkout
`../../../di-framework-ml/packages/infer` (relative to this agent). Keep that checkout
beside `example-agents` when running `bun install`.

Install `uv`, then export and verify the local model once:

```sh
bun run embeddings:prepare
# If using an AWS login profile, authenticate with: aws login
bun .agents/plugins/legal/mcp/caselaw.ts --warmup
```

Preparation downloads the Free Law Project model and a pinned Python export runtime,
exports an unquantized ONNX graph (about 600 MB), and compares the TypeScript
tokenizer, vectors, padding behavior, and fixture retrieval rankings with Python.
The bundle and its checksum/verification records live in `.cache/courtlistener-onnx/`;
they are generated locally and excluded from Git. Rerun `bun run embeddings:verify`
to repeat the checks without exporting. Unverified or changed bundles are rejected.

Queries use `freelawproject/modernbert-embed-base_finetune_512` at revision
`04f0141fbc045122439d28d51ba670f3091e9ed8`, with the same tokenizer,
`search_query: ` prefix, masked mean pooling, and L2 normalization. The pinned
model's actual sequence limit is 8,192 tokens despite `_512` in its name.
`@di-framework/ml` runs the graph on WASM CPU in a reusable Bun worker. Cancellation
or the 60-second inference timeout terminates the worker; the next request reloads it.
Python is used only for preparation, with no subprocess or download during a query.

Query text stays local; only the vector goes to AWS. The AWS SDK uses its default credential chain (environment, shared profiles,
login/SSO sessions, or workload roles). Search and object retrieval call the SDK
directly; they do not launch the AWS CLI. No separately running embedding server
is needed. This change preserves the existing vector space; it does not train a new
model or reindex opinions. See [model provenance](scripts/EMBEDDINGS.md).

`semantic_search_opinions` returns matching chunks and current import coverage.
Use `get_opinion_chunk` with its opinion ID and chunk number for more text. Results
are incomplete while import runs; missing results do not establish absence of law.
Optional `opinion_id` filtering is available, but court/date metadata is not in
this index. Similarity scores do not establish legal authority or current validity.

The existing `search_opinions` and `get_opinion` tools use CourtListener's live
REST API and require `COURTLISTENER_API_TOKEN` in the server environment.

## Workflow

Work stage by stage at the prompt:

`/intake` → `/timeline` → `/issues` → `/gaps` → `/research` → `/verify` → `/brief`

Ask ordinary questions between stages. Outputs land under
`legal-references/{STATE}/`. Type `/help` for commands, `/exit` when done.

## Use in code

```ts
import { createChatModel } from "@di-framework/ai";
import { createLegalAgent } from "./src/agent.ts";

const legal = await createLegalAgent(
  createChatModel({ provider: "openai", auth: "subscription" }),
);
try {
  console.log((await legal.agent.chat("/intake")).content);
} finally {
  await legal.close();
}
```

## Verify

```sh
bun test
bun run typecheck
```
