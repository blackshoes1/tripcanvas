"""Package narration drafts, provisional voice samples and their checks."""
from pathlib import Path
import ast
import hashlib
import json
import zipfile

work = Path(__file__).resolve().parent
root = work.parent
draft = work / "narration-v3-draft"
voice = work / "voice-v3"
info = json.loads((voice / "voice-v3-info.json").read_text(encoding="utf-8"))
qa = json.loads((voice / "voice-v3-asr-check.json").read_text(encoding="utf-8"))
assert len(qa["files"]) == 2
assert len(list(draft.glob("[0-9][0-9]_narration.txt"))) == 14
for generated, checked in zip(info["variants"], qa["files"]):
    assert generated["file"] == checked["file"]
    assert abs(generated["seconds"] - checked["seconds"]) < 0.01
    assert hashlib.sha256((voice / generated["file"]).read_bytes()).hexdigest() == generated["sha256"]

scripts = ["generate_voice_v3.py", "check_voice_v3.py", "package_review_v3.py"]
for name in scripts:
    ast.parse((work / name).read_text(encoding="utf-8"))

target = work / "seville-audio-v3-review.zip"
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as package:
    for folder in [draft, voice]:
        for path in sorted(folder.iterdir()):
            if path.is_file():
                package.write(path, folder.name + "/" + path.name)
    for name in scripts:
        package.write(work / name, "tools/" + name)
    for name in ["guide-data-14-stops.json", "sources.json"]:
        package.write(root / name, "reference/" + name)
with zipfile.ZipFile(target) as package:
    assert package.testzip() is None
    count = len(package.namelist())
print(json.dumps({
    "package": str(target), "files": count, "bytes": target.stat().st_size,
    "voice_seconds": {v["id"]: round(v["seconds"], 2) for v in info["variants"]},
}, ensure_ascii=False))
