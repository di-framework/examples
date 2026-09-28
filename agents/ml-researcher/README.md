# ML Researcher

An interactive research and implementation agent for `di-framework-ml` and `di-framework`. Describe an objective; it can inspect both repositories, research papers and model/dataset cards, implement changes in isolated Git worktrees, run local checks, and save a report.

It can also build a model from a natural-language description when you supply a dataset, input/output contract, and measurable target. The built-in builder supports small numeric MLP classifiers and scalar regressors, plus adaptation of compatible pretrained ONNX models, including embeddings. Arbitrary text, vision, audio, or large-model training requires additional implementation.

## Start

From the workspace root:

```sh
bun install
bun run --cwd agents/ml-researcher start
```

Requires Bun, Git, the existing subscription login used by the other agents, and sibling `di-framework-ml` and `di-framework` repositories. Local model building also requires Rust/Cargo (edition 2024 support). First compilation may download dependencies. The inference dependency points to the sibling `di-framework-ml/packages/infer`, matching the legal agent.

Install the `hf` CLI for Hugging Face paper/model/dataset research. Public URL reads work without a search key; general web search optionally uses `BRAVE_API_KEY`. Hub credentials use the normal CLI environment/login. Research adapters report unavailable tools or credentials as errors.

```sh
bun run --cwd agents/ml-researcher start \
  --ml-repo /path/to/di-framework-ml \
  --framework-repo /path/to/di-framework \
  --data-dir /path/to/datasets
```

Additional flags: `--ml-ref REF`, `--framework-ref REF`, `--runs-dir PATH`, `--resume RUN_ID`, and `--timeout-seconds 600`. Repeat `--data-dir` for extra readable roots. `MODEL` overrides the chat model. `--help` does not require authentication.

## Try a scenario

Put a JSONL dataset in a configured data directory, with at least ten distinct inputs and stable, unique IDs:

```json
{"id":"reading-001","features":[21.4,0.32],"label":0}
{"id":"reading-002","features":[43.8,0.91],"label":1}
```

Then enter:

> Build a binary classifier from /path/to/datasets/readings.jsonl, revision readings-v1. Features are temperature in Celsius and vibration in that order; label 1 means a fault. Start with one hidden layer of 16 units, standardize using training data, use CPU, and spend at most ten minutes. Compare learning rates 0.01 and 0.003 using validation accuracy. The held-out accuracy target is 0.85. Export ONNX and a TypeScript inference example, and explain any unmet target or evaluation limitations.

The agent should clarify missing material details, inspect repository guidance, save the specification, run the build, and report measured scores and artifact paths. A target may remain unmet. Exact-duplicate grouping does **not** prevent leakage across related devices, people, or timestamps; those tasks need a custom split/evaluation before claiming deployment quality.

For repository work, try:

> Inspect both repositories and identify a small, testable improvement to ONNX inference error reporting. Explain the evidence, implement it in the appropriate task worktree, run the repository's relevant checks, and save a report with the diff location and remaining limitations.

## Commands and interface

The shared TUI provides `/` typeahead, up/down navigation, Tab/Enter completion, editable input, and cancellation. Completion fills the command; submit the completed line to run it. Commands are assembled in [`src/commands.ts`](src/commands.ts) using the shared command factory/spread pattern.

| Command                                | Purpose                                                    |
| -------------------------------------- | ---------------------------------------------------------- |
| `/objective DESCRIPTION`               | Start an objective and complete its workflow               |
| `/build DESCRIPTION`                   | Specify, build/adapt, evaluate, and export a model         |
| `/inspect`, `/research`, `/experiment` | Run a selected stage                                       |
| `/implement`, `/verify`, `/report`     | Implement, check, or report a selected stage               |
| `/status`                              | Show saved objective and worktrees without model inference |
| `/clear`                               | Clear conversation history, retaining files and run state  |
| `/help`, `/exit`                       | Help and exit                                              |

A normal natural-language objective runs through completion; separate stage commands are optional. Resume retains artifacts and edits, not the previous chat transcript. Cancellation preserves partial files and logs. A fresh model name is required after a failed or cancelled build; do not change seeds or candidates to chase held-out scores.

