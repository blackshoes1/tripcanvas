from pathlib import Path
import json
import re
from historical_addons import apply as apply_historical_addons, SOURCES as ADDON_SOURCES
from navigation_support import apply as apply_navigation_support

BASE = Path(__file__).resolve().parent.parent
history = json.loads((BASE / 'guide-work/history-tracks-v2.json').read_text(encoding='utf-8'))
art = json.loads((BASE / 'guide-work/art-tracks-v2.json').read_text(encoding='utf-8'))
tracks = history['tracks'] + art['tracks']
tracks.sort(key=lambda x: x['number'])

tracks[1]['body'] = tracks[1]['body'].replace('실제로 매일 누가 어떤 방식으로 올라갔는지까지 단정할 필요는 없지만, 계단 대신 경사로를 택한 설계가 이동에 유리했다는 점은 이해할 수 있습니다.', '계단 대신 경사로를 둔 구조 덕분에 탑의 위아래를 잇는 길이 비교적 넓게 이어집니다.')
tracks[4]['body'] = tracks[4]['body'].replace('제단은 콜럼버스의 1492년 항해보다 먼저 제작되기 시작했습니다. 그렇다고 그것만으로 모든 재료의 조달 경로가 설명되지는 않습니다. 금빛을 보며 곧바로 전부 아메리카에서 가져온 금이라고 말하는 것은, 실제 제작 시기와 긴 증축 과정을 지나치게 단순화합니다.\n\n', '')
tracks[4]['sources'].remove('H16')
tracks[5]['body'] = tracks[5]['body'].replace(' 1899년과 1902년이라는 두 연도가 나오는 이유는 도착과 최종 안치가 서로 다른 사건이기 때문입니다.', '')
tracks[5]['body'] = tracks[5]['body'].replace('스미스소니언 국립아메리카인디언박물관의 설명은 이 만남을 그러한 변화와 상실, 그리고 오늘까지 이어진 원주민의 생존이라는 관점에서 다룹니다.', '그와 함께 원주민의 문화와 공동체가 오늘까지 이어지고 있다는 사실도 기억할 필요가 있습니다.')
tracks[0]['body'] = tracks[0]['body'].replace('유네스코도 이 세 건물을 하나의 세계유산으로 등재하고 있습니다.', '1987년 유네스코는 이 세 건물을 하나의 세계유산으로 등재했습니다.')
tracks[6]['body'] = tracks[6]['body'].replace('천오백이십이년 구월 육일 이곳에서 감사 기도를 드렸다고 합니다.', '천오백이십이년 귀환 뒤 이곳에서 감사 기도를 드렸다고 합니다.')
tracks[6]['check'] += ' 안달루시아 자료의 1522년 9월 6일은 세비야 귀환·참배 날짜와 혼동되어 있어 낭독은 1522년 귀환 뒤로 한정.'
tracks[6]['sources'].append('P05')
tracks[8]['body'] = tracks[8]['body'].replace('마호가니로 만든 의장용 의자와 서기의 자리는 조각가 디에고 데 벨라스코의 천오백구십이년 작업으로 설명됩니다.', '마호가니 등을 사용한 대주교 의자와 서기의 자리는 천오백구십이년의 가구입니다. 아센시오 데 마에다가 설계하고 파블로 토레스가 목공을 맡았으며, 디에고 데 벨라스코와 여러 장인이 조각과 장식에 참여했습니다.')
tracks[8]['sources'].append('A22')

