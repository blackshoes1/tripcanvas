from pathlib import Path
import sys, json, time, wave
import numpy as np
import onnxruntime as ort

root = Path(__file__).resolve().parent
sys.path.insert(0, str(root/'voice-model'))
sys.path.insert(0, str(root/'voice-libs'))
from helper import TextToSpeech, load_cfgs, load_onnx_all, load_text_processor, load_voice_style
import lameenc

assets = root/'voice-model'
output = root.parents[0]/'seville-guide/voice-samples'
output.mkdir(parents=True, exist_ok=True)
opts = ort.SessionOptions()
opts.intra_op_num_threads = 4
opts.inter_op_num_threads = 1
tts = TextToSpeech(load_cfgs(str(assets/'onnx')), load_text_processor(str(assets/'onnx')), *load_onnx_all(str(assets/'onnx'), opts, ['CPUExecutionProvider']))
sample = '지금 보이는 금빛 제단은, 한 사람이 만든 작품이 아닙니다. 천사백팔십이년에 시작해, 천오백육십사년에 마무리됐습니다. 무려 여든두 해입니다. 여러 세대의 장인들이 작은 조각 장면들을 이어 붙여, 성서 이야기를 눈으로 읽을 수 있게 만들었죠. 잠시 가장 아래 중앙의 성모상을 찾아보세요.'
records = []
all_audio = []
for i, voice in enumerate(['F1', 'F2', 'M1'], 1):
    np.random.seed(2400+i)
    start = time.monotonic()
    style = load_voice_style([str(assets/'voice_styles'/f'{voice}.json')])
    audio, duration = tts(f'{i}번 목소리입니다. '+sample, 'ko', style, 10, 0.97, 0.45)
    audio = audio[0, :int(tts.sample_rate*duration[0])]
    pcm = (np.clip(audio,-1,1)*32767).astype('<i2').tobytes()
    enc = lameenc.Encoder();enc.set_bit_rate(96);enc.set_in_sample_rate(tts.sample_rate);enc.set_channels(1);enc.set_quality(2)
    name = f'{i:02d}_{voice}_sample.mp3'
    (output/name).write_bytes(enc.encode(pcm)+enc.flush())
    record = {'voice':voice,'file':name,'seconds':len(audio)/tts.sample_rate,'generation_seconds':time.monotonic()-start,'rms':float(np.sqrt(np.mean(audio**2)))}
    records.append(record)
    all_audio.extend([audio,np.zeros(int(tts.sample_rate*1.5),dtype=np.float32)])
    print(json.dumps(record),flush=True)
audio = np.concatenate(all_audio)
enc = lameenc.Encoder();enc.set_bit_rate(96);enc.set_in_sample_rate(tts.sample_rate);enc.set_channels(1);enc.set_quality(2)
(output/'seville-voice-comparison.mp3').write_bytes(enc.encode((np.clip(audio,-1,1)*32767).astype('<i2').tobytes())+enc.flush())
(output/'sample-info.json').write_text(json.dumps({'model':'supertone-oss-archive/supertonic-3','revision':'aafc6e32416a594460b32413efc49d7fe4ce6d46','sample_text':sample,'voices':records},ensure_ascii=False,indent=2),encoding='utf-8')
print('SAMPLES_COMPLETE',flush=True)
