# /// script
# requires-python = "==3.11.*"
# dependencies = [
#   "torch==2.14.0", "sentence-transformers==5.1.2", "transformers==4.57.6",
#   "onnx==1.20.1",
# ]
# ///
"""One-time export of the exact CourtListener query model; no training."""
import hashlib
import json
from pathlib import Path

import onnx
import torch
from sentence_transformers import SentenceTransformer

MODEL = "freelawproject/modernbert-embed-base_finetune_512"
REVISION = "04f0141fbc045122439d28d51ba670f3091e9ed8"
DEST = Path(__file__).resolve().parents[1] / ".cache" / "courtlistener-onnx"


class Encoder(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, input_ids, attention_mask):
        return self.model(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    # A failed re-export must not leave an old verification marker usable.
    (DEST / "verified.json").unlink(missing_ok=True)
    torch.set_num_threads(4)
    reference = SentenceTransformer(MODEL, revision=REVISION, trust_remote_code=False, device="cpu")
    assert reference.max_seq_length == 8192
    assert reference[1].pooling_mode_mean_tokens and reference[1].include_prompt
    reference.tokenizer.save_pretrained(DEST)

    queries = [
        "jurisdiction",
        "When does a state court have personal jurisdiction over an out-of-state defendant?",
        "Fourth Amendment warrantless search of a vehicle and probable cause",
        "42 U.S.C. § 1983 — qualified immunity; O’Connor v. Donaldson, 422 U.S. 563 (1975)",
        "café naïve résumé 法律 ⚖️ $(literal) `quoted` [SEP] [MASK]",
        " ",
        "due process\u0085",
        "due process\ufeff",
        "due process " * 80,
        "§⚖️" * 250,
    ]
    documents = [
        "A state court may exercise personal jurisdiction when the defendant has sufficient minimum contacts with the forum.",
        "The automobile exception permits a warrantless vehicle search supported by probable cause.",
        "Qualified immunity protects officials unless their conduct violates clearly established constitutional rights.",
        "Banana bread is baked with flour, ripe bananas, and sugar.",
    ]
    rows = []
    for kind, texts in [("query", queries), ("document", documents)]:
        for text in texts:
            prefixed = ("search_query: " if kind == "query" else "search_document: ") + text
            tokens = reference.tokenize([prefixed])
            vector = reference.encode(prefixed, normalize_embeddings=True, show_progress_bar=False)
            rows.append({"kind": kind, "text": text, "ids": tokens["input_ids"][0].tolist(), "vector": vector.tolist()})
    (DEST / "reference.json").write_text(json.dumps(rows))

    encoder = Encoder(reference[0].auto_model).eval()
    # This transformers version selects ModernBERT's attention through this config field.
    encoder.model.config._attn_implementation = "eager"
    encoder.model.config.reference_compile = False
    sample = reference.tokenizer("search_query: jurisdiction", return_tensors="pt")
    print("Exporting pinned ModernBERT to ONNX...", flush=True)
    with torch.no_grad():
        torch.onnx.export(
            encoder, (sample["input_ids"], sample["attention_mask"]), str(DEST / "model.onnx"),
            input_names=["input_ids", "attention_mask"], output_names=["last_hidden_state"],
            dynamic_axes={"input_ids": {0: "batch", 1: "sequence"}, "attention_mask": {0: "batch", 1: "sequence"},
                          "last_hidden_state": {0: "batch", 1: "sequence"}},
            opset_version=17, dynamo=False, external_data=False,
        )
    onnx.checker.check_model(str(DEST / "model.onnx"))
    files = ["model.onnx", "tokenizer.json", "tokenizer_config.json", "reference.json"]
    manifest = {
        "model": MODEL, "revision": REVISION, "dimensions": 768, "maxLength": reference.max_seq_length,
        "pooling": "masked-mean", "normalize": True, "queryPrefix": "search_query: ",
        "sha256": {name: hashlib.file_digest((DEST / name).open("rb"), "sha256").hexdigest() for name in files},
        "export": {"torch": torch.__version__, "transformers": "4.57.6", "sentenceTransformers": "5.1.2", "opset": 17},
    }
    (DEST / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Exported to {DEST}. Run the TypeScript parity check before use.", flush=True)


if __name__ == "__main__":
    main()
