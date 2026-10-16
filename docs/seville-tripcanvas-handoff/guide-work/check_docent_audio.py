from pathlib import Path
import json, re, shutil
import numpy as np
import torch
import soundfile as sf
import soxr
from transformers import WhisperProcessor, WhisperForConditionalGeneration

root=Path(__file__).resolve().parent
folder=root.parent/'seville-guide/voice-samples'
source=folder/'seville-docent-qwen.mp3'
target=folder/'seville-docent-voice.mp3'
shutil.copyfile(source,target)
audio,sr=sf.read(target,dtype='float32')
audio=soxr.resample(audio,sr,16000)
processor=WhisperProcessor.from_pretrained(str(root/'qwen-voice/asr'),local_files_only=True)
model=WhisperForConditionalGeneration.from_pretrained(str(root/'qwen-voice/asr'),local_files_only=True).to('cuda')
features=processor(audio,sampling_rate=16000,return_tensors='pt').input_features.to('cuda')
with torch.inference_mode():
    ids=model.generate(features,language='ko',task='transcribe',max_new_tokens=400,do_sample=False)
text=processor.batch_decode(ids,skip_special_tokens=True)[0]
record={'file':str(target),'seconds':len(audio)/16000,'transcription':text,'peak':float(np.max(np.abs(audio))),'rms':float(np.sqrt(np.mean(audio**2)))}
(root/'qa/qwen-audio-check.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(record,ensure_ascii=True))
