'use strict';
// ⚠️ 2026-09-04 NAS 전환으로 **스케줄을 껐다**(vercel.json의 crons 제거). 이 함수는 Supabase의 trips를
// 읽고 hotel_price_snapshots에 쓰는데, 그 둘은 이제 진실이 아니다 — 여행도 관측도 NAS PostgreSQL에 있다.
// 켠 채 두면 멈춘 데이터를 조회해 아무도 읽지 않는 곳에 쌓는다. 서버 쪽 추적은 새 backend에
// 서비스 계정 경로(내부 전용 라우트 + CRON_SECRET)로 다시 만든다. 그때까지는 앱의 하루 1회 확인이 대신한다.
//
// 주기 가격 추적 (Vercel Cron이 매일 호출) — 활성 호텔 예약만 골라 메타서치를 돌리고
// 결과를 hotel_price_snapshots에 남긴다. 클라이언트는 로그인 시 이 기록을 당겨와 로컬 기록과 합친다.
// 필요한 env(CRON_SECRET·SUPABASE_SERVICE_ROLE_KEY·HOTEL_METASEARCH_API_KEY)가 없으면 조용히 skip —
// 앱은 클라이언트 쪽 하루 1회 확인으로 계속 동작한다. (비용 제어: 실행당 상한·당일 중복 제외·요청 공유)

const { runSearch } = require('./hotel-offers.js');
const P = require('../price.js');

const MAX_PER_RUN = 8;                 // 실행당 예약 상한 (메타서치 호출 비용·함수 시간 제한)
const OFFERS_KEPT = 10;                // snapshot에 남기는 오퍼 수 (raw 응답 장기 보관 금지 — §28)

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// 일정에서 이 예약이 연결된 🏠 숙소 스팟을 찾아 호텔 identity를 만든다 (클라이언트 identityForBooking과 동일 규칙)
function identityOf(tripData, booking) {
  for (const day of (tripData && tripData.days) || []) {
    for (const spot of (day && day.spots) || []) {
      if (spot && spot.bookingId === booking.id) {
        return { name: spot.name || booking.title, placeId: spot.placeId, lat: spot.lat, lng: spot.lng };
      }
    }
  }
  return { name: booking.title };
}

// P1-1: 오래 확인되지 않은 예약 우선 — 고정 순서 slice(0,N)은 매일 같은 앞 예약만 처리해
// 뒤 예약이 영영 조회되지 않는 starvation을 만든다. 마지막 관측이 오래된(없으면 최우선) 순으로 정렬하고,
// 같으면 체크인이 임박한 예약을 앞세운다.
function orderJobs(jobs, lastAt) {
  const at = booking => (lastAt && lastAt.get(booking.id)) || '';
  return jobs.slice().sort((a, b) => {
    const la = at(a.booking), lb = at(b.booking);
    if (la !== lb) return la < lb ? -1 : 1;
    return String(a.booking.start || '').localeCompare(String(b.booking.start || ''));
  });
}

function dueBookings(rows, today) {
  const jobs = [];
  for (const row of rows || []) {
    const data = row && row.data;
    for (const b of (data && data.bookings) || []) {
      if (!b || b.type !== 'hotel' || b.track === false) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(b.end || '')) continue;
      if (b.end <= today || b.start < today) continue;   // 숙박 시작 전(§25 trip 시작 전)만 추적
      jobs.push({ userId: row.user_id, tripId: row.client_id, booking: b, identity: identityOf(data, b) });
    }
  }
  return jobs;
}