# Use the separate decorative-arts source for the choir's early work and ironwork.
tracks[9]['body'] = tracks[9]['body'].replace('초기 목조 작업은 십오세기 후반에 진행되었고, 누프로 산체스와 피터르 단카르트 같은 장인들이 참여했습니다. 왕에게 배정된 좌석에는 누프로 산체스의 서명과 천사백칠십팔년이라는 연대가 남아 있어 제작자를 확인하는 단서가 됩니다. 단카르트는 그 다음 해부터 장식을 이어 갔고, 전체 장식은 십육세기에 이르기까지 더해졌습니다.', '초기 목조 작업은 천사백육십사년부터 천사백칠십구년 사이에 진행되었고, 누프로 산체스와 피터르 단카르트 같은 장인들이 참여했습니다. 이후에도 장식과 개수가 이어졌습니다. 공식 장식미술 설명은 천오백십일년의 개수와 십구세기 말의 중요한 복원을 기록합니다.')
tracks[9]['body'] = tracks[9]['body'].replace('프라이 프란시스코 데 살라망카가 천오백십팔년부터 천오백이십삼년 사이에 만든', '산초 무뇨스와 프라이 프란시스코 데 살라망카 등이 천오백십팔년부터 천오백이십삼년 사이에 만든')
tracks[9]['body'] = tracks[9]['body'].replace('천오백육십이년부터 천오백육십오년 사이 여러 장인이 제작했으며', '르네상스 시대 여러 장인이 제작했으며')
tracks[9]['sources'] = [s for s in tracks[9]['sources'] if s != 'A12']
tracks[9]['check'] = '초기 목조 작업·후속 장식·개수를 구분. 철책은 살라망카 단독 제작으로 단정하지 않음. 1901년은 전기 연결 체계, 1973·1996년은 후대 개량.'

all_sources = history['sources'] + art['sources']
all_sources.extend([
 {'id':'A22','title':'세비야 교구 문화유산 담당자·참사회실의 도상과 1592년 가구','url':'https://odisur.es/sevilla/sillon-arzobispal-de-la-sala-capitular-en-la-catedral-de-sevilla/'},
 {'id':'P05','title':'대성당·엘카노와 마젤란의 세계일주 귀환 기념 기사','url':'https://www.catedraldesevilla.es/la-catedral-de-sevilla-participa-en-los-actos-conmemorativo-del-v-centenario-de-elcano-y-magallanes/'},
 {'id':'P01','title':'대성당 공식 운영시간·입구·히랄다 우선 관람','url':'https://www.catedraldesevilla.es/visita-cultural/horarios-y-tarifas/'},
 {'id':'P02','title':'대성당 공식 관람 계획·왕실예배당 제한','url':'https://www.catedraldesevilla.es/como-visitar-la-catedral-de-sevilla-horarios-duracion-accesos-y-recomendaciones/'},
 {'id':'P03','title':'대성당 공식 관람 지도','url':'https://www.catedraldesevilla.es/wp-content/uploads/2023/01/plano-catedral-descargable.pdf'},
 {'id':'P04','title':'대성당 공식 일반 관람 규정','url':'https://www.catedraldesevilla.es/wp-content/uploads/2025/03/Normas-generales-catedral-descargable-actualizado.pdf'},
 {'id':'T01','title':'Supertone 공식 Supertonic 3 모델·한국어·기기 내 생성','url':'https://huggingface.co/Supertone/supertonic-3'},
 {'id':'T02','title':'Supertonic 3 공식 브라우저 데모','url':'https://huggingface.co/spaces/Supertone/supertonic-3'},
 {'id':'T03','title':'Supertonic 보존 저장소·지원 종료 안내','url':'https://github.com/supertone-oss-archive/supertonic'},
 {'id':'T04','title':'Google Gemini 음성 모델 무료 등급 가격표','url':'https://ai.google.dev/gemini-api/docs/pricing'},
 {'id':'T05','title':'Google Gemini 음성 생성·언어·WAV 저장','url':'https://ai.google.dev/gemini-api/docs/speech-generation'},
 {'id':'T06','title':'TTSMaker 한국어 무료 서비스','url':'https://ttsmaker.com/ko'},
 {'id':'T07','title':'TTSMaker 무료 요금제 1회 입력 한도','url':'https://pro.ttsmaker.com/pricing'},
])
apply_historical_addons(tracks)
apply_navigation_support(tracks)
all_sources.extend(ADDON_SOURCES)

