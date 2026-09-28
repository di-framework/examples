# Reproduce the CourtListener → S3 Vectors import

This directory contains the importer used on September 11, 2026. It converts
CourtListener's public embedding JSON files into a private, searchable **S3 Vectors
index**. A normal `aws s3 sync` cannot do this conversion: ordinary S3 objects and
S3 Vectors records have different APIs and formats.

The instructions below create a new deployment in **your AWS account**. They do
not modify the deployment described in [this run's resource record](#original-deployment).
Run commands from this directory in Bash or Zsh. The scripts are included here;
no CourtListener API token, GPU, or model inference is needed for the import.

## What is copied

Source:

```text
s3://com-courtlistener-storage/embeddings/opinions/freelawproject/modernbert-embed-base_finetune_512/
```

Each source JSON object contains an opinion ID and an `embeddings` array. Each
array entry contains `chunk_number`, `chunk`, and a numeric `embedding`.
[`import_vectors.py`](import_vectors.py) maps those entries as follows:

| Source | Destination |
| --- | --- |
| `id` + `chunk_number` | Vector key `opinion_id:chunk_number` |
| `embedding` | `data.float32`, exactly **768 dimensions** |
| `chunk` | Non-filterable metadata `text` |
| Opinion ID | Filterable metadata `opinion_id`, stored as a **string** |
| Chunk number | Filterable metadata `chunk_number`, stored as a number |
| Source object key and ETag | Non-filterable metadata `source_key`, `source_etag` |

The index uses **cosine distance**. The model name's `512` describes chunking, not
vector dimensions. Text whose metadata would exceed the importer's conservative
38,000-byte threshold is stored intact in the ordinary state bucket at
`chunks/{opinion_id}/{chunk_number}.txt`; the vector instead gets `text_s3_key`.
Keep that bucket if you need those overflow chunks.

This is a one-time traversal of the embedding prefix. It does not copy PDFs,
dockets, quarterly database dumps, or unrelated objects. It does not continuously
synchronize changes or remove records deleted upstream.

## 1. Prerequisites and account

Use AWS CLI v2 with `aws login` and `aws s3vectors` support, Python 3.11 via `uv`,
and `curl`. This run used AWS CLI **2.36.43** and boto3 **1.43.93**.

Your provisioning identity needs permission to create S3 and S3 Vectors resources,
an EC2 instance/security group, and an IAM role/instance profile, including
`iam:PassRole` for the worker role. The worker itself gets the much narrower
policy in step 4. A root identity is not required.

```sh
aws login
export AWS_DEFAULT_REGION=us-west-2
export MIRROR_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
export MIRROR_STATE_BUCKET="courtlistener-import-${MIRROR_ACCOUNT}-us-west-2"
aws sts get-caller-identity
```

Check the displayed account before provisioning. If using a named profile, set
`AWS_PROFILE` consistently for the local commands. The remote worker authenticates
with its EC2 role, not your local credentials.

The names `courtlistener`, `modernbert-768`, and `courtlistener-vector-import`
below assume a fresh deployment. If these resources already exist, inspect them
and either resume the existing deployment or choose new names consistently in the
scripts and commands. Do not initialize an existing checkpoint again.

We use `us-west-2` because that is the source bucket's region. Running the conversion
there avoids relaying the corpus through your laptop. AWS charges for vector
imports/storage and temporary compute, EBS, and public IPv4; consult
[AWS pricing](https://aws.amazon.com/s3/pricing/) before sizing a deployment.
CourtListener describes the embeddings as approximately 2 TB, but that is not a
verified current byte count or a guarantee of completion time.

## 2. Prepare copies configured for your account

The checked-in files record the original account. Render deployment copies rather
than editing them or accidentally writing checkpoints to someone else's bucket:

```sh
mkdir -p build
python3 - <<'PY'
import os
from pathlib import Path
account = os.environ['MIRROR_ACCOUNT']
assert len(account) == 12 and account.isdigit(), 'Expected a 12-digit AWS account ID'
for name in ('import_vectors.py', 'bootstrap.sh', 'policy.json', 'trust.json'):
    text = Path(name).read_text().replace('547107369396', account)
    Path('build', name).write_text(text)
PY
bash -n build/bootstrap.sh
python3 -m py_compile build/import_vectors.py
```

[`bootstrap.sh`](bootstrap.sh) installs Python and pinned boto3 on Amazon Linux
2023, downloads the importer from the private state bucket, uploads logs, and
shuts down the instance after the importer exits. The launch command configures
shutdown to **terminate** the instance and delete its disk.

## 3. Create storage and the vector index

```sh
aws s3api create-bucket \
  --bucket "$MIRROR_STATE_BUCKET" \
  --create-bucket-configuration LocationConstraint=us-west-2
aws s3api put-public-access-block \
  --bucket "$MIRROR_STATE_BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3vectors create-vector-bucket --vector-bucket-name courtlistener
aws s3vectors create-index \
  --vector-bucket-name courtlistener \
  --index-name modernbert-768 \
  --data-type float32 \
  --dimension 768 \
  --distance-metric cosine \
  --metadata-configuration \
  '{"nonFilterableMetadataKeys":["text","source_key","source_etag","text_s3_key"]}'
```

The non-filterable metadata configuration matters: chunk text should not consume
S3 Vectors' smaller filterable-metadata allowance. The resulting vector index is
private; these commands do not grant public access.

Initialize the checkpoint **once, for a new import only**:

```sh
cat > build/checkpoint.json <<'JSON'
{"pages":0,"objects":0,"vectors":0,"source_bytes":0,"empty_objects":0,"overflow_chunks":0,"next_token":null}
JSON
aws s3api put-object --bucket "$MIRROR_STATE_BUCKET" \
  --key imports/modernbert-768/checkpoint.json --body build/checkpoint.json
aws s3 cp build/import_vectors.py "s3://$MIRROR_STATE_BUCKET/scripts/import_vectors.py"
aws s3 cp build/bootstrap.sh "s3://$MIRROR_STATE_BUCKET/scripts/bootstrap.sh"
```

Precreating the checkpoint also avoids a missing-object `403` for the worker:
its narrow role has `GetObject`, but does not have `ListBucket` on the state bucket.

## 4. Give the worker narrowly scoped access

```sh
aws iam create-role --role-name courtlistener-vector-import \
  --assume-role-policy-document file://build/trust.json
aws iam put-role-policy --role-name courtlistener-vector-import \
  --policy-name courtlistener-import --policy-document file://build/policy.json
aws iam create-instance-profile --instance-profile-name courtlistener-vector-import
aws iam add-role-to-instance-profile \
  --instance-profile-name courtlistener-vector-import \
  --role-name courtlistener-vector-import
```

The [policy](policy.json) allows `PutVectors` only on this index, reading this
state bucket, and writing its `imports/` and `chunks/` prefixes. Public source
reads use an unsigned S3 client. No personal credentials are embedded in user data.
The role cannot delete vectors and does not grant query access; give the eventual
search application its own read permissions (`QueryVectors`, `GetVectors`, and
`GetObject` for status/overflow text when needed).

## 5. Prove the conversion with one real opinion

This small check writes one genuine vector into the destination. The full import
will safely upsert the same key later.

```sh
uv venv --python 3.11 build/venv
uv pip install --python build/venv/bin/python 'boto3==1.43.93'
aws s3api get-object --no-sign-request \
  --bucket com-courtlistener-storage \
  --key embeddings/opinions/freelawproject/modernbert-embed-base_finetune_512/100.json \
  build/sample.json > build/sample-head.json
build/venv/bin/python - <<'PY'
import json, sys
from pathlib import Path
sys.path.insert(0, 'build')
from import_vectors import convert, PREFIX
sample = json.loads(Path('build/sample.json').read_text())
etag = json.loads(Path('build/sample-head.json').read_text())['ETag'].strip('"')
vectors, overflow = convert(sample, PREFIX + '100.json', etag)
assert vectors and not overflow
Path('build/put.json').write_text(json.dumps({
    'vectorBucketName': 'courtlistener', 'indexName': 'modernbert-768',
    'vectors': vectors,
}))
Path('build/query.json').write_text(json.dumps({
    'vectorBucketName': 'courtlistener', 'indexName': 'modernbert-768',
    'queryVector': vectors[0]['data'], 'topK': 1, 'returnDistance': True,
}))
print('Expected nearest key:', vectors[0]['key'])
PY
aws s3vectors put-vectors --cli-input-json file://build/put.json
aws s3vectors query-vectors --cli-input-json file://build/query.json
```

For the original sample, the nearest key was `100:1`, with cosine distance about
`0.00038`. Expect a near-zero distance, not exact equality: retrieval is approximate.
This checks the import/query path; it is not a completeness or relevance evaluation.

## 6. Launch the remote importer

Find a subnet with outbound internet access. The following uses an existing default
VPC. If it returns `None`, set `MIRROR_VPC` and `MIRROR_SUBNET` to an appropriate
existing VPC/subnet instead. The subnet needs a route to an internet gateway when
using the public IPv4 launch below. No inbound access is needed.

```sh
export MIRROR_VPC="$(aws ec2 describe-vpcs --filters Name=is-default,Values=true \
  --query 'Vpcs[0].VpcId' --output text)"
aws ec2 describe-subnets --filters "Name=vpc-id,Values=$MIRROR_VPC" \
  --query 'Subnets[].[SubnetId,AvailabilityZone,MapPublicIpOnLaunch]' --output table
# Set this from the preceding output:
export MIRROR_SUBNET='subnet-REPLACE-ME'
export MIRROR_SG="$(aws ec2 create-security-group \
  --group-name courtlistener-import --description 'CourtListener importer: outbound only' \
  --vpc-id "$MIRROR_VPC" --query GroupId --output text)"
export MIRROR_AMI="$(aws ssm get-parameter \
  --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query Parameter.Value --output text)"
```

The original account rejected `c7i.xlarge` as not Free Tier eligible. We successfully
used **`m7i-flex.large`**, with 2 vCPUs and 8 GiB RAM. Eligibility does not mean this
whole workflow is free. You can inspect currently eligible types with:

```sh
aws ec2 describe-instance-types --filters Name=free-tier-eligible,Values=true \
  --query 'InstanceTypes[].[InstanceType,VCpuInfo.DefaultVCpus,MemoryInfo.SizeInMiB]' \
  --output table
```

Launch exactly one worker for this checkpoint/index:

```sh
export MIRROR_LAUNCH_TOKEN="courtlistener-$(date -u +%Y%m%dT%H%M%SZ)"
aws ec2 run-instances \
  --image-id "$MIRROR_AMI" --instance-type m7i-flex.large --count 1 \
  --iam-instance-profile Name=courtlistener-vector-import \
  --network-interfaces \
  "DeviceIndex=0,SubnetId=$MIRROR_SUBNET,Groups=$MIRROR_SG,AssociatePublicIpAddress=true" \
  --metadata-options HttpTokens=required,HttpEndpoint=enabled \
  --instance-initiated-shutdown-behavior terminate \
  --block-device-mappings \
  '[{"DeviceName":"/dev/xvda","Ebs":{"VolumeSize":16,"VolumeType":"gp3","Encrypted":true,"DeleteOnTermination":true}}]' \
  --tag-specifications \
  'ResourceType=instance,Tags=[{Key=Name,Value=courtlistener-vector-import},{Key=project,Value=courtlistener}]' \
  'ResourceType=volume,Tags=[{Key=project,Value=courtlistener}]' \
  --user-data file://build/bootstrap.sh \
  --client-token "$MIRROR_LAUNCH_TOKEN" > build/launch.json
export MIRROR_INSTANCE="$(python3 -c 'import json; print(json.load(open("build/launch.json"))["Instances"][0]["InstanceId"])')"
printf '%s\n' "$MIRROR_INSTANCE"
```

If IAM propagation causes an instance-profile error, retry after propagation with
**the same launch token**. Reusing the token for the same request avoids accidental
duplicate launches. Use a new token only when intentionally launching a new worker.

## 7. Monitor progress and estimate duration

```sh
aws s3 cp "s3://$MIRROR_STATE_BUCKET/imports/modernbert-768/status.json" -
aws s3 cp "s3://$MIRROR_STATE_BUCKET/imports/modernbert-768/worker.log" -
aws ec2 describe-instances --instance-ids "$MIRROR_INSTANCE" \
  --query 'Reservations[0].Instances[0].State.Name'
```

Status and logs may be absent during initial boot/dependency installation. Use
`aws ec2 get-console-output --instance-id "$MIRROR_INSTANCE" --latest` to inspect
boot failures. The bootstrap uploads logs every minute after installation and on exit.

Status fields:

| Field | Meaning |
| --- | --- |
| `phase` | `running`, `complete`, `failed`, or `paused_runtime_limit` |
| `objects` | Source opinion JSON objects in committed pages |
| `vectors` | Chunk vectors in committed pages; not an independent index count |
| `source_bytes` | Source JSON bytes read for committed pages |
| `pages` | Fully committed listing pages |
| `updated_at` | Unix timestamp of this status |
| `elapsed_seconds` | Elapsed time in the current worker process |
| `next_token` | S3 listing continuation token for resume |
| `error` | Exception traceback when the importer reports failure |

Use two samples to measure `Δsource_bytes / Δtime` or `Δvectors / Δtime`.
Do not divide lifetime counts by `elapsed_seconds` after a resume: counts persist,
but elapsed time resets. Only estimate remaining time when you have a defensible
source total. The first 101 seconds of our run imported 1.17 GB / 61,732 vectors
(about 11.6 MB/s). The resulting ~48-hour estimate assumed 2 TB and was **not** a
completion promise or a sustained-throughput benchmark.

The source's inventory prefix is
`embeddings/inventories/com-courtlistener-storage/embeddings/`. Listing it worked
in our run, but reading the latest `manifest.json` anonymously returned `403`, so
we did not establish an exact source total from that inventory.

## How batching and resume work

- 48 threads fetch public JSON objects; eight threads write vector batches.
- Batches contain at most 200 vectors and target at most 16 MiB of serialized
  vector data, leaving headroom below AWS's 20 MiB request limit.
- A shared scheduler targets at most 2,000 vectors/second, below the documented
  2,500 vectors/second per-index mutation limit. boto3 retries transient failures.
- Each S3 listing page contains up to 1,000 objects. The checkpoint advances only
  after every vector batch for that page succeeds.
- An interrupted page is replayed on resume. Stable keys make those writes upserts;
  they do not create a second copy of the same chunk. Replays may incur write charges.
- `IfMatch` checks the listed source ETag before download. Invalid dimensions,
  non-finite/zero vectors, duplicate chunk numbers, or exhausted retries fail the job;
  they are not silently skipped.

Run **one worker per checkpoint**. The checkpoint is not a distributed lock;
starting multiple workers with it can overwrite progress and exceed the intended
combined write rate. Parallel shards would need independent checkpoints and a
shared per-index rate budget; that was not implemented here.

The source is a live listing, not an atomic snapshot. Changes behind the current
cursor are not discovered again. A changed opinion with fewer chunks can leave
old chunk keys if an interrupted page is replayed; there is no deletion reconciliation.
Preserved source keys and ETags provide provenance, not a frozen corpus guarantee.

## Completion, interruption, and resuming

`phase: complete` with `complete: true` means the importer reached the end of its
source traversal after committing all pages. It does not establish that the public
source itself covers all case law. Check the final checkpoint and test retrieval
before treating your copy as ready for its intended use.

The importer checks a **46-hour** runtime limit between pages, saves progress,
and exits with `phase: paused_runtime_limit` when that limit is reached. Independently,
a bootstrap timer requests shutdown at **48 hours**. Both rely on the instance
shutdown behavior configured above. A hard shutdown can leave the last page unfinished
and the latest status still saying `running`; check instance state and status freshness.

To stop it deliberately, preserving storage and checkpoints:

```sh
aws ec2 terminate-instances --instance-ids "$MIRROR_INSTANCE"
```

To resume:

1. Ensure the previous worker is terminated, so there is only one writer.
2. Inspect `status.json` and `worker.log`; fix any reported input or configuration error.
3. Keep the existing vector index, state bucket, and checkpoint. **Do not rerun
   checkpoint initialization.** Keep the same source prefix and index configuration.
4. Repeat only the launch command from step 6 with a fresh launch token. Save its
   new instance ID. It loads the checkpoint and replays at most the unfinished page.

A completed checkpoint makes a new worker exit; restarting is not an incremental
sync. To intentionally refresh the entire source, use a new index and state prefix
with matching configuration rather than resetting a live deployment's checkpoint.

## Search while importing

Committed vectors can be queried while the worker continues to write. Results
cover only the imported portion, and the listing order is by object key, not a
representative sample of courts or dates.

Use exactly `freelawproject/modernbert-embed-base_finetune_512` to embed natural-language
queries with the `search_query: ` prefix, the model's mean pooling, and normalization.
Another model with 768 dimensions will not produce compatible query vectors.
Our local search client pins revision `04f0141fbc045122439d28d51ba670f3091e9ed8`.
Re-embedding the sample's text with the `search_document: ` prefix matched its
published vector at cosine similarity **0.9999991**.

The adjacent legal agent's [single-file MCP](../../legal/.agents/plugins/mcp/caselaw.ts)
uses DI Framework's `S3VectorStore` with an explicitly supplied AWS client. DI's
default S3 client is in-memory, so omitting that client would not search AWS.
AWS cosine **distance** is converted to DI similarity as `1 - distance`.
The MCP exposes semantic search, chunk retrieval, and live import coverage; see
[the legal agent setup](../../legal/README.md#courtlistener-search).
That client currently names the original deployment's state bucket; change its
`STATE_BUCKET` constant for a deployment in another account.

## Cleanup

The bootstrap terminates the instance and its EBS volume, but deliberately retains
the vector index, state bucket, IAM role/profile, and security group.

After confirming that the worker has terminated, remove the provisioning-only
resources if you will not resume. Set `MIRROR_SG` to this deployment's group ID:

```sh
aws iam remove-role-from-instance-profile \
  --instance-profile-name courtlistener-vector-import --role-name courtlistener-vector-import
aws iam delete-instance-profile --instance-profile-name courtlistener-vector-import
aws iam delete-role-policy --role-name courtlistener-vector-import --policy-name courtlistener-import
aws iam delete-role --role-name courtlistener-vector-import
aws ec2 delete-security-group --group-id "$MIRROR_SG"
```

For **complete deletion**, the following destroys the imported vectors and all
checkpoint/log/overflow-text objects. Run it only when you no longer need this copy:

```sh
aws s3vectors delete-index --vector-bucket-name courtlistener --index-name modernbert-768
aws s3vectors delete-vector-bucket --vector-bucket-name courtlistener
aws s3 rb "s3://$MIRROR_STATE_BUCKET" --force
```

## Original deployment

For identifying the already-running deployment, not values to paste into a new account:

| Resource | Value |
| --- | --- |
| Account / region | `547107369396` / `us-west-2` |
| Vector bucket / index | `courtlistener` / `modernbert-768` |
| Index ARN | `arn:aws:s3vectors:us-west-2:547107369396:bucket/courtlistener/index/modernbert-768` |
| State bucket | `courtlistener-import-547107369396-us-west-2` |
| Initial worker | `i-0d27ee163b7a1ca3e`, `m7i-flex.large` |
| AMI used | `ami-03db3415e6524c5d2` |
| Role / instance profile | `courtlistener-vector-import` |
| Security group | `sg-019ea2044b040708d` |

The importer was observed committing pages and serving queries. No full-corpus
completion was established when this guide was written. A real query through the
DI Framework MCP returned relevant chunks in about 4.7 seconds while import continued.

## References

- [CourtListener bulk data and embedding format](https://wiki.free.law/c/courtlistener/help/api/bulk-data/bulk-legal-data)
- [S3 Vectors limits](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-limitations.html)
- [S3 Vectors overview](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors.html)
- [Free Law Project model and query-prefix examples](https://huggingface.co/freelawproject/modernbert-embed-base_finetune_512)
