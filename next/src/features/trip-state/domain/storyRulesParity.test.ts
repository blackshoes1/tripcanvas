// `stories.js`(With J 이야기)의 규칙을 픽스처로 굳혀 iOS 복사본(`StoryRules.swift`)과 맞춘다.
//
// 이야기는 여행 문서·API와 무관한 정적 콘텐츠라(NAS가 꺼져도 들린다) 앱이 서버를 거치지 않고 카탈로그를
// 직접 받아 장소에 붙인다 — '판단은 서버에서'의 예외다. 그래서 복사본이 생겼고, 복사본은 조용히 갈라진다.
// ⚠️ 규칙을 바꾸려면 `stories.js`를 먼저 고친다. 그러면 이 테스트가 픽스처를 새로 쓰고 iOS 테스트
//    (`StoryRulesParityTests.swift`)가 깨진다 — 그게 목적이다.
// ⚠️ 카탈로그는 **지어낸 것**이다. 배포되는 `stories/catalog.json`을 넣으면 음성을 낼 때마다 픽스처가 바뀌어
//    macOS CI가 돈다(규칙은 그대로인데).
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import stories from '@legacy/stories.js';

import { writeFixture } from './parityFiles';

const FIXTURE = path.join(__dirname, '../../../../../ios/TripCanvasTests/Fixtures/story-rules.json');

const SHA = 'a'.repeat(64);
const track = (over: Record<string, unknown> = {}) => ({
  id: 'core', role: 'CORE', title: '핵심', src: 'seville/x.mp3', seconds: 90, bytes: 700000, sha256: SHA,
  sources: ['P01'], reviewedAt: '2026-10-22', ...over
});

/** 받을 수 있는 모양과 버려야 할 모양을 섞은 카탈로그. */
const CATALOG = {
  version: 1,
  updated: '2026-10-27',
  places: [
    { id: 'seville-plaza-espana', kind: 'PLACE', name: '스페인 광장', localName: 'Plaza de España', city: '세비야',
      lat: 37.3772, lng: -5.9869, radiusM: 300, aliases: ['세비야 스페인 광장', ''], placeIds: ['ChIJ_plaza_sevilla'],
      tracks: [
        track({ id: 'more', role: 'MORE', title: '더 듣기', src: 'seville/plaza-more.mp3', sources: ['P01', 'X99', 'P02'] }),
        track({ id: 'core', src: 'seville/plaza-core.mp3', seconds: 90.5, bytes: 1000.4, sha256: 'B'.repeat(64) }),
        track({ id: 'core', title: '같은 id는 앞의 것만' })
      ] },
    { id: 'seville-alcazar', kind: 'PLACE', name: '레알 알카사르', localName: '  Real Alcázar de Sevilla ﻿', city: '세비야',
      lat: 37.3831, lng: -5.9903, radiusM: 300, aliases: ['알카사르', 'Real Alcázar', 'Alcázar de Sevilla'], placeIds: [],
      tracks: [
        track({ src: 'seville/alcazar-core.mp3' }),
        track({ id: 'evil-up', src: '../secret.mp3' }),
        track({ id: 'evil-url', src: 'https://evil.example/x.mp3' }),
        track({ id: 'upper', src: 'Seville/X.mp3' }),
        track({ id: 'badsha', sha256: 'xyz' }),
        track({ id: 'unreviewed', reviewedAt: null }),
        track({ id: 'blankreview', reviewedAt: '   ' }),
        track({ id: 'zero', seconds: 0 }),
        track({ id: 'textsec', seconds: '90' }),
        track({ id: 'bonus', role: 'BONUS' }),
        track({ id: 'stop-no-n', role: 'STOP' }),
        track({ id: 'stop-half', role: 'STOP', stop: { n: 1.5 } })
      ] },
    { id: 'seville-cathedral', kind: 'PLACE', name: '세비야 대성당', localName: 'Catedral de Sevilla', city: '세비야',
      lat: 37.3858, lng: -5.9931, radiusM: 250, aliases: ['대성당', 'Catedral de Sevilla', '히랄다'], placeIds: [],
      tracks: [
        track({ id: 's3', role: 'STOP', title: '지점 3', src: 'seville/cathedral-03.mp3', stop: { n: 3, find: ['금빛', '', '제단', '넷', '다섯', '여섯'], localName: 'Retablo Mayor' } }),
        track({ id: 's1', role: 'STOP', title: '지점 1', src: 'seville/cathedral-01.mp3', stop: { n: 1, find: [], localName: '' } }),
        track({ id: 's2b', role: 'STOP', title: '지점 2 · 둘째', src: 'seville/cathedral-02b.mp3', stop: { n: 2 } }),
        track({ id: 's2a', role: 'STOP', title: '지점 2 · 첫째', src: 'seville/cathedral-02a.mp3', stop: { n: 2 } }),
        track({ id: 'intro', title: '먼저 들을 것', src: 'seville/cathedral-core.mp3' })
      ] },
    { id: 'seville-city', kind: 'CITY', name: '세비야', lat: 37.3891, lng: -5.9845, radiusM: 8000,
      tracks: [track({ id: 'intro', src: 'seville/city.mp3' })] },
    { id: 'madrid-city', kind: 'CITY', name: '마드리드', lat: 40.4168, lng: -3.7038, radiusM: 10000,
      tracks: [track({ id: 'intro', src: 'madrid/city.mp3' })] },
    { id: 'seville-plaza-espana', kind: 'PLACE', name: '같은 id는 앞의 것만', lat: 37, lng: -5, radiusM: 100, tracks: [track()] },
    { id: 'nothing-to-hear', kind: 'PLACE', name: '들을 것 없음', lat: 37, lng: -5, radiusM: 100, tracks: [track({ reviewedAt: null })] },
    { id: 'too-wide', kind: 'PLACE', name: '너무 넓음', lat: 37, lng: -5, radiusM: 999999, tracks: [track()] },
    { id: 'bad-lat', kind: 'PLACE', name: '위도 밖', lat: 91, lng: -5, radiusM: 100, tracks: [track()] },
    { id: 'text-lat', kind: 'PLACE', name: '글자 위도', lat: '37', lng: -5, radiusM: 100, tracks: [track()] },
    { id: 'area', kind: 'AREA', name: '모르는 종류', lat: 37, lng: -5, radiusM: 100, tracks: [track()] },
    'not-an-object'
  ],
  sources: {
    P01: { title: '세비야 관광청', url: 'https://visitasevilla.es/' },
    P02: { title: '  알카사르 공식  ', url: ' https://www.alcazarsevilla.org/ ' },
    BAD1: { title: 'x', url: 'javascript:alert(1)' },
    BAD2: { title: 'x', url: 'http://plain.example/' },
    BAD3: { title: 'x', url: 'https://has space.example/' },
    BAD4: { title: '', url: 'https://no-title.example/' },
    BAD5: 'not-an-object',
    // 'https://' 바로 뒤의 결합 문자 — 정규식은 코드 단위로 보므로 남는다. 문자 단위로 앞머리를 보면 갈린다.
    P03: { title: '결합 문자', url: 'https://́x.example/' }
  }
};

