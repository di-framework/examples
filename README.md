# di-framework/examples

User-facing sample apps. Library repos keep only CLI/unit-test fixtures (`init-tsc-inspect`, `test-example`).

| Workspace | Contents |
| --- | --- |
| `framework/*` | Portable SDK samples (http, graphql, auth, ai-*, deno, cf-worker, …) |
| `platform/*` | warehouse, kube-apps, plugin-workspace, receipt-worker, actor-counter, … |
| `adapters/*` | Foreign-platform samples (Cloud Foundry when added) |
| `agents/*` | Former `di-framework/example-agents` |

Examples depend on published `@di-framework/*` packages. Producer CI clones this repo and links unpublished PR packages ([#495](https://github.com/di-framework/di-framework/issues/495)).
