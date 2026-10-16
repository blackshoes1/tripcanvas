import json
from pathlib import Path

p = Path(__file__).with_name('art-tracks-v2.json')
d = json.loads(p.read_text(encoding='utf-8'))
additions = {
    8: ('은으로 만든 작은 건축물 같은 기물이 보인다면', '대성당은 천오백팔십년 아르페가 제시한 모형을 받아들여 새 행렬용 성체현시대 제작을 맡겼습니다. 공식 설명에 따르면 그 모형도 보존되어 있습니다. 완성품뿐 아니라 설계 단계의 자료가 전한다는 점에서, 이 작품은 장인이 구상하고 제작한 과정을 살펴보는 대상이기도 합니다.\n\n'),
    9: ('이제 방을 한 번 더 둘러보세요.', '회의실에는 그림과 조각 외에 실제 회의를 위한 가구도 남아 있습니다. 마호가니로 만든 의장용 의자와 서기의 자리는 조각가 디에고 데 벨라스코의 천오백구십이년 작업으로 설명됩니다. 발언하는 사람과 기록하는 사람의 자리까지, 방의 기능이 가구에 구체적으로 드러납니다.\n\n'),
    10: ('목재와 금속으로 된 오래된 외관 안에도', '현재 악기에 앞서 여러 오르간이 이곳에서 사용되었습니다. 공식 기록에는 천사백칠십구년 프라이 후안의 악기, 천오백칠십구년 마에세 요르스의 악기 등 양편에 놓였던 이전 악기 여섯 대가 나옵니다. 오늘 보이는 체계 뒤에 수백 년간 악기를 교체하고 수리해 온 역사가 있습니다.\n\n'),
    11: ('그림의 인물은 파도바의 안토니오, 프란치스코회 수사입니다.', '그림의 인물은 파도바의 안토니오, 프란치스코회 수사입니다. 이름에 붙은 지명과 달리 그는 리스본에서 태어났고, 십삼세기에 활동하다 천이백삼십일년에 세상을 떠났습니다. 무리요는 성인이 살던 시대보다 약 사백 년 뒤에 그 이야기를 그린 것입니다.'),
    12: ('관람 출구인 용서의 문,', '뜰 주변의 상층에는 참사회와 콜롬비나 도서관도 자리합니다. 천오백오십이년에는 콜럼버스의 아들 에르난도 콜론이 남긴 장서가 참사회 도서관에 합쳐졌습니다. 일반 관람에서 들어가는 공간은 아니지만, 성당이 예배와 미술뿐 아니라 책과 기록을 지켜 온 장소라는 배경을 더해 줍니다.\n\n'),
}
for t in d['tracks']:
    if t['number'] in additions:
        marker, extra = additions[t['number']]
        if t['number'] == 11:
            t['body'] = t['body'].replace(marker, extra, 1)
        else:
            t['body'] = t['body'].replace(marker, extra + marker, 1)
    if t['number'] == 8:
        t['sources'].append('A21')
    if t['number'] == 10:
        t['sources'].append('A20')
        t['check'] = '1464~1479초기목조와16세기최종장식구분.1901전기연결은1903전체완료와별개.세부좌석접근보장안함.무데하르용어정의는UNESCO로보완.'
d['sources'].extend([
    {'id': 'A20', 'title': 'UNESCO — 무데하르 미술의 이슬람 전통과 기독교 지배하 발전', 'url': 'https://whc.unesco.org/en/list/378/'},
    {'id': 'A21', 'title': '대성당 공식 금속공예 — 1580년 모형 승인과 행렬용 성체현시대', 'url': 'https://www.catedraldesevilla.es/la-catedral/patrimonio/orfebreria/'}
])
p.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'path': str(p.resolve()), 'tracks': [{'number': t['number'], 'chars': len(t['body'])} for t in d['tracks']], 'total': sum(len(t['body']) for t in d['tracks'])}, ensure_ascii=True))
