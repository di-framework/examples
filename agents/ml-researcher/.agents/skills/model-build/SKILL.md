---
name: model-build
description: Turn a natural-language task into a bounded local ONNX model build, from a small numeric MLP or a compatible pretrained model, with independent validation and held-out evaluation.
---

Clarify task, available dataset, feature order or tokenization, outputs, deployment constraints, and acceptance metric. Do not silently supply fictitious domain data. Save the resulting specification and call BuildModel.

Supported templates:

- Numeric classification: JSONL rows {id, features: number[], label: classIndex}. Binary graphs use one logit; multiclass graphs use one logit per class. Target accuracy is in [0,1].
- Scalar regression: the same row schema, with a finite numeric label and one output. Target mean squared error is nonnegative.
- Embedding adaptation: pretrained ONNX with JSONL rows {id, input_ids: number[], positive: number[]}. Each token array must have the specified inputSize; this template does not pad. The graph must expose the named token input, optionally attention_mask/token_type_ids, and one compatible float output. Choose mean, cls, last-token, or none pooling to match the graph. Preserve the tokenizer and record its revision. Target recallAt1 is in [0,1], measured against other held-out positives.

Provide datasetPath and datasetRevision; pretrained sources also need path and revision. Paths must be inside a configured readable root. A copied file's content hash is recorded in addition to the declared revision. Use a fresh descriptive model name once per experiment; existing builds cannot be overwritten. inputName/outputName are exact ONNX names.

New MLPs have at most four hidden layers and one million parameters. Use logits for classification, values for regression, and embedding for embedding outputs. Set standardize=true only when training-only fitted numeric normalization is appropriate. Provide maxSteps, batchSize, up to three learningRates, seed, budgetSeconds, and target {metric,value}. Optional trainable patterns must match actual f32 weights; inspect the graph first when adapting a model.

BuildModel groups exact duplicate inputs and makes a deterministic train/validation/test split. This is insufficient for time series, patient/user groups, or near-duplicates: explain the limitation and implement a task-specific evaluation before claiming deployment quality. Do not vary seeds or candidate definitions after seeing held-out results.

The builder compares validation scores, selects one candidate, then measures it on the held-out split once. A target-unmet report is a valid experimental result, not a successful model-quality claim. Report baseline, selected validation score, held-out score, target, hashes, model artifact, inference example, and limitations. Do not describe compilation or a synthetic fixture as evidence of domain performance.