## Model contract

Numeric rows use `{id, features: number[], label: number}`. Classification labels are integer class indices: two classes with one logit, or one output logit per class. Regression has one scalar output. MLPs allow zero to four hidden layers, up to one million parameters. The builder accepts up to three learning rates per experiment, a step limit and wall-clock budget, and datasets up to 32 MiB.

Embedding rows use `{id, input_ids: number[], positive: number[]}`. Supply a compatible pretrained ONNX graph, its revision and tokenizer asset, exact I/O names, token length and embedding size. Inputs must be pretokenized, fixed-length and unpadded. Optional `attention_mask` and `token_type_ids` feeds are supported. Outputs use configured mean/CLS/last-token pooling when needed and L2 normalization. Evaluation measures recall@1 against other held-out positives. Operator compatibility is checked by the target Rust graph loader; graph shapes and values are checked through actual inference before training.

The complete validated tool contract is [`src/spec.ts`](src/spec.ts). The builder fits preprocessing on training data, records a deterministic split grouping exact duplicate inputs, measures an initial-model and trivial baseline, selects by validation score, then evaluates the selected candidate on the held-out split once. A pretrained original is eligible to win if adaptation does not improve it.

## Artifacts and reproducibility

Default output is `agents/ml-researcher/runs/<run-id>/`:

- `run.json`: objective, repository paths, pinned base commits and worktree recovery state.
- `worktrees/ml`, `worktrees/framework`: retained task branches; source checkouts are preserved. Normal and bare Git repositories are supported.
- `guidance/`: source-local and pinned-worktree instructions with provenance and missing-reference warnings.
- `sources/`, `notes/`, `logs/`: research evidence, reports, commands, exit statuses and bounded output.
- `native/`: helper source, generated Cargo manifest/lock, and recorded native requests, compiled against this run's ML worktree.
- `models/<name>/`: specification, hardware, dataset/model/tokenizer hashes, split IDs and data snapshots, training-only preprocessing, baselines, trial configs/metrics, selection, status and report.
- `models/<name>/dist/`: ONNX model, specification, preprocessing, optional tokenizer and runnable `infer.ts`.

Run the exported example with Bun where `@di-framework/ml` is installed:

```sh
bun /path/to/dist/infer.ts '[21.4,0.32]'
```

Numeric classification outputs are logits; regression outputs are values. Embedding outputs include the same pooling and normalization used for evaluation. The example expects numeric features or token IDs, not raw text. Training and inference use CPU in this builder. Recorded hashes identify actual input contents; declared dataset/model revision strings are supplied by the caller.

Worktree preparation records intent before creating the branch and recovers completed creations after interruption. Resume validates the repository, branch, and base commit; manual branch changes or commits require reconciliation. No automatic commit, push, publishing, deployment, or cloud jobs are part of this workflow. Local commands execute on a trusted host: directory restrictions are **not an OS sandbox**.

## Testing and design

```sh
bun run --cwd agents/ml-researcher test
bun run --cwd agents/ml-researcher typecheck
bun run --cwd agents/ml-researcher smoke
```

Tests require no model credentials. Process execution, artifact storage, research fetching, model inference and native training are injectable. Tests cover split integrity, selection independent of the held-out set, cancellation, descendant cleanup, bare/normal worktrees, interrupted creation, source-local guidance, research records, shared TUI commands, and a fake-model tool loop that edits a real temporary worktree and runs verification.

The smoke command uses real Rust training and TypeScript/WASM inference for synthetic binary classification, pretrained adaptation, multiclass classification, regression and embedding adaptation, including exported inference examples. It retains its run artifacts and Git worktree. Synthetic scores establish pipeline behavior, not domain quality. Live subscription inference and remote Hub access are separate integration checks.

The agent's workflow guidance lives in [`ml-research`](.agents/skills/ml-research/SKILL.md) and [`model-build`](.agents/skills/model-build/SKILL.md). Task worktrees contain their own tests; run those checks from their repository. The workspace test configuration excludes retained ML run/cache directories from automatic discovery.