const NAME_KEYS = [
  'Alcázar de Sevilla', '  Plaza de España, Sevilla! ', '세비야 대성당', 'ＡＢＣ１２３', 'ﬁesta', 'İstanbul',
  'Crème Brûlée', '﻿히랄다 ', "L'Àgora", 'São Paulo', '🎧 대성당', 'Ⅻ세기', '',
  // 어말 시그마 — JS는 단어 끝의 Σ를 ς로, Swift `lowercased()`는 늘 σ로 바꾼다. 둘 다 σ로 접는다.
  'ΟΔΟΣ', 'ΑΚΡΟΠΟΛΙΣ', 'Ακρόπολις', 'ΣΟΦΙΑ'
];

type SpotInput = { name: string; lat?: number | null; lng?: number | null; placeId?: string | null };

const SPOTS: { name: string; spot: SpotInput }[] = [
  { name: 'placeId가 같으면 좌표가 없어도', spot: { name: '광장', placeId: 'ChIJ_plaza_sevilla' } },
  { name: 'placeId 앞뒤 공백은 떼고 본다', spot: { name: '광장', placeId: ' ChIJ_plaza_sevilla ' } },
  { name: '모르는 placeId면 좌표와 이름으로', spot: { name: '스페인 광장', lat: 37.3770, lng: -5.9871, placeId: 'ChIJ_unknown' } },
  { name: '한국어 이름 · 반경 안', spot: { name: '스페인 광장', lat: 37.3770, lng: -5.9871 } },
  { name: '악센트 없는 스페인어', spot: { name: 'Real Alcazar de Sevilla', lat: 37.3829, lng: -5.9905 } },
  { name: '별칭을 담은 이름', spot: { name: '알카사르 궁전', lat: 37.3833, lng: -5.9901 } },
  { name: '이름이 별칭에 담긴 경우', spot: { name: 'Alcázar', lat: 37.3833, lng: -5.9901 } },
  { name: '마드리드 스페인 광장', spot: { name: '스페인 광장', lat: 40.4233, lng: -3.7122 } },
  { name: '세고비아 알카사르', spot: { name: '알카사르', lat: 40.9527, lng: -4.1325 } },
  { name: '좌표 없음', spot: { name: '스페인 광장' } },
  { name: '좌표가 반쪽', spot: { name: '스페인 광장', lat: 37.3772, lng: null } },
  { name: '(0,0)은 위치 없음', spot: { name: '스페인 광장', lat: 0, lng: 0 } },
  { name: '너무 짧은 이름', spot: { name: '광장', lat: 37.3772, lng: -5.9869 } },
  { name: '반경 안이지만 이름이 다르다', spot: { name: 'Bodega Santa Cruz', lat: 37.3850, lng: -5.9910 } },
  { name: '반경이 겹치면 이름이 맞는 쪽', spot: { name: '알카사르', lat: 37.3845, lng: -5.9915 } },
  { name: '대성당', spot: { name: '세비야 대성당', lat: 37.3858, lng: -5.9931 } },
  { name: '히랄다 별칭', spot: { name: '히랄다 탑', lat: 37.3862, lng: -5.9926 } },
  { name: '도시는 장소에 붙지 않는다', spot: { name: '세비야', lat: 37.3891, lng: -5.9845 } },
  { name: '빈 placeId는 없는 것', spot: { name: '스페인 광장', lat: 37.3770, lng: -5.9871, placeId: '   ' } }
];

