# Platform examples

The Meshtastic example: `mesh-collector` reads the public Meshtastic MQTT feed and `mesh-site` shows it as a live map and traffic table. One `pulumi up` creates a local platform with tenant `meshtastic` and deploys both services into it.

## Run it

You need [Bun](https://bun.sh), [Pulumi](https://www.pulumi.com/docs/install/), Docker or Podman, and the `di-framework` CLI with the platform plugin.

```sh
export PULUMI_CONFIG_PASSPHRASE=meshtastic   # any value; it encrypts this stack's secrets
cd deploy
bun install
pulumi up
```

`bun install` creates stack `dev` in `deploy/.pulumi-state` and records whether this machine uses `docker` or `podman`. `pulumi up` then:

1. Starts k0s in a container, with a registry on `127.0.0.1:25000` and the HTTP gateway on `127.0.0.1:28180`.
2. Builds the tenant host image (`deploy/tenant-host`: wash 2.8.0 with `wasi-tls`, which `mesh-collector` needs) and pushes it to that registry. The first build compiles wash and takes about ten minutes; later runs use the build cache.
3. Creates tenant `meshtastic` and user `dev`, approves the collector's egress to `mqtt.meshtastic.org:1883`, and creates the `mesh-objects` blobstore service the two services share.
4. Writes the `dev` kubeconfig to `deploy/.tenant-meshtastic-dev.kubeconfig` (git-ignored).
5. Deploys `mesh-collector` and `mesh-site` with `di-framework platform deploy`. Changing a service's sources and running `pulumi up` again redeploys it.

When it finishes, open the printed URL:

```sh
pulumi stack output meshSiteUrl   # http://mesh-site.meshtastic.localhost:28180/
```

The map and traffic table fill in within a few minutes, once the collector has heard from the mesh.

## Tenant console

```sh
eval "$(pulumi stack output console)"
```

That runs `di-framework platform console` from this directory with the generated kubeconfig. It prints `Console listening on http://127.0.0.1:<port>`; open that URL. The console shows the `mesh` application, its logs, and links to its routes.

## Clean up

```sh
pulumi destroy
```

This removes the cluster container, its volumes and network, and the kubeconfig files.

## Deploying by hand

`di-framework.deploy.toml` has one target, `meshtastic`, set as `default-target`. `tenant = "meshtastic"` selects namespace `di-tenant-meshtastic` and host group `tenant-meshtastic`. With a tenant kubeconfig:

```sh
export KUBECONFIG=/path/to/tenant.kubeconfig
di-framework platform deploy mesh-collector
di-framework platform deploy mesh-site
```

Both services set `workload` to `mesh`. They share the blobstore container `mesh` through a `blobstore-nats` backing service, `mesh-objects`, bound as `objects`: each binding class selects the projected `di-binding-objects` ConfigMap with `configFrom`. `deploy/` creates the service and binding before it deploys the services. Without `configFrom` the host would give each service its own in-memory store and the site would never see the collector's files. The collector writes `traffic.jsonl`, `maps.jsonl`, and `stats.json` in that container, and the site reads them. `persistentStorage` stays false: the data lives in the backing service.

## mesh-collector

A long-lived service. It subscribes to the public Meshtastic MQTT broker and writes three objects in the shared blobstore container:

- `traffic.jsonl` — one JSON object per `ServiceEnvelope`: `topic`, `gatewayId`, `channelId`, `from`, `ts`, and `raw` (the original bytes, base64).
- `maps.jsonl` — one latest place per node. Map reports on `/2/map/` carry the node name and a coarse latitude and longitude. Cleartext position packets on LongFast do the same, labeled with the node id. Encrypted packets stay off this list.
- `stats.json` — counts of still-encrypted LongFast envelopes. Those payloads are not decoded.

`MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, and `MQTT_TOPICS` override the public broker defaults. `MQTT_TOPICS` is a comma-separated list. `MQTT_CLIENT_ID` overrides the generated client id.

The collector declares `allowedIpNameLookups: ["mqtt.meshtastic.org"]`. On a tenant target the CLI turns that into an `egress` backing service and binding; the platform grants the connection once an administrator approves the destination (`egressAllowedDestinations` in `deploy/Pulumi.yaml`). Pointing `MQTT_URL` at another broker needs that broker approved the same way.

## mesh-site

An HTTP component on host `mesh-site`. `GET /` redirects to `/assets/index.html`. The page, stylesheet, and script are packaged from `public/` into `src/assets.ts` (`bun services/mesh-site/scripts/package-assets.ts` from this directory rewrites that module after a public-file change).

`GET /api/catalog` reads the collector files through an in-process service binding: the page handler calls `mesh-catalog` as caller `mesh-site`, granted the `snapshot` operation. The response has the latest map reports, the latest traffic rows without `raw`, and the encrypted-envelope counts. The page fetches that route on the same host when it loads, when Refresh is clicked, and every two seconds after that. wasmCloud routes HTTP by Host header, so the page and the catalog stay in this component.
