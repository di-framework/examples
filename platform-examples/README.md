# Platform examples

Applications for the di-framework platform plugin. Each service is its own project under `services/` and is deployed with the platform CLI, not by hand.

```bash
export KUBECONFIG=/path/to/tenant.kubeconfig
di-framework platform deploy mesh-collector --target warehouse
di-framework platform deploy mesh-site --target warehouse
```

`--target warehouse` selects the tenant credential in `di-framework.deploy.toml`: namespace `di-tenant-warehouse`, host group `tenant-warehouse`.

Both services set `workload` to `mesh` and `persistentStorage` to true, so they share `/var/lib/di-framework/storage/mesh`. Inside the guest that directory is `DI_STORAGE_DIR` (normally `/data`).

## mesh-collector

A long-lived service. It subscribes to the public Meshtastic MQTT broker and writes three files under the shared storage directory:

- `traffic.jsonl` — one JSON object per `ServiceEnvelope`: `topic`, `gatewayId`, `channelId`, `from`, `ts`, and `raw` (the original bytes, base64).
- `maps.jsonl` — one latest place per node. Map reports on `/2/map/` carry the node name and a coarse latitude and longitude. Cleartext position packets on LongFast do the same, labeled with the node id. Encrypted packets stay off this list.
- `stats.json` — counts of still-encrypted LongFast envelopes. Those payloads are not decoded.

`MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, and `MQTT_TOPICS` override the public broker defaults. `MQTT_TOPICS` is a comma-separated list. `MQTT_CLIENT_ID` overrides the generated client id.

## mesh-site

An HTTP component on host `mesh-site`. `GET /` redirects to `/assets/index.html`. The page, stylesheet, and script are packaged from `public/` into `src/assets.ts` (`bun services/mesh-site/scripts/package-assets.ts` from this directory rewrites that module after a public-file change).

`GET /api/catalog` reads the collector files through an in-process service binding: the page handler calls `mesh-catalog` as caller `mesh-site`, granted the `snapshot` operation. The response has the latest map reports, the latest traffic rows without `raw`, and the encrypted-envelope counts. The page fetches that route on the same host when it loads, when Refresh is clicked, and every two seconds after that. wasmCloud routes HTTP by Host header, so the page and the catalog stay in this component.
