from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parent
BASE = ROOT.parent.parent
original = json.loads((BASE / 'guide-work/revised-tracks.json').read_text(encoding='utf-8'))
summaries = [
 '세비야 대성당에는 세 겹의 시간이 남아 있습니다. 1172년 건립을 명령한 모스크, 1248년 정복 뒤의 기독교 성당, 그리고 15세기부터 지은 고딕 건물입니다. 가까운 알카사르와 옛 상인 거래소까지 함께 보면 종교·왕권·대서양 교역의 역사가 이어집니다.',
 '히랄다는 원래 모스크에서 예배를 알리던 미나레트입니다. 1184년 건립 명령 뒤 1198년에 완성되었고, 정상에는 금빛 구체 네 개가 있었습니다. 지금의 종루와 풍향계는 16세기의 추가입니다. 탑의 몸체와 정상을 나누어 보면 시대가 바뀐 흔적을 읽을 수 있습니다.',
 '세비야는 바닷가가 아니라 과달키비르강으로 대서양과 이어지는 내륙 항구였습니다. 1503년 세운 카사 데 콘트라타시온은 알카사르에서 교역과 항해 지식을 관리했습니다. 성당 옆 인디아스 문서관 건물은 별개의 상인 거래소였습니다. 상인들은 전용 건물이 생기기 전 성당 바깥 계단에서 거래했습니다.',
 '본당은 한 번에 완성된 건물이 아닙니다. 모스크를 성당으로 쓰던 시기를 지나 15세기에 새 고딕 성당을 지었습니다. 중앙부 천장은 1511년과 1888년에 무너져 다시 세워졌습니다. 눈앞의 공간에는 건축가와 석공들의 작업뿐 아니라 붕괴와 복구의 역사도 함께 남아 있습니다.',
 '중앙 제단은 1482년부터 1564년까지, 82년에 걸친 여러 장인의 공동 작업입니다. 44개의 부조와 200개가 넘는 인물로 성서 장면을 펼쳤습니다. 아래에서 위로 장면을 따라가 보세요. 커다란 금빛 벽처럼 보여도, 실제로는 작은 조각 장면들이 모인 이야기입니다.',
 '콜럼버스 기념묘의 네 인물은 카스티야·레온·아라곤·나바라 왕국을 상징합니다. 유해는 바야돌리드와 세비야, 산토도밍고, 아바나를 거쳐 1899년 세비야로 돌아왔고 1902년 현재 기념묘에 안치되었습니다. 묘 자체도 처음에는 아바나를 위해 계획한 작품이었습니다.',
 '안티구아 성모는 옛 모스크의 벽돌 기둥에 그렸던 14세기 벽화입니다. 1578년에는 벽화를 떼어 다시 그린 대신, 벽체와 함께 옮기는 큰 공사를 했습니다. 도르래와 밧줄, 목재 구조를 다루는 데 선원들도 참여했습니다. 항구도시의 기술이 성당 미술품 보존에 쓰인 셈입니다.',
 '대성물실은 예배 기물과 의복을 준비하던 르네상스 공간입니다. 입구 아치 안쪽에는 1533~1535년에 새긴 음식 접시 68개가 있습니다. 방 안의 돔과 그림뿐 아니라 당시의 식생활까지 기록한 셈입니다. 아르페의 은제 성체현시대는 1580~1587년에 만들어 성체성혈대축일 행렬에 사용했습니다.',
 '참사회실의 타원형 평면은 모인 사람들이 서로 바라보는 회의 공간을 만듭니다. 1592년에 완성된 공간에 1667년 무리요의 그림들이 더해졌습니다. 무염시태 그림은 성모 마리아가 잉태되는 순간부터 원죄 없이 보존되었다는 가톨릭 신앙을 표현하며, 예수의 동정녀 탄생과는 다른 주제입니다.',
 '117석의 성가대석에는 15세기 목공과 이슬람계 장식 전통이 남아 있습니다. 양쪽 오르간은 1901년 전기 연결을 통해 하나의 연주대에서 다루게 되었습니다. 이 성당에는 특정 전례 시기에 소년 열 명이 춤추는 세이세스 전통도 이어집니다.',
 '무리요는 1656년 이 예배당을 위해 성 안토니오의 환시를 그렸습니다. 1874년 도둑은 그림 전체가 아니라 무릎 꿇은 성인의 인물 부분을 잘라 갔습니다. 그 조각은 뉴욕에서 발견되어 돌아왔고 1875년에 복원되었습니다. 지금의 장면에는 제작과 도난, 회수와 복원의 시간이 겹쳐 있습니다.',
 '오렌지 정원은 모스크의 안뜰에서 이어진 공간입니다. 다만 지금 보이는 나무·분수·회랑의 모든 부분이 12세기 그대로인 것은 아닙니다. 본당에서 보았던 여러 시대의 흔적을 떠올리며, 탑과 뜰, 성당이 한 장소에 겹쳐 온 시간을 마지막으로 살펴보세요.',
]
photo_keys = ['main','giralda','tower','nave','altar','columbus','antigua','sacristy','chapter','choir','murillo','patio']
points = [None,[865,240],[865,162],[220,470],[650,460],[560,570],[680,590],[825,712],[705,830],[370,460],[310,330],[500,160]]
find = [
 ['입장권에 적힌 문을 먼저 확인','아직 특정 작품 앞일 필요 없음','입장 후 La Giralda 표지 찾기'],
 ['La Giralda라는 이름','탑으로 들어가는 입구','오르기 직전, 통행을 막지 않는 자리'],
 ['큰 종과 아치형 개구부','아래로 보이는 도시와 성당 지붕','경사로를 벗어난 위쪽 종루'],
 ['높은 돌기둥','뾰족한 아치 천장','본당 전체를 함께 볼 수 있는 자리'],
 ['여러 층으로 쌓인 금빛 조각 장면','성당 중심의 큰 제단','관람객과 작품 사이의 철책'],
 ['관을 어깨에 멘 네 인물','왕국을 상징하는 문장과 복장','바닥이 아니라 높이 올린 관'],
 ['Virgen de la Antigua라는 이름','아기 예수를 안고 서 있는 성모','금빛 바탕의 오래된 벽화'],
 ['Sacristía Mayor라는 이름','큰 돔으로 덮인 방','입구 아치 안쪽의 음식 접시 조각'],
 ['Sala Capitular라는 이름','타원형 방의 윤곽','벽면을 따라 배치된 인물화'],
 ['Coro라는 이름','철책 안의 목제 좌석','위쪽 양편에 마주 선 큰 오르간'],
 ['Capilla San Antonio 또는 Bautismo','아래에서 무릎 꿇은 성인','위쪽 빛 속의 아기 예수와 천사들'],
 ['Patio de los Naranjos라는 이름','하늘이 열린 바깥뜰','오렌지나무와 가운데 분수'],
]
questions = [
 '¿Dónde está la entrada indicada en mi billete?', '¿Dónde está la entrada a la Giralda?', '¿Cómo se llega al campanario?',
 '¿Dónde está la nave central?', '¿Dónde está el Retablo Mayor?', '¿Dónde está la tumba de Colón?',
 '¿Dónde está la capilla de la Virgen de la Antigua?', '¿Dónde está la Sacristía Mayor?', '¿Dónde está la Sala Capitular?',
 '¿Dónde está el coro?', '¿Dónde está la capilla de San Antonio?', '¿Dónde está el Patio de los Naranjos?'
]
stops=[]
optional_bodies={}
for i,t in enumerate(original['tracks']):
    nav=t['navigation']
    body=t['body']
    assert body.startswith(nav['before']) and body.endswith(nav['after'])
    body=body[len(nav['before']):len(body)-len(nav['after'])].strip()
    if t['number']==8:
        anchor='이곳에서 인근 성배실에 있는 고야의 성녀 후스타와 루피나 이야기도 함께 들어보겠습니다.'
        assert anchor in body
        body, optional_bodies[13]=body.split(anchor,1)
        optional_bodies[13]='고야의 성녀 후스타와 루피나 이야기입니다.'+optional_bodies[13]
    if t['number']==10:
        anchor='성가대 해설을 마치며 인근 작품의 제작 이야기도 하나 들어보겠습니다.'
        assert anchor in body
        body, optional_bodies[14]=body.split(anchor,1)
        optional_bodies[14]='자비의 그리스도 제작 이야기입니다.'+optional_bodies[14]
    stop=dict(id=f'{i+1:02d}',n=i+1,name=nav['name'],title=t['title'],spanish=nav['sign'],official=nav['official'],
        photoKey=photo_keys[i],point=points[i],find=find[i],question=questions[i],summary=summaries[i],full=body.strip(),
        next=nav['move'],arrival=nav['before'],sources=t['sources'],optional=False,zone='탑' if i in [1,2] else '입장 전' if i==0 else '정원' if i==11 else '성당 내부')
    if i==7:
        stop['arrival']='Sacristía Mayor라는 이름과 큰 돔을 확인하세요. 입구 아치 안쪽에는 음식 접시 조각이 있습니다.'
        stop['next']='기본 코스는 Sala Capitular로 이어집니다. 고야 그림은 별도의 선택 장소에서 볼 수 있습니다.'
    if i==9:
        stop['arrival']='Coro라는 이름, 목제 좌석과 위쪽 양편의 오르간을 확인하세요. 철책 바깥 관람 구역에서 듣습니다.'
        stop['next']='기본 코스는 Capilla San Antonio로 이어집니다. 자비의 그리스도는 선택 장소인 San Andrés에 있습니다.'
    stops.append(stop)