source_by_url = {}
source_id_map = {}
unique_sources = []
for s in all_sources:
    key = s['url'].rstrip('/')
    if key not in source_by_url:
        sid = f'S{len(unique_sources)+1:02d}'
        source_by_url[key] = sid
        unique_sources.append({'id':sid,'title':s['title'],'url':s['url']})
    source_id_map[s['id']] = source_by_url[key]
for t in tracks:
    t['sources'] = list(dict.fromkeys(source_id_map[x] for x in t['sources']))

chars = sum(len(t['body']) for t in tracks)
header = f'''우리 둘의 세비야
세비야 대성당 · 히랄다 한국어 오디오 가이드
역사·미술사 심화 개정본 · 위치 확인·이동 안내 추가 / 2026년 10월 21일

12트랙 · 낭독 본문 {chars:,}자
상태: 원고 개정 완료. 전체 트랙의 음성 파일은 아직 제작하지 않았습니다.
관람 여유: 이동·대기·작품 감상을 포함하여 약 2시간을 권합니다. 공식 지정 소요시간이 아닌 제작상 제안입니다.
예상 음성 길이: 약 40~55분. 아직 전체 음성으로 제작하지 않아 확정한 길이는 아닙니다.

이번 개정에서 보강한 내용
알모하드 모스크와 미나레트의 건설 단계, 히랄다 정상 장식과 종루의 변화, 세비야 무역 관청과 강 항구의 역사, 고딕 성당의 공사·붕괴·재건, 중앙 제단 장인과 재료·도상, 콜럼버스 유해와 기념묘의 이동, 안티구아 벽화 이전 공사, 르네상스 부속 공간의 제작자와 전례 기능, 성가대·오르간의 제작과 개수, 무리요 작품의 주문·도난·복원, 오렌지 정원과 용서의 문의 변화.

이번에 더한 역사 일화
03: 대성당 바깥 계단에서 거래하던 상인들과 거래소 건립.
08: 입구 아치의 음식 접시 68개, 인근 성배실의 고야 그림과 당대 찬반 논쟁.
10: 소년 열 명의 세이세스 춤, 산안드레스의 자비의 그리스도 제작 계약 조건.
11: 무리요의 성모의 탄생이 프랑스 점령기에 떠나 루브르에 들어간 경위.
성배실과 산안드레스 설명은 선택 구간입니다. 지도 번호와 현재 위치를 확인하고 재생하세요.

사용 방법
각 장소에 도착하면 해당 트랙을 재생합니다. 해설이 끝나면 멈춘 채 자유롭게 관람하세요.
각 트랙 첫머리에서 현재 위치와 눈으로 확인할 특징을 알려 주고, 끝에서 다음 장소를 안내합니다.
동반 안내도 seville-cathedral-find-your-stop.pdf의 오디오 번호를 보고 고르세요. 스페인어 표지와 눈앞의 특징을 함께 확인합니다.
공식 지도 번호는 이 PDF와 연결하는 참고 번호입니다. 현장 벽면에 같은 번호가 반드시 붙어 있다는 뜻은 아닙니다.
음성으로 만들 때는 각 구간의 [낭독 시작]과 [낭독 끝] 사이만 사용합니다.
트랙의 재생 위치·출처 번호·편집 메모는 낭독하지 않습니다.
트랙 번호는 이 가이드의 자체 번호이며, 공식 지도 번호와 다릅니다.
왕실예배당 내부·도서관·지붕 특별투어는 일반 관람 코스에 넣지 않았습니다.
현장 표지와 직원, 실제 입장권의 안내가 이 원고의 추천 순서보다 우선합니다.

입장 전 확인
현재 공식 일반 관람은 히랄다 탑부터 시작합니다. 온라인 입장은 Puerta del Lagarto, 현장 매표소 입장은 Puerta del Príncipe로 안내됩니다.
왕실예배당 Capilla Real 내부는 일반 문화관람 구간에 포함되지 않습니다.
미사·행사·보존 작업에 따라 일부 공간이 닫히면 해당 트랙을 건너뜁니다.
개인 이어폰을 사용하고, 사진은 현장 표지와 플래시·삼각대 제한을 따릅니다.
탑에서는 우측으로 이동하고 경사로·계단에서 화면을 보며 걷거나 길을 막고 멈추지 마세요.
운영 안내 근거: {source_id_map['P01']}·{source_id_map['P02']}·{source_id_map['P04']}

공식 지도
https://www.catedraldesevilla.es/wp-content/uploads/2023/01/plano-catedral-descargable.pdf

트랙과 공식 지도 번호
'''
chunks = [header]
for t in tracks:
    chunks.append(f"{t['number']:02d} {t['title']} / 공식 지도 {t['map']}\n")
