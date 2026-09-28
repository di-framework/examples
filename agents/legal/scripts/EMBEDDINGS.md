# CourtListener ONNX bundle

Source: [Free Law Project ModernBERT](https://huggingface.co/freelawproject/modernbert-embed-base_finetune_512/tree/04f0141fbc045122439d28d51ba670f3091e9ed8),
revision `04f0141fbc045122439d28d51ba670f3091e9ed8`. The publisher's model card
declares `cc0-1.0` and names `nomic-ai/modernbert-embed-base` as the base model.

`bun run embeddings:prepare` uses `uv` and the versions declared in
`export-embeddings.py` to load the pinned Sentence Transformers model on CPU,
generate reference vectors, and export its transformer as ONNX opset 17 with f32
weights. The export selects eager attention and disables compilation; there is no
training or quantization. Input names are `input_ids` and `attention_mask` (int64),
and output is `last_hidden_state` (float32, `[batch, sequence, 768]`).

The TypeScript adapter owns tokenization, Python-compatible whitespace stripping,
right truncation at 8,192 tokens preserving `[SEP]`, masked mean pooling including
special/prefix tokens, and L2 normalization. The runtime tokenizer is
`@huggingface/tokenizers`; forward inference is exclusively `@di-framework/ml`.

The export manifest records model identity, runtime settings, exporter versions,
and SHA-256 hashes of the graph, tokenizer files, and reference fixtures.
`verify-embeddings.ts` requires identical token IDs, cosine similarity at least
0.99999, maximum per-component error at most 0.0001, unit length, and identical
fixture retrieval rankings. It also checks padded inference against an unpadded
Python reference. Only a successful check writes `verified.json`, bound to the
manifest's hash. The loader checks the verification record and file hashes before
creating a session.

Fixtures include legal citations, Unicode, special-token strings, whitespace,
short queries, a query longer than ModernBERT's local attention window, and a
1,756-token query. These checks establish numerical compatibility on those
inputs; the fixture ranking check uses four local reference documents and does
not require AWS. It does not measure legal relevance or corpus completeness.

The generated graph and tokenizer files are intentionally absent from Git.
Regenerate the bundle in each checkout, or copy the complete verified bundle to
`agents/legal/.cache/courtlistener-onnx/`. Query execution needs Bun and the
installed JavaScript dependencies; it does not need `uv` or Python.