stops.extend([
 dict(id='13',n=13,name='고야의 두 성녀',title='고야 - 세비야에서 벌어진 그림 논쟁',spanish='Sacristía de los Cálices',official='별도 번호 없음',
      photoKey='goya',point=None,find=['Sacristía de los Cálices라는 이름','고야의 〈성녀 후스타와 루피나〉 작품표','서 있는 두 성녀와 아래쪽의 사자'],
      question='¿Dónde está la Sacristía de los Cálices?',summary='고야의 1817년 그림은 이듬해 대성당에 전달되었습니다. 외부 화가에게 돌아간 주문을 두고 일부 세비야 미술가들이 반발했고, 찬반 양쪽이 시와 짧은 노랫말로 논쟁했습니다. 오늘날의 명작도 처음부터 환영받았던 것은 아닙니다.',
      full=optional_bodies[13].strip(),next='개방 여부를 확인하고 선택해서 봅니다. 기본 코스는 09 참사회실로 이어집니다.',arrival='대성물실과 다른 방입니다. Sacristía de los Cálices라는 이름과 고야 작품표를 확인하세요.',
      sources=[s['id'] for s in original['sources'] if 'fundaciongoyaenaragon' in s['url']],optional=True,zone='선택 관람'),
 dict(id='14',n=14,name='자비의 그리스도',title='조각의 계약서 - 못 네 개와 고객의 주문',spanish='Capilla San Andrés',official='7',
      photoKey='clemencia',point=[125,330],find=['Capilla San Andrés라는 이름','십자가에 매달린 목조 그리스도상','기도 공간으로 운영되는 예배당'],
      question='¿Dónde está la capilla de San Andrés?',summary='1603년 계약에서 주문자는 몬타녜스에게 두 손과 두 발에 각각 못을 하나씩 쓰고, 앞서 페루로 보낸 작품보다 훨씬 잘 만들라고 요구했습니다. 기도하는 사람을 바라보는 시선까지 주문했습니다. 명작의 표정 뒤에는 구체적인 고객의 조건이 있었습니다.',
      full=optional_bodies[14].strip(),next='기도 공간 밖에서 해설을 듣고 현장 안내에 따릅니다. 기본 코스는 11 산안토니오로 이어집니다.',arrival='이 예배당은 기도 공간입니다. 해설은 바깥에서 듣고 조용히 관람하세요.',
      sources=[s['id'] for s in original['sources'] if 'documento-ahps-may-2018' in s['url'] or 'abre-como-espacio-de-oracion' in s['url']],optional=True,zone='선택 관람')
])

payload=dict(title='우리 둘의 세비야',updated='2026-10-21',stops=stops,sources=original['sources'],
             officialMap='https://www.catedraldesevilla.es/wp-content/uploads/2023/01/plano-catedral-descargable.pdf')
(ROOT/'dist/content.js').write_text('window.GUIDE_DATA = '+json.dumps(payload,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
out=ROOT/'dist/narration';out.mkdir(exist_ok=True)
for s in stops:
    (out/f"{s['id']}_narration.txt").write_text(s['arrival']+'\n\n'+s['full']+'\n\n다음 이동: '+s['next']+'\n',encoding='utf-8')
(out/'all-narration.txt').write_text('\n\n'.join(f"{s['id']}. {s['name']}\n{s['arrival']}\n\n{s['full']}\n\n다음 이동: {s['next']}" for s in stops),encoding='utf-8')
assert len(stops)==14 and all(s['full'] and s['summary'] and len(s['find'])==3 for s in stops)
print(json.dumps({'stops':len(stops),'main':12,'optional':2,'bytes':(ROOT/'dist/content.js').stat().st_size}))
