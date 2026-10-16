from pathlib import Path
import base64
import json
from urllib.parse import quote

workspace = Path(__file__).resolve().parents[1]
dist = workspace / 'sites/seville-field-guide-publish/dist'
photos = json.loads((dist / 'assets/photos.json').read_text(encoding='utf-8'))
for photo in photos.values():
    image = dist / photo['src']
    photo['src'] = 'data:image/jpeg;base64,' + base64.b64encode(image.read_bytes()).decode('ascii')

html = (dist / 'index.html').read_text(encoding='utf-8')
css = (dist / 'style.css').read_text(encoding='utf-8')
content = (dist / 'content.js').read_text(encoding='utf-8')
app = (dist / 'app.js').read_text(encoding='utf-8')
assert "fetch('assets/photos.json')" in app
app = app.replace("fetch('assets/photos.json').then(r=>r.ok?r.json():{}).catch(()=>({}))", 'Promise.resolve(window.INLINE_PHOTOS)')
app = app.replace('offlineReady=false;', 'offlineReady=true;')
app = app.replace("async function prepareOffline(){", "async function prepareOffline(){toast('이 파일에는 사진·지도·원고가 모두 포함되어 있습니다. 음성의 오프라인 재생은 기기 설정에 따라 다릅니다.');return;")
narration = (dist / 'narration/all-narration.txt').read_text(encoding='utf-8')
app = app.replace('href="narration/all-narration.txt"', 'href="data:text/plain;charset=utf-8,' + quote(narration, safe='') + '"')
html = html.replace('<link rel="manifest" href="manifest.webmanifest">', '')
icon = 'data:image/svg+xml;base64,' + base64.b64encode((dist / 'icon.svg').read_bytes()).decode('ascii')
html = html.replace('href="icon.svg"', 'href="' + icon + '"')
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>' + css + '</style>')
inline_photos = json.dumps(photos, ensure_ascii=False).replace('</', '<\\/')
script = '<script>' + content + '</script><script>window.INLINE_PHOTOS=' + inline_photos + ';</script><script>' + app + '</script>'
html = html.replace('<script src="content.js"></script><script src="app.js"></script>', script)
assert '<script src=' not in html and 'href="style.css"' not in html
assert 'assets/photos.json' not in html
output = workspace / 'seville-guide/seville-cathedral-pocket-guide.html'
output.parent.mkdir(exist_ok=True)
output.write_text(html, encoding='utf-8')
print(json.dumps({'file': str(output), 'bytes': output.stat().st_size, 'embedded_photo_records': len(photos)}))
