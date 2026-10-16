"""Produce two provisional readings of the same passage using an existing local model.

This does not change the guide or approve a voice. Model/dependencies are not bundled.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import wave
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("NUMBA_DISABLE_JIT", "1")
os.environ.setdefault("NUMBA_CACHE_DIR", str(Path(os.environ.get("TEMP", ".")) / "seville-voice-v3-numba"))
Path(os.environ["NUMBA_CACHE_DIR"]).mkdir(parents=True, exist_ok=True)
if os.environ.get("SEVILLE_EXTRA_LIBS"):
    sys.path.insert(0, os.environ["SEVILLE_EXTRA_LIBS"])

import numpy as np
import torch
import lameenc
from qwen_tts import Qwen3TTSModel


PASSAGES = [
    "금빛 제단에서 조각 한 칸을 골라 보세요. 인물들이 누구를 향해 손을 뻗고 있나요? "
    "이 제단은 나무로 만든 조각에 색과 금박을 입힌 작품이에요. "
    "천사백팔십이 년에 시작해서, 천오백육십사 년에 완성됐어요. 팔십이 년에 걸친 작업이에요.",
    "처음 설계한 사람이 끝까지 만든 게 아니라, 다음 세대의 장인들이 일을 이어받았어요. "
    "이제 아래쪽 중앙의 성모상을 찾아보세요. "
    "멀리서는 한 장의 금빛 벽처럼 보여도, 가까이 보면 서로 다른 장면이 모인 이야기예요.",
]

STYLES = [
    {
        "id": "A",
        "name": "차분한 해설",
        "instruct": "한국인 박물관 도슨트가 성인 관람객에게 작품을 설명한다. "
        "편안한 중저음과 정확한 한국어 발음. 보통 속도로 차분하게 말한다. "
        "한 단어씩 끊지 말고 문장의 의미 단위로 이어 말한다. "
        "연도는 서두르지 않고, 팔십이 년이라는 기간 뒤에 잠시 여유를 둔다. "
        "뉴스 앵커나 광고처럼 읽지 않는다. 감탄이나 웃음, 속삭임 없이 절제한다.",
    },
    {
        "id": "B",
        "name": "대화하듯 설명",
        "instruct": "한국인 여성 도슨트가 바로 옆의 성인 두 명과 작품을 함께 보며 이야기한다. "
        "친근하고 자연스러운 해요체, 편안한 낮은 목소리. "
        "설명문을 읽는 느낌이 아니라 눈앞의 작품을 가리키며 말하는 느낌. "
        "질문은 가볍게 묻고, 정보는 또렷하게 전한다. 문장마다 같은 억양을 반복하지 않는다. "
        "과장된 감탄, 애교, 웃음, 광고 말투는 쓰지 않는다. 충분히 알아들을 수 있는 보통 속도.",
    },
]


def encode_mp3(path: Path, audio: np.ndarray, rate: int) -> None:
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(128)
    encoder.set_in_sample_rate(rate)
    encoder.set_channels(1)
    encoder.set_quality(2)
    path.write_bytes(encoder.encode(pcm) + encoder.flush())


def trim_outer_silence(audio: np.ndarray, rate: int) -> np.ndarray:
    # Keep internal pauses intact. Retain a 120 ms margin around audible frames.
    frame = max(1, int(rate * 0.02))
    energy = np.array([
        np.sqrt(np.mean(audio[i:i + frame] ** 2))
        for i in range(0, len(audio), frame)
    ])
    audible = np.flatnonzero(energy > 0.002)
    if not len(audible):
        raise ValueError("Generated passage is silent")
    margin = int(rate * 0.12)
    start = max(0, int(audible[0]) * frame - margin)
    end = min(len(audio), (int(audible[-1]) + 1) * frame + margin)
    return audio[start:end]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--device", default="cuda:0")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(4)
    print("LOADING_MODEL", flush=True)
    started = time.monotonic()
    model = Qwen3TTSModel.from_pretrained(
        str(args.model), device_map=args.device,
        dtype=torch.bfloat16 if args.device.startswith("cuda") else torch.float32,
        attn_implementation="sdpa", local_files_only=True,
    )
    print("MODEL_READY", round(time.monotonic() - started, 2), flush=True)
    records = []
    variants = []
    sample_rate = None
    for style in STYLES:
        chunks = []
        passages = []
        for index, text in enumerate(PASSAGES):
            print("GENERATING", style["id"], index + 1, flush=True)
            torch.manual_seed(108 + index)
            began = time.monotonic()
            with torch.inference_mode():
                wavs, rate = model.generate_custom_voice(
                    text=text, language="Korean", speaker="Sohee",
                    instruct=style["instruct"], max_new_tokens=850,
                    temperature=0.8, top_p=0.95,
                    subtalker_temperature=0.8,
                )
            if sample_rate is not None and rate != sample_rate:
                raise ValueError("Sample rate changed during generation")
            sample_rate = rate
            audio = np.asarray(wavs[0], dtype=np.float32)
            if not np.all(np.isfinite(audio)) or len(audio) < rate * 3:
                raise ValueError("Invalid or truncated audio")
            audio = trim_outer_silence(audio, rate)
            passages.append({"text": text, "seconds": len(audio) / rate})
            chunks.append(audio)
            if index + 1 < len(PASSAGES):
                chunks.append(np.zeros(int(rate * 0.6), dtype=np.float32))
            print("PASSAGE_READY", style["id"], index + 1,
                  round(len(audio) / rate, 2), round(time.monotonic() - began, 2), flush=True)
        audio = np.concatenate(chunks)
        peak = float(np.max(np.abs(audio)))
        rms = float(np.sqrt(np.mean(audio ** 2)))
        gain = min(0.92 / max(peak, 1e-8), 0.09 / max(rms, 1e-8))
        audio = audio * gain
        stem = "seville-voice-v3-" + style["id"]
        wav_path = args.output / (stem + ".wav")
        with wave.open(str(wav_path), "wb") as file:
            file.setnchannels(1)
            file.setsampwidth(2)
            file.setframerate(sample_rate)
            file.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
        mp3_path = args.output / (stem + ".mp3")
        encode_mp3(mp3_path, audio, sample_rate)
        records.append({
            **style, "file": mp3_path.name, "seconds": len(audio) / sample_rate,
            "sample_rate": sample_rate, "peak": float(np.max(np.abs(audio))),
            "rms": float(np.sqrt(np.mean(audio ** 2))),
            "sha256": hashlib.sha256(mp3_path.read_bytes()).hexdigest(),
            "passages": passages, "paragraph_pause_seconds": 0.6,
            "status": "USER_LISTENING_REQUIRED",
        })
        variants.append(audio)
        print("VARIANT_READY", mp3_path.name, flush=True)
    comparison = np.concatenate([
        variants[0], np.zeros(int(sample_rate * 1.5), dtype=np.float32), variants[1],
    ])
    encode_mp3(args.output / "seville-voice-v3-comparison.mp3", comparison, sample_rate)
    manifest = {
        "model": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice", "speaker": "Sohee",
        "revision": "0c0e3051f131929182e2c023b9537f8b1c68adfe",
        "script": "\n\n".join(PASSAGES), "variants": records,
        "comparison_order": ["A", "1.5 second silence", "B"],
        "postprocessing": "outer silence trim, same 600ms paragraph pause, gain normalization; no time or pitch changes",
        "perceptual_quality_verified": False,
        "elapsed_seconds": time.monotonic() - started,
    }
    (args.output / "voice-v3-info.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    (args.output / "sample-narration.txt").write_text(manifest["script"] + "\n", encoding="utf-8")
    print("DONE", json.dumps(records, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    main()
