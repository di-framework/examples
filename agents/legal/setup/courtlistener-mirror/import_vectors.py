"""Resumable CourtListener JSON -> S3 Vectors import; runs on EC2 in us-west-2."""
import concurrent.futures as cf
import json
import math
import os
import threading
import time
import traceback

import boto3
from botocore import UNSIGNED
from botocore.config import Config
from botocore.exceptions import ClientError

REGION = "us-west-2"
SOURCE = "com-courtlistener-storage"
PREFIX = "embeddings/opinions/freelawproject/modernbert-embed-base_finetune_512/"
BUCKET = "courtlistener"
INDEX = "modernbert-768"
STATE_BUCKET = "courtlistener-import-547107369396-us-west-2"
RUN = "imports/modernbert-768"
CONFIG = Config(region_name=REGION, max_pool_connections=64,
                retries={"mode": "standard", "total_max_attempts": 12},
                connect_timeout=10, read_timeout=90)


def convert(document, source_key, etag):
    opinion_id = str(document["id"])
    if source_key != PREFIX + opinion_id + ".json":
        raise ValueError(f"Opinion ID does not match source key: {source_key}")
    result, overflow, seen = [], {}, set()
    for chunk in document["embeddings"]:
        number = int(chunk["chunk_number"])
        if number in seen:
            raise ValueError(f"Duplicate chunk number: {source_key}:{number}")
        seen.add(number)
        vector = chunk["embedding"]
        if len(vector) != 768 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in vector):
            raise ValueError(f"Invalid vector: {source_key}:{number}")
        if not any(vector):
            raise ValueError(f"Zero cosine vector: {source_key}:{number}")
        text = chunk["chunk"]
        if not isinstance(text, str):
            raise ValueError("Chunk text must be a string")
        metadata = {"opinion_id": opinion_id, "chunk_number": number,
                    "source_key": source_key, "source_etag": etag, "text": text}
        # Keep the full text, with an object pointer if it exceeds vector metadata limits.
        if len(json.dumps(metadata, ensure_ascii=False).encode()) > 38000:
            text_key = f"chunks/{opinion_id}/{number}.txt"
            overflow[text_key] = text.encode()
            del metadata["text"]
            metadata["text_s3_key"] = text_key
        result.append({"key": f"{opinion_id}:{number}",
                       "data": {"float32": vector}, "metadata": metadata})
    return result, overflow


def main():
    session = boto3.Session(region_name=REGION)
    source = session.client("s3", config=CONFIG.merge(Config(signature_version=UNSIGNED)))
    state_s3 = session.client("s3", config=CONFIG)
    vectors = session.client("s3vectors", config=CONFIG)
    start = time.time()

    def save(name, value):
        state_s3.put_object(Bucket=STATE_BUCKET, Key=f"{RUN}/{name}.json",
                            Body=json.dumps(value).encode(), ContentType="application/json")

    checkpoint = {"pages": 0, "objects": 0, "vectors": 0, "source_bytes": 0,
                  "empty_objects": 0, "overflow_chunks": 0, "next_token": None}
    try:
        checkpoint = json.loads(state_s3.get_object(
            Bucket=STATE_BUCKET, Key=f"{RUN}/checkpoint.json")["Body"].read())
    except ClientError as error:
        if error.response["Error"]["Code"] != "NoSuchKey":
            raise
    if checkpoint.get("complete"):
        print("Import already complete", flush=True)
        return

    def status(phase, **extra):
        value = {**checkpoint, "phase": phase, "updated_at": time.time(),
                 "elapsed_seconds": round(time.time() - start), **extra}
        save("status", value)
        print(json.dumps(value), flush=True)

    def fetch(item):
        body = source.get_object(Bucket=SOURCE, Key=item["Key"], IfMatch=item["ETag"])["Body"]
        try:
            raw = body.read()
        finally:
            body.close()
        document = json.loads(raw)
        converted, overflow = convert(document, item["Key"], item["ETag"].strip('"'))
        for key, text in overflow.items():
            state_s3.put_object(Bucket=STATE_BUCKET, Key=key, Body=text,
                                ContentType="text/plain; charset=utf-8")
        return converted, len(raw), len(overflow)

    rate_lock = threading.Lock()
    next_write = [time.monotonic()]

    def put(batch):
        # Stay below the per-index 2,500 vectors/sec limit, shared by all writers.
        with rate_lock:
            now = time.monotonic()
            scheduled = max(now, next_write[0])
            next_write[0] = scheduled + len(batch) / 2000
        time.sleep(max(0, scheduled - time.monotonic()))
        vectors.put_vectors(vectorBucketName=BUCKET, indexName=INDEX, vectors=batch)

    try:
        status("running")
        with cf.ThreadPoolExecutor(max_workers=48) as readers, cf.ThreadPoolExecutor(max_workers=8) as writers:
            while True:
                args = {"Bucket": SOURCE, "Prefix": PREFIX, "MaxKeys": 1000}
                if checkpoint["next_token"]:
                    args["ContinuationToken"] = checkpoint["next_token"]
                page = source.list_objects_v2(**args)
                items = [item for item in page.get("Contents", []) if item["Key"].endswith(".json")]
                counts = {"objects": 0, "vectors": 0, "source_bytes": 0,
                          "empty_objects": 0, "overflow_chunks": 0}
                batch, pending, batch_bytes = [], [], 0
                for converted, byte_count, overflow_count in readers.map(fetch, items):
                    counts["objects"] += 1
                    counts["vectors"] += len(converted)
                    counts["source_bytes"] += byte_count
                    counts["empty_objects"] += not converted
                    counts["overflow_chunks"] += overflow_count
                    for vector in converted:
                        vector_bytes = len(json.dumps(vector).encode()) + 2
                        if batch and batch_bytes + vector_bytes > 16 * 1024 * 1024:
                            pending.append(writers.submit(put, batch))
                            batch, batch_bytes = [], 0
                            if len(pending) >= 8:
                                pending.pop(0).result()
                        batch.append(vector)
                        batch_bytes += vector_bytes
                        if len(batch) == 200:
                            pending.append(writers.submit(put, batch))
                            batch, batch_bytes = [], 0
                            if len(pending) >= 8:
                                pending.pop(0).result()
                if batch:
                    pending.append(writers.submit(put, batch))
                for future in pending:
                    future.result()
                # Advance only after every vector in this source page is committed.
                # Repeating a page after a crash safely upserts the same stable keys.
                for key, count in counts.items():
                    checkpoint[key] += count
                checkpoint["pages"] += 1
                checkpoint["next_token"] = page.get("NextContinuationToken")
                checkpoint["last_source_key"] = items[-1]["Key"] if items else None
                checkpoint["complete"] = not page.get("IsTruncated", False)
                save("checkpoint", checkpoint)
                status("complete" if checkpoint["complete"] else "running")
                if checkpoint["complete"]:
                    return
                if time.time() - start > float(os.getenv("MAX_SECONDS", "165600")):
                    status("paused_runtime_limit")
                    return
    except BaseException:
        status("failed", error=traceback.format_exc())
        raise


if __name__ == "__main__":
    main()
