from pathlib import Path
import sys, json, time, wave
import numpy as np
import torch

root=Path(__file__).resolve().parent
sys.path.insert(0,str(root/'voice-libs'))
from qwen_tts import Qwen3TTSModel
import lameenc

output=root.parent/'seville-guide/voice-samples'
output.mkdir(parents=True,exist_ok=True)
text='이제 금빛 제단을 천천히 올려다보세요. 이걸 만드는 데 얼마나 걸렸을까요? 천사백팔십이년에 시작해, 천오백육십사년에 끝났습니다. 여든두 해죠. 한 사람의 작품이 아니라, 여러 세대의 장인들이 이어 만든 겁니다. 금빛 벽처럼 보이는 표면을 자세히 보면, 작은 칸마다 서로 다른 이야기가 펼쳐집니다.'
instruction='성인 두 명에게 현장에서 작품을 설명하는 숙련된 한국인 박물관 도슨트의 말투. 편안하고 차분한 중저음으로 친근하게 이야기한다. 한국어 표준 발음. 기계적으로 또박또박 끊거나 뉴스처럼 읽지 않고 문장 의미에 따라 자연스럽게 억양을 바꾼다. 질문에는 가벼운 호기심을, 여든두 해라는 사실에는 절제된 놀라움을 담는다. 문장 끝마다 같은 억양을 반복하지 않는다. 광고처럼 과장하지 않고, 중요한 사실 뒤에는 짧게 숨을 쉰다.'
started=time.monotonic()
print('LOADING_QWEN_MODEL',flush=True)
model=Qwen3TTSModel.from_pretrained(str(root/'qwen-voice/model'),device_map='cuda:0',dtype=torch.bfloat16,attn_implementation='sdpa',local_files_only=True)
print('GENERATING_DOCENT_SAMPLE',flush=True)
torch.manual_seed(108)
with torch.inference_mode():
    wavs,sr=model.generate_custom_voice(text=text,language='Korean',speaker='Sohee',instruct=instruction,max_new_tokens=1200)
audio=np.asarray(wavs[0],dtype=np.float32)
assert np.all(np.isfinite(audio)) and len(audio)>sr*8
peak=float(np.max(np.abs(audio)))
rms=float(np.sqrt(np.mean(audio**2)))
audio*=min(0.92/max(peak,1e-8),0.09/max(rms,1e-8))
pcm=(np.clip(audio,-1,1)*32767).astype('<i2').tobytes()
wav_path=output/'seville-docent-qwen.wav'
with wave.open(str(wav_path),'wb') as file:
    file.setnchannels(1);file.setsampwidth(2);file.setframerate(sr);file.writeframes(pcm)
enc=lameenc.Encoder();enc.set_bit_rate(128);enc.set_in_sample_rate(sr);enc.set_channels(1);enc.set_quality(2)
mp3_path=output/'seville-docent-qwen.mp3'
mp3_path.write_bytes(enc.encode(pcm)+enc.flush())
record={'model':'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice','revision':'0c0e3051f131929182e2c023b9537f8b1c68adfe','speaker':'Sohee','seconds':len(audio)/sr,'sample_rate':sr,'generation_seconds':time.monotonic()-started,'text':text,'instruction':instruction,'file':str(mp3_path)}
(output/'seville-docent-qwen-info.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in record.items() if k not in ['text','instruction']},ensure_ascii=True),flush=True)
