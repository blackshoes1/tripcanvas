from pathlib import Path
import json
import hashlib

root=Path(__file__).resolve().parent
dist=root/'dist'
photo_path=dist/'assets/photos.json'
if not photo_path.exists():
    photo_path.write_text('{}',encoding='utf-8')
photos=json.loads(photo_path.read_text(encoding='utf-8'))
if 'photos' in photos:
    photos=photos['photos']
for key,photo in photos.items():
    if not isinstance(photo,dict):
        continue
    photo['src']=photo.get('src') or photo.get('path') or photo.get('file') or photo.get('filename')
    if photo['src'] and not photo['src'].startswith('assets/'):
        photo['src']='assets/'+Path(photo['src']).name
    photo['sourceUrl']=photo.get('sourceUrl') or photo.get('source_url') or photo.get('commons_url') or photo.get('page_url')
    photo['licenseUrl']=photo.get('licenseUrl') or photo.get('license_url')
    assert photo['src'] and (dist/photo['src']).is_file(), (key,photo['src'])
    assert photo.get('license') and photo.get('author') and photo['sourceUrl'],key
photo_path.write_text(json.dumps(photos,ensure_ascii=False,indent=2),encoding='utf-8')
paths=['index.html','style.css','content.js','app.js','icon.svg','manifest.webmanifest','assets/photos.json']
paths += [str(p.relative_to(dist)).replace('\\','/') for p in sorted((dist/'assets').glob('*')) if p.is_file() and p.suffix.lower() in {'.jpg','.jpeg','.png','.webp'}]
paths += [str(p.relative_to(dist)).replace('\\','/') for p in sorted((dist/'narration').glob('*.txt'))]
(dist/'cache-files.json').write_text(json.dumps(paths,ensure_ascii=False),encoding='utf-8')
assert len(paths)==len(set(paths))
for path in paths:
    assert (dist/path).is_file(),path
metadata=dict(photos=len(photos),cached_files=len(paths),asset_bytes=sum((dist/p).stat().st_size for p in paths))
(root/'asset-report.json').write_text(json.dumps(metadata,indent=2),encoding='utf-8')
print(json.dumps(metadata))