chunks.append('\n')
for t in tracks:
    chunks.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
    chunks.append(f"{t['number']:02d}. {t['title']}\n")
    chunks.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
    nav = t['navigation']
    chunks.append(f"재생 위치: {t['where']}\n공식 지도: {t['map']} / 근거: {'·'.join(t['sources'])}\n")
    chunks.append(f"찾을 표지: {nav['sign']}\n눈으로 확인: {nav['look']}\n다음 이동: {nav['move']}\n\n")
    chunks.append('[낭독 시작]\n' + t['body'] + '\n[낭독 끝]\n\n')

chunks.append('''━━━━━━━━━━━━━━━━━━━━━━━━━━━━
무료 음성 제작 방법 — 낭독하지 않음
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 문자 크레딧 없이 반복 제작: Supertonic 3
https://huggingface.co/spaces/Supertone/supertonic-3
Supertone이 공개한 모델을 브라우저에서 기기 내 실행하는 방식입니다. 한국어와 여러 기본 목소리를 지원합니다. 첫 실행에는 모델 자료를 내려받아야 하고 이후 생성 시간은 기기 성능과 글 길이에 따라 달라집니다. 월별 문자 크레딧을 소모하는 구조는 아닙니다.
실제 확인: 한국어 98자 시험 문장이 약 12초 길이의 음성으로 생성되고, 결과 화면에 Download WAV 버튼이 표시되었습니다. 이 환경에서는 브라우저 연결이 종료되어 파일 다운로드 완료와 청취 품질은 검증하지 못했습니다. 전체 가이드 음성을 제작했다는 뜻은 아닙니다.
주의: 공개 저장소는 2026년 9월 보존 상태로 전환되어 개발·지원이 종료되었습니다. 현재 데모의 장기 운영이 보장되는 것은 아닙니다. 사용자 지정 음성 제작 상품과 무료 공개 모델을 구분하세요.

2. 말투와 속도를 지시하며 제작: Google AI Studio
https://aistudio.google.com/generate-speech
한국어를 지원하는 Gemini TTS의 무료 등급을 사용할 수 있습니다. 무료 모델·무료 등급인지 확인하고, Single speaker 방식으로 같은 목소리를 유지하며 트랙별로 생성합니다. 무료 이용에는 계정·프로젝트·모델별 요청량 제한이 있으므로 무제한 서비스로 생각하면 안 됩니다. 공식 문서는 WAV 출력 저장을 설명합니다.
이 개정본은 낭독 부분이 1만 자를 넘으므로, 월 1만 자 무료 제공형보다 반복 생성에 유리한 방식을 우선 검토했습니다. 실제 계정에서 사용할 수 있는 무료 한도는 생성 화면에서 확인해야 합니다.

말투 지시 예시
차분하고 명료한 한국어 박물관 오디오 가이드처럼 읽어 주세요. 본문을 요약하거나 내용을 추가하지 말고 그대로 낭독하세요. 인명과 연도는 또렷하게, 속도는 보통보다 약간 느리게, 문단 사이에는 짧게 쉬어 주세요. 과장된 연기와 배경음악은 넣지 마세요.

3. MP3가 필요한 예비 수단: TTSMaker
https://ttsmaker.com/ko
한국어와 MP3·WAV 다운로드를 지원하며 주간 무료 한도는 2만 자로 안내됩니다. 다만 무료 요금표의 1회 변환 한도는 500자이고, 한국어 초기 화면의 1000자 표기와 차이가 있습니다. 긴 트랙을 나누어야 하며, 캡차·광고와 재생성 사용량이 있어 장편 원고의 첫 선택으로 권하지 않습니다. 일부 무제한 목소리 안내가 있으나 한국어에도 해당하는지는 확인하지 못했습니다.

음성 파일 구성 권장
12개 개별 파일로 저장하고 자동 다음 트랙 재생은 끕니다.
파일 이름은 01_도입, 02_히랄다, 03_세비야항구, 04_본당, 05_중앙제단, 06_콜럼버스, 07_안티구아, 08_대성물실, 09_참사회실, 10_성가대, 11_무리요, 12_오렌지정원처럼 정렬합니다.
첫 트랙을 시험 생성하여 인명과 연도, 속도를 먼저 확인한 뒤 같은 설정으로 나머지를 만드세요.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
사실 확인·편집 메모 — 낭독하지 않음
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
''')
for t in tracks:
    chunks.append(f"{t['number']:02d}: {t['check']}\n")
