# Demonstration workspace

Layout is arbitrary. There is no `apps/` directory and the deploy manifest has
no application list.

```text
di-framework.deploy.toml
deploy/platform/          managed Pulumi platform (k0s-adjacent cluster, registry, operator)
services/greeter/         a DI Framework project
services/settings/        unlabeled wasi:config binding (works on wasmtime -S config)
services/orders/          postgres + two named key-value bindings (imported async
                          funcs use @di-framework/componentize-qjs, wasmtime 48)
nested/deep/echo/         another project, nested wherever it fits
```

## Managed platform

```bash
di-framework platform cluster init
di-framework platform cluster up local --yes
di-framework platform deploy greeter
# Then request http://127.0.0.1:28180 with `Host: greeter`.
di-framework platform destroy greeter
di-framework platform cluster destroy local --yes
```

## Existing cluster (kubeconfig + registry only)

```bash
export KUBECONFIG="$HOME/.kube/config"
di-framework platform deploy greeter --target development
di-framework platform deploy echo --target development
```

Run the CLI directly. Do not wrap these commands in `package.json` scripts.
