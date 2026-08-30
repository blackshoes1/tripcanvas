// 검색 라우팅 검증 — 레거시 routedSearch + doSearch 캐시의 판정을 그대로 지키는지.
// SDK 없이 가짜 provider로 '어디에 물어보는가 · 언제 폴백하는가 · 무결과와 실패를 가르는가 · 무엇을 캐시하는가'만 본다.
import { describe, expect, it, vi } from 'vitest';

import { cacheKeyOf, createRoutedSearch, SEARCH_TTL_MS, type SearchProvider } from './routeSearch';
import type { PlaceResult, SearchError, SearchOutcome } from './types';

const place = (name: string): PlaceResult => ({ name, addr: '', city: '', lat: 1, lng: 2 });
const found = (name: string): SearchOutcome => ({ results: [place(name)], error: null });
const empty: SearchOutcome = { results: [], error: null };
const failed = (error: SearchError): SearchOutcome => ({ results: [], error });

/** 호출을 기록하는 provider */
const spy = (outcome: SearchOutcome | ((q: string) => SearchOutcome)) => {
  const calls: { q: string; near: unknown; limit: number }[] = [];
  const fn: SearchProvider = async (q, near, limit) => {
    calls.push({ q, near, limit });
    return typeof outcome === 'function' ? outcome(q) : outcome;
  };
  return Object.assign(fn, { calls });
};

const SEOUL = { lat: 37.5665, lng: 126.978 };
const BARCELONA = { lat: 41.3874, lng: 2.1686 };

describe('국내/해외 라우팅', () => {
  it('국내 앵커면 카카오에 먼저 묻는다', async () => {
    const kakao = spy(found('경복궁')), google = spy(found('Gyeongbokgung'));
    const { search } = createRoutedSearch({ kakao, google });
    const r = await search('경복궁', { near: SEOUL });
    expect(r.results[0].name).toBe('경복궁');
    expect(kakao.calls).toHaveLength(1);
    expect(google.calls).toHaveLength(0);   // 카카오가 찾았으면 구글은 부르지 않는다
  });

  it('해외 앵커면 한글 질의여도 구글만 부른다', async () => {
    const kakao = spy(found('X')), google = spy(found('Sagrada Familia'));
    const { search } = createRoutedSearch({ kakao, google });
    const r = await search('사그라다 파밀리아', { near: BARCELONA });
    expect(r.results[0].name).toBe('Sagrada Familia');
    expect(kakao.calls).toHaveLength(0);
  });

  it('앵커가 없으면 질의의 한글 여부로 가른다', async () => {
    const kakao = spy(found('성산일출봉')), google = spy(found('Park Guell'));
    const { search } = createRoutedSearch({ kakao, google });
    await search('성산일출봉');
    expect(kakao.calls).toHaveLength(1);
    await search('Park Guell');
    expect(kakao.calls).toHaveLength(1);   // 늘지 않는다 — 영문 질의는 구글로
    expect(google.calls).toHaveLength(1);
  });
});

describe('폴백과 실패 구분', () => {
  it('카카오가 빈손이면 구글로 넘어간다', async () => {
    const kakao = spy(empty), google = spy(found('Gyeongbokgung Palace'));
    const { search } = createRoutedSearch({ kakao, google });
    const r = await search('경복궁', { near: SEOUL });
    expect(r.results[0].name).toBe('Gyeongbokgung Palace');
    expect(google.calls).toHaveLength(1);
  });

  it('둘 다 결과가 없으면 무결과(error:null) — 실패로 오해시키지 않는다', async () => {
    const { search } = createRoutedSearch({ kakao: spy(empty), google: spy(empty) });
    expect(await search('없는장소', { near: SEOUL })).toEqual({ results: [], error: null });
  });

  it('구글 실패 코드가 카카오 실패보다 우선한다 (마지막으로 물어본 쪽의 사유)', async () => {
    const { search } = createRoutedSearch({ kakao: spy(failed('error')), google: spy(failed('auth')) });
    expect(await search('경복궁', { near: SEOUL })).toEqual({ results: [], error: 'auth' });
  });

  it('구글이 무결과면 카카오의 실패 사유를 살려 보고한다', async () => {
    const { search } = createRoutedSearch({ kakao: spy(failed('quota')), google: spy(empty) });
    expect(await search('경복궁', { near: SEOUL })).toEqual({ results: [], error: 'quota' });
  });

  it('카카오가 실패해도 구글이 찾으면 성공이다', async () => {
    const { search } = createRoutedSearch({ kakao: spy(failed('network')), google: spy(found('Gyeongbokgung')) });
    const r = await search('경복궁', { near: SEOUL });
    expect(r.error).toBe(null);
    expect(r.results).toHaveLength(1);
  });

  it('빈 질의는 아무에게도 묻지 않는다', async () => {
    const kakao = spy(found('X')), google = spy(found('Y'));
    const { search } = createRoutedSearch({ kakao, google });
    expect(await search('   ')).toEqual({ results: [], error: null });
    expect(kakao.calls).toHaveLength(0);
    expect(google.calls).toHaveLength(0);
  });
});