chunks.append('''
자료를 다루는 원칙
연대가 서로 다른 사건은 구분했습니다. 예를 들어 성당의 1506년 천장 완성 단계와 1507년 개장, 콜럼버스 유해의 1899년 도착과 1902년 최종 안치는 별개 사건입니다.
자료가 상충하는 세부 수치는 안전한 범위로 표현했습니다. 히랄다 경사로 개수, 1433·1434년 착공 표기, 성체현시대 높이 등은 단정하지 않았습니다.
마젤란·엘카노의 참배는 전승으로, 성 안토니오의 환시는 성인전에 전해지는 신앙 이야기로 소개했습니다.
콜럼버스의 유해 전체 소재·출생지·민족에 대한 논쟁은 다루지 않았습니다.
중앙 제단의 금박이 모두 아메리카산이라는 식의 재료 원산지 단정은 넣지 않았습니다.
건물의 기능·제작 기록과 작품을 읽는 해석을 구분하고, 실제로 보이지 않을 수 있는 작품의 현재 전시 상태를 보장하지 않았습니다.
원고는 여러 1차 자료에서 사실을 확인하여 새로 작성한 개인용 해설이며, 공식 오디오 가이드의 번역·복제가 아닙니다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
출처 — 2026년 10월 21일 확인
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
''')
for s in unique_sources:
    chunks.append(f"{s['id']} {s['title']}\n{s['url']}\n\n")

out = ''.join(chunks)
dest = BASE / 'seville-guide/seville-cathedral-korean-guide.txt'
backup = BASE / 'guide-work/seville-cathedral-original-v1.txt'
if not backup.exists():
    backup.write_bytes(dest.read_bytes())
dest.write_text(out,encoding='utf-8')
(BASE/'guide-work/revised-tracks.json').write_text(json.dumps({'tracks':tracks,'sources':unique_sources},ensure_ascii=False,indent=2),encoding='utf-8')

assert [t['number'] for t in tracks] == list(range(1,13))
assert out.count('[낭독 시작]') == 13  # one instruction plus twelve track markers
assert len(re.findall(r'\[낭독 시작\]\n(.*?)\n\[낭독 끝\]',out,re.S)) == 12
assert '\ufffd' not in out
assert all(t['body'].strip() and t['sources'] for t in tracks)
print(json.dumps({'tracks':len(tracks),'narration_chars':chars,'total_chars':len(out),'bytes':dest.stat().st_size,'unique_sources':len(unique_sources),'track_chars':[len(t['body']) for t in tracks]},ensure_ascii=True))