function createHandler({ fetchImpl = globalThis.fetch, env = process.env } = {}) {
  return async function handler(req, res) {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { error: 'method_not_allowed' }); }
    const secret = env.CRON_SECRET;
    if (!secret) return send(res, 200, { skipped: true, reason: 'not_configured' });   // secret 없이는 공개 호출로 비용만 태울 수 있어 실행하지 않음
    if ((req.headers && req.headers.authorization) !== `Bearer ${secret}`) return send(res, 401, { error: 'unauthorized' });

    const supaUrl = env.SUPABASE_URL || 'https://gdnhrwtfidjimtabgovh.supabase.co';
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey || !env.HOTEL_METASEARCH_API_KEY) return send(res, 200, { skipped: true, reason: 'not_configured' });
    const supa = (path, init) => fetchImpl(`${supaUrl}/rest/v1/${path}`, {
      ...init, headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json', ...(init && init.headers) }
    });

    const today = new Date().toISOString().slice(0, 10);
    const errors = [];
    let checked = 0;
    try {
      const tripsRes = await supa('trips?select=user_id,client_id,data&deleted_at=is.null');
      if (!tripsRes.ok) return send(res, 502, { error: 'db_read_failed' });
      const rows = await tripsRes.json();
      const doneRes = await supa(`hotel_price_snapshots?select=booking_id&observed_at=gte.${today}`);
      const done = new Set(doneRes.ok ? (await doneRes.json()).map(r => r.booking_id) : []);
      // 최근 14일 관측 시각으로 '누가 오래 굶었는지'를 판단 (P1-1). 조회 실패 시 빈 맵 — 정렬만 무작위해질 뿐 실행은 계속.
      const since = new Date(Date.now() - 14 * 864e5).toISOString();
      const lastRes = await supa(`hotel_price_snapshots?select=booking_id,observed_at&observed_at=gte.${since}&order=observed_at.asc`);
      const lastAt = new Map();
      if (lastRes.ok) for (const r of await lastRes.json()) lastAt.set(r.booking_id, r.observed_at);   // asc → 마지막 대입이 최신

      const jobs = orderJobs(dueBookings(rows, today).filter(j => !done.has(j.booking.id)), lastAt).slice(0, MAX_PER_RUN);
      const cycle = new Map();   // 같은 호텔·날짜·인원은 이번 사이클에서 결과 공유 (§39)
      for (const job of jobs) {
        const b = job.booking;
        const request = {
          name: job.identity.name, placeId: job.identity.placeId, lat: job.identity.lat, lng: job.identity.lng,
          ptoken: b.ptoken, checkIn: b.start, checkOut: b.end,
          adults: b.adults || 2, rooms: b.rooms || 1, currency: b.cur || 'KRW', country: 'kr', language: 'ko'
        };
        const key = [request.ptoken || request.placeId || request.name, request.checkIn, request.checkOut, request.adults, request.rooms, request.currency].join('|');
        try {
          const result = cycle.get(key) || await runSearch({ env, fetchImpl }, request);
          cycle.set(key, result);
          if (result.unmatched) { errors.push('UNMATCHED'); continue; }
          // P0-1: 응답 basis(1실 고정)와 예약 객실 수가 다르면 확정 등급 금지 — 클라이언트와 같은 규칙
          const basis = result.basis || { rooms: 1 };
          const offers = result.offers.map(o => ({ ...o, quality: P.qualityWithBasis(P.matchQuality(b, o), b, basis) }));
          const decided = P.decideSaving(b, offers, { today });
          const top = decided.confirmed ? decided.confirmed.offer
            : (decided.potential ? decided.potential.offer : offers[0]);
          const insert = await supa('hotel_price_snapshots', {
            method: 'POST', headers: { prefer: 'return=minimal' },
            body: JSON.stringify({
              user_id: job.userId, trip_client_id: job.tripId, booking_id: b.id,
              seller: top.seller, price: P.offerPrice(top), currency: b.cur || 'KRW',
              quality: top.quality || 'SIMILAR', verified: !!top.verified,
              ptoken: (result.property && result.property.token) || b.ptoken || null,
              offers: offers.slice(0, OFFERS_KEPT)
            })
          });
          if (!insert.ok) errors.push('DB_WRITE');
          else checked += 1;
        } catch (error) { errors.push((error && error.code) || 'PROVIDER_ERROR'); }   // 한 예약 실패가 전체를 멈추지 않는다 (§35)
      }
      return send(res, 200, { checked, candidates: jobs.length, errors });
    } catch (_) {
      return send(res, 502, { error: 'tracking_failed', checked, errors });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports._private = { dueBookings, identityOf, orderJobs };