const CITY_DAYS: { name: string; points: ({ lat: number; lng: number } | null)[] }[] = [
  { name: '위치 없는 장소 다음 세비야', points: [null, { lat: 37.39, lng: -5.99 }] },
  { name: '마드리드', points: [{ lat: 40.4138, lng: -3.6921 }] },
  { name: '첫 위치 장소가 먼저 — 마드리드 다음 세비야', points: [{ lat: 40.4138, lng: -3.6921 }, { lat: 37.39, lng: -5.99 }] },
  { name: '빈 날', points: [] },
  { name: '(0,0)뿐', points: [{ lat: 0, lng: 0 }] },
  { name: '어느 도시에도 없음', points: [{ lat: 41.3874, lng: 2.1686 }] }
];

const SECONDS = [0, 45, 60, 105, 120, 3600, 3720, 3725, -5];
const BYTES = [0, 300, 512, 1536, 820 * 1024, 1048575, 1048576, 1310720, 1468006, 12466752];

describe('With J 이야기 규칙 복사본 — iOS 픽스처', () => {
  it('정규화 · 매칭 · 표기', () => {
    const catalog = stories.normalizeCatalog(CATALOG);
    const toSpot = (s: SpotInput) => ({ name: s.name, lat: s.lat ?? null, lng: s.lng ?? null, placeId: s.placeId ?? null });
    const matches = SPOTS.map((c) => ({ ...c, story: stories.storyForSpot(toSpot(c.spot), catalog)?.id ?? null }));
    const cities = CITY_DAYS.map((c) => ({
      ...c,
      story: stories.cityStoryForDay({ spots: c.points.map((p) => (p ? { name: '장소', ...p } : { name: '메모' })) }, catalog)?.id ?? null
    }));

    // fixture만 있으면 둘 다 같이 틀린 채로 통과할 수 있다 — 원본이 지켜야 할 사실을 여기서 못 박는다.
    expect(catalog.places.map((p) => p.id)).toEqual(['seville-plaza-espana', 'seville-alcazar', 'seville-cathedral', 'seville-city', 'madrid-city']);
    expect(catalog.places[0].tracks.map((t) => t.id)).toEqual(['core', 'more']);
    expect(catalog.places[1].tracks.map((t) => t.id)).toEqual(['core']);
    expect(catalog.places[2].tracks.map((t) => t.id)).toEqual(['intro', 's1', 's2b', 's2a', 's3']);   // 같은 번호는 원래 순서
    expect(Object.keys(catalog.sources).sort()).toEqual(['P01', 'P02', 'P03']);
    expect(stories.nameKey('ΑΚΡΟΠΟΛΙΣ')).toBe(stories.nameKey('Ακρόπολις'));   // 대문자 이름도 별칭에 붙는다
    expect(matches.find((m) => m.name === '마드리드 스페인 광장')?.story).toBeNull();
    expect(matches.find((m) => m.name === '세고비아 알카사르')?.story).toBeNull();
    expect(matches.find((m) => m.name === 'placeId가 같으면 좌표가 없어도')?.story).toBe('seville-plaza-espana');
    expect(stories.sizeText(1310720)).toBe('1.3MB');   // toFixed(1)은 딱 반을 올린다 — printf식 '%.1f'는 1.2를 낸다

    writeFixture(FIXTURE, `${JSON.stringify({
      catalog: CATALOG,
      normalized: catalog,
      nameKeys: NAME_KEYS.map((input) => ({ input, key: stories.nameKey(input) })),
      matches,
      cities,
      durations: SECONDS.map((seconds) => ({ seconds, text: stories.durationText(seconds) })),
      sizes: BYTES.map((bytes) => ({ bytes, text: stories.sizeText(bytes) })),
      placeSources: catalog.places.map((p) => ({ place: p.id, ids: stories.placeSources(p, catalog).map((s) => s.id) }))
    }, null, 2)}\n`);
  });
});
