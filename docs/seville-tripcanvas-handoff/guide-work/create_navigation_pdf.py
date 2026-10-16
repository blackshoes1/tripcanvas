from pathlib import Path
import fitz
import json
from navigation_support import STOPS

BASE = Path(__file__).resolve().parent.parent
OUT = BASE / 'seville-guide/seville-cathedral-find-your-stop.pdf'
TMP = BASE / 'guide-work/navigation'
TMP.mkdir(exist_ok=True)
FONT = fitz.Font(fontfile='C:/Windows/Fonts/malgun.ttf')
BOLD = fitz.Font(fontfile='C:/Windows/Fonts/malgunbd.ttf')
INK = (0.09, 0.17, 0.20)
TEAL = (0.02, 0.39, 0.40)
MUTED = (0.32, 0.39, 0.40)
BG = (0.97, 0.97, 0.94)
GOLD = (0.66, 0.43, 0.09)
DOC = fitz.open()


def text(page, x, y, value, size=13, bold=False, color=INK):
    writer = fitz.TextWriter(page.rect)
    writer.append((x, y), value, font=BOLD if bold else FONT, fontsize=size)
    writer.write_text(page, color=color)


def wrap(value, size, width, font=FONT):
    lines, current = [], ''
    for char in value:
        if char == '\n':
            lines.append(current)
            current = ''
        elif current and font.text_length(current + char, fontsize=size) > width:
            lines.append(current.rstrip())
            current = char.lstrip()
        else:
            current += char
    if current:
        lines.append(current.rstrip())
    return lines


def paragraph(page, x, y, value, size=12.5, width=532, leading=19, color=INK, bold=False):
    for line in wrap(value, size, width, BOLD if bold else FONT):
        text(page, x, y, line, size, bold, color)
        y += leading
    return y


def rect(page, bounds, fill=(1, 1, 1), stroke=(0.80, 0.84, 0.82), radius=0):
    page.draw_rect(fitz.Rect(bounds), fill=fill, color=stroke, width=0.8)


def new_page(number, subtitle):
    p = DOC.new_page(width=600, height=900)
    rect(p, (0, 0, 600, 900), BG, BG)
    text(p, 32, 36, '우리 둘의 세비야', 11, True, TEAL)
    text(p, 32, 72, subtitle, 25, True)
    text(p, 32, 876, '세비야 대성당 | 위치 확인 후 해당 번호 재생', 10, color=MUTED)
    text(p, 541, 876, str(number), 10, color=MUTED)
    return p


def box_label(p, bounds, title, sub, fill=(1, 1, 1), fontsize=12):
    rect(p, bounds, fill)
    x0, y0, x1, y1 = bounds
    yy = y0 + 19
    for line in wrap(title, fontsize, x1 - x0 - 12, BOLD):
        text(p, x0 + 6, yy, line, fontsize, True, TEAL)
        yy += 17
    for line in wrap(sub, 10.5, x1 - x0 - 12):
        text(p, x0 + 6, yy + 1, line, 10.5, color=MUTED)
        yy += 14
    assert yy < y1 + 9, (title, yy, y1)


p = new_page(1, '어디에서 몇 번을 들을까?')
paragraph(p, 32, 101, '오디오 번호가 기준입니다. 공식 지도 번호와는 다릅니다.', 13, color=TEAL, bold=True)
paragraph(p, 32, 125, '표지 이름과 눈앞의 특징을 함께 확인한 뒤 재생하세요.', 12)
text(p, 128, 162, '북쪽 - Calle Alemanes', 11, color=MUTED)
box_label(p, (126, 180, 383, 299), '12 오렌지 정원', 'Patio de los Naranjos\n공식 지도 10 | 오렌지나무·분수', fill=(0.90, 0.95, 0.87), fontsize=16)
box_label(p, (402, 212, 550, 299), '02 / 03 히랄다', 'La Giralda | 공식 지도 6\n02 오르기 전 / 03 종루', fill=(0.89, 0.95, 0.95), fontsize=14)
text(p, 32, 325, '본당과 옆 예배당', 12, True)
rect(p, (32, 337, 550, 610), fill=(0.94, 0.94, 0.91))
box_label(p, (44, 348, 166, 410), '선택 산안드레스', 'San Andrés\n공식 지도 7', fontsize=11.5)
box_label(p, (179, 348, 365, 410), '11 산안토니오', 'San Antonio | 공식 지도 8', fontsize=14)
box_label(p, (111, 439, 290, 510), '10 성가대석', 'Coro | 공식 지도 11\n목제 좌석·위쪽 오르간', fontsize=15)
box_label(p, (357, 439, 536, 510), '05 중앙 제단', 'Retablo Mayor | 지도 5\n여러 층의 금빛 조각', fill=(0.98, 0.94, 0.83), fontsize=15)
box_label(p, (47, 538, 264, 599), '04 본당 전체 설명', '높은 돌기둥·뾰족한 아치\n특정 작품 앞일 필요 없음', fontsize=13)
box_label(p, (280, 528, 430, 599), '06 콜럼버스 묘', 'Tumba de Colón | 지도 1\n네 인물이 메는 관', fontsize=13)
box_label(p, (441, 528, 550, 610), '07 안티구아', 'Virgen de la\nAntigua | 지도 2', fontsize=11.8)
box_label(p, (302, 664, 414, 733), '09 참사회실', 'Sala Capitular\n공식 지도 4 | 타원형', fontsize=12)
box_label(p, (428, 626, 550, 695), '08 대성물실', 'Sacristía Mayor\n공식 지도 3 | 큰 돔', fontsize=12)
text(p, 34, 638, '01은 입장 전 도입입니다.', 12, True, TEAL)
paragraph(p, 34, 660, '이 그림은 공식 지도의 위치 관계를 단순화한 안내도입니다. 축척·벽·출입문·실제 보행 경로를 나타내지 않습니다.', 10.5, width=242, leading=16, color=MUTED)
paragraph(p, 32, 743, '기본 순서: 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11 → 12', 11.7, leading=18, bold=True, color=TEAL)
paragraph(p, 32, 786, '입장 후에는 La Giralda 표지를 따르세요. 이후의 순서는 이 가이드의 추천이며, 현장 표지와 직원의 안내가 우선합니다.', 12, leading=18)
paragraph(p, 32, 836, '길을 놓쳤다면 직원에게 다음 카드의 스페인어 이름을 보여 주세요.', 12, color=TEAL)

