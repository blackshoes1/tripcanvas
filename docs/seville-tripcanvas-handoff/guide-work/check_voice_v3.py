"""Measure samples and obtain provisional local ASR transcripts; never approve a voice."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("NUMBA_DISABLE_JIT", "1")
os.environ.setdefault("NUMBA_CACHE_DIR", str(Path(os.environ.get("TEMP", ".")) / "seville-voice-v3-numba"))
Path(os.environ["NUMBA_CACHE_DIR"]).mkdir(parents=True, exist_ok=True)

import numpy as np
import soundfile as sf
import soxr
import torch
from transformers import WhisperProcessor, WhisperForConditionalGeneration


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--asr-model", type=Path, required=True)
    parser.add_argument("--folder", type=Path, required=True)
    args = parser.parse_args()
    torch.set_num_threads(4)
    processor = WhisperProcessor.from_pretrained(str(args.asr_model), local_files_only=True)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = WhisperForConditionalGeneration.from_pretrained(
        str(args.asr_model), local_files_only=True,
    ).to(device)
    records = []
    manifest = json.loads((args.folder / "voice-v3-info.json").read_text(encoding="utf-8"))
    for name in ["seville-voice-v3-A.wav", "seville-voice-v3-B.wav"]:
        path = args.folder / name
        audio, rate = sf.read(path, dtype="float32")
        assert audio.ndim == 1 and np.isfinite(audio).all()
        texts = []
        resampled = soxr.resample(audio, rate, 16000)
        meta = next(v for v in manifest["variants"] if v["file"] == path.with_suffix(".mp3").name)
        windows = []
        if meta.get("passages"):
            cursor = 0.0
            for passage in meta["passages"]:
                windows.append((cursor, cursor + passage["seconds"]))
                cursor += passage["seconds"] + meta["paragraph_pause_seconds"]
        else:
            windows = [(max(0, start - 1), start + 25) for start in range(0, int(len(resampled) / 16000) + 1, 24)]
        for start, end in windows:
            segment = resampled[round(start * 16000):round(end * 16000)]
            if len(segment) < 16000:
                continue
            features = processor(segment, sampling_rate=16000, return_tensors="pt", return_attention_mask=True).to(device)
            with torch.inference_mode():
                ids = model.generate(
                    features.input_features, attention_mask=features.attention_mask,
                    language="ko", task="transcribe", max_new_tokens=300,
                    do_sample=False,
                )
            texts.append({
                "from_seconds": start,
                "text": processor.batch_decode(ids, skip_special_tokens=True)[0].strip(),
            })
        record = {
            "file": path.with_suffix(".mp3").name,
            "seconds": len(audio) / rate,
            "peak": float(np.max(np.abs(audio))),
            "rms": float(np.sqrt(np.mean(audio ** 2))),
            "clipped_samples": int(np.count_nonzero(np.abs(audio) >= 0.9999)),
            "transcript_windows": texts,
        }
        records.append(record)
        print(json.dumps(record, ensure_ascii=True), flush=True)
    (args.folder / "voice-v3-asr-check.json").write_text(json.dumps({
        "status": "AUTOMATED_CHECK_ONLY_USER_LISTENING_REQUIRED",
        "note": "ASR can misrecognize correct Korean. Overlapping windows can repeat words. This is not a perceptual-quality pass.",
        "files": records,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