describe('단기 캐시', () => {
  it('같은 질의는 2분 안에 다시 묻지 않는다', async () => {
    const google = spy(found('Park Guell'));
    let now = 1000;
    const { search } = createRoutedSearch({ kakao: spy(empty), google, nowMs: () => now });
    await search('Park Guell');
    await search('Park Guell');
    expect(google.calls).toHaveLength(1);

    now += SEARCH_TTL_MS + 1;
    await search('Park Guell');
    expect(google.calls).toHaveLength(2);   // TTL이 지나면 다시 묻는다
  });

  it('실패·무결과는 캐시하지 않는다 — 바로 재시도할 수 있어야 한다', async () => {
    const failing = spy(failed('network'));
    const { search } = createRoutedSearch({ kakao: spy(empty), google: failing });
    await search('Park Guell');
    await search('Park Guell');
    expect(failing.calls).toHaveLength(2);

    const emptyG = spy(empty);
    const s2 = createRoutedSearch({ kakao: spy(empty), google: emptyG }).search;
    await s2('없는곳');
    await s2('없는곳');
    expect(emptyG.calls).toHaveLength(2);
  });

  it('도시가 다르면 다른 검색이다', async () => {
    const google = spy(q => found(q));
    const { search } = createRoutedSearch({ kakao: spy(empty), google });
    await search('cathedral', { cityKey: 'Barcelona' });
    await search('cathedral', { cityKey: 'Sevilla' });
    expect(google.calls).toHaveLength(2);
    await search('cathedral', { cityKey: 'Barcelona' });
    expect(google.calls).toHaveLength(2);   // 첫 조합은 캐시 히트
  });

  it('캐시 키는 공백·대소문자를 무시한다', () => {
    expect(cacheKeyOf('  Park Guell ', ' Barcelona ')).toBe(cacheKeyOf('park guell', 'barcelona'));
    expect(cacheKeyOf('a')).not.toBe(cacheKeyOf('a', 'b'));
  });
});

describe('provider에 넘기는 인자', () => {
  it('앵커와 개수 상한을 그대로 전달한다', async () => {
    const google = spy(found('X'));
    const { search } = createRoutedSearch({ kakao: spy(empty), google });
    await search('Park Guell', { near: BARCELONA, limit: 8 });
    expect(google.calls[0]).toEqual({ q: 'Park Guell', near: BARCELONA, limit: 8 });
  });

  it('개수를 안 주면 5개 (레거시 기본값)', async () => {
    const google = spy(found('X'));
    const { search } = createRoutedSearch({ kakao: spy(empty), google });
    await search('Park Guell');
    expect(google.calls[0].limit).toBe(5);
  });

  it('질의는 앞뒤 공백을 떼고 넘긴다', async () => {
    const google = spy(found('X'));
    const { search } = createRoutedSearch({ kakao: spy(empty), google });
    await search('  Park Guell  ');
    expect(google.calls[0].q).toBe('Park Guell');
  });
});

describe('provider 호출은 순차다', () => {
  it('카카오 결과를 받은 뒤에야 구글을 부른다 (동시 호출로 쿼터를 두 배 쓰지 않게)', async () => {
    const order: string[] = [];
    const kakao: SearchProvider = async () => { order.push('kakao-start'); await Promise.resolve(); order.push('kakao-end'); return empty; };
    const google: SearchProvider = async () => { order.push('google-start'); return found('X'); };
    const { search } = createRoutedSearch({ kakao, google });
    await search('경복궁', { near: SEOUL });
    expect(order).toEqual(['kakao-start', 'kakao-end', 'google-start']);
  });
});

describe('lib 정규화 함수를 그대로 쓴다', () => {
  it('isKoreanSearch 판단이 라우팅을 결정한다', async () => {
    const spyLib = vi.spyOn(await import('@legacy/lib.js').then(m => m.default), 'isKoreanSearch');
    const { search } = createRoutedSearch({ kakao: spy(empty), google: spy(found('X')) });
    await search('경복궁', { near: SEOUL });
    expect(spyLib).toHaveBeenCalledWith('경복궁', SEOUL);
    spyLib.mockRestore();
  });
});