for page_number, subset in [(2, STOPS[:6]), (3, STOPS[6:])]:
    p = new_page(page_number, '눈앞에서 확인하고 재생하기')
    text(p, 32, 99, '번호는 오디오 번호입니다. 현장에 같은 번호가 붙어 있다는 뜻은 아닙니다.', 10.8, color=MUTED)
    for index, stop in enumerate(subset):
        y = 118 + index * 119
        rect(p, (32, y, 568, y + 108))
        rect(p, (32, y, 84, y + 108), fill=TEAL, stroke=TEAL)
        text(p, 41, y + 39, f"{stop['n']:02d}", 25, True, (1, 1, 1))
        text(p, 98, y + 25, stop['name'], 17, True)
        text(p, 98, y + 44, f"{stop['sign']} | 공식 지도 {stop['official']}", 10.8, color=TEAL)
        y2 = paragraph(p, 98, y + 63, stop['look'], 12, width=455, leading=16)
        y3 = paragraph(p, 98, y2 + 2, '다음: ' + stop['move'], 10.7, width=455, leading=14, color=MUTED)
        assert y3 < y + 115, (stop['n'], y3, y)
    text(p, 32, 855, '개방되지 않은 곳은 건너뛰고, 다음 장소의 표지와 특징을 확인하세요.', 10.8, color=TEAL)

p = new_page(4, '헷갈릴 때는 이렇게')
y = 116
sections = [
    ('오디오 06과 지도 1은 같은 장소입니다.', '지도 숫자를 그대로 음성 번호로 누르면 엉뚱한 해설이 나옵니다. 이 안내도의 큰 오디오 번호로 고르세요. 예: 콜럼버스 묘는 오디오 06 / 공식 지도 1입니다.'),
    ('08 대성물실과 09 참사회실을 구분하세요.', 'Sacristía Mayor는 큰 돔이 있는 대성물실, Sala Capitular는 타원형 참사회실입니다. 가까이 있는 별개의 방입니다. 두 방 모두 이름을 확인한 뒤 재생하세요.'),
    ('고야와 자비의 그리스도는 선택 관람입니다.', '08번 끝의 고야 그림은 인근 Sacristía de los Cálices, 성배실에 있습니다. 이 공식 지도에는 별도 번호가 없습니다. 10번 끝의 자비의 그리스도는 Capilla San Andrés, 산안드레스 예배당(공식 지도 7)에 있습니다. 실제 작품을 원할 때만 따로 찾아가세요.'),
    ('탑에서는 두 번, 서로 다른 높이에서 듣습니다.', '02번은 오르기 직전에, 03번은 종루에 도착한 뒤 듣습니다. 경사로를 걷는 동안 화면을 찾을 필요가 없습니다. 내려온 뒤 본당에서 04번부터 이어갑니다.'),
    ('정원은 본당 관람을 마친 뒤에 갑니다.', '12번은 오렌지나무가 있는 바깥뜰에서 듣는 마지막 해설입니다. 본당에서 더 볼 곳이 있는지 먼저 확인하고 현장 출구 안내를 따르세요.'),
]
for title, body in sections:
    text(p, 32, y, title, 16, True, TEAL)
    y = paragraph(p, 32, y + 25, body, 13, leading=20) + 27
text(p, 32, y, '직원에게 보여 줄 문장', 16, True, TEAL)
text(p, 32, y + 28, '¿Dónde está la tumba de Colón?', 16, True)
text(p, 32, y + 49, '콜럼버스 기념묘는 어디인가요?', 12, color=MUTED)
text(p, 32, 782, '공식 지도와 운영 안내 | 2026년 10월 21일 확인', 11, True)
paragraph(p, 32, 805, '지도는 대성당 공식 사이트의 12개 명소 PDF를 바탕으로 재구성했습니다. 첫 페이지의 도식은 관람객의 방향 확인을 위한 참고 그림입니다.', 10.5, leading=15, color=MUTED)
link = 'https://www.catedraldesevilla.es/wp-content/uploads/2023/01/plano-catedral-descargable.pdf'
text(p, 32, 849, '공식 원본 지도 열기', 11, True, TEAL)
p.insert_link({'kind': fitz.LINK_URI, 'from': fitz.Rect(30, 835, 190, 854), 'uri': link})
DOC.set_metadata({'title': '우리 둘의 세비야 - 재생 위치 찾기', 'author': '개인 여행용 오디오 가이드', 'subject': '공식 지도와 연결한 한국어 위치 확인 안내'})
OUT.parent.mkdir(exist_ok=True)
DOC.subset_fonts()
DOC.save(OUT, garbage=4, deflate=True)
DOC.close()
check = fitz.open(OUT)
assert len(check) == 4
for i, p in enumerate(check):
    p.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(TMP / f'navigation-page-{i+1}.png')
    assert '\ufffd' not in p.get_text()
print(json.dumps({'path': str(OUT), 'pages': len(check), 'bytes': OUT.stat().st_size}, ensure_ascii=True))
