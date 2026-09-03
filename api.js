// TripCanvas API 클라이언트 (웹) — Supabase SDK 직접 호출을 대신한다(PR12, docs/supabase-migration.md).
//
// 설계 원칙 하나: **호출부의 모양을 바꾸지 않는다.**
//   · `{data, error}`를 돌려준다 — `const {data,error}=await ...` 가 그대로 산다
//   · 권한 오류는 Supabase가 주던 42501/403으로 옮긴다 — collab.js의 isForbiddenError와 app.js의
//     '재시도하지 않는다' 규칙이 손대지 않고 그대로 동작한다
//   · 예외를 던지지 않는다 — 네트워크가 끊겨도 error로 돌려준다
// 덕분에 app.js의 오류 처리·상태 전이를 건드리지 않고 저장소만 바꿔 끼울 수 있다.
//
// 서버가 LEGACY 레지스트리면 이 API가 다시 Supabase를 부른다 — 데이터는 그대로 있고 웹만 앞단을 바꾼 것이다.
(function (global) {
  'use strict';

  const DEFAULT_BASE = 'https://tripcanvas-api.vercel.app';
  let _base = DEFAULT_BASE;
  /** @type {()=>Promise<string|null>} */
  let _getToken = async () => null;
  /** @type {typeof fetch|null} */
  let _fetch = null;

  /**
   * @param {{baseUrl?:string, getToken?:()=>Promise<string|null>, fetchImpl?:typeof fetch}} options
   */
  function configure(options) {
    const o = options || {};
    if (o.baseUrl) _base = String(o.baseUrl).replace(/\/+$/, '');
    if (o.getToken) _getToken = o.getToken;
    if (o.fetchImpl) _fetch = o.fetchImpl;
  }

  /** 경로 조각 — 여행 id에 무엇이 들어와도 경로가 깨지지 않게 @param {unknown} value */
  function seg(value) { return encodeURIComponent(String(value == null ? '' : value)); }

  /**
   * 서버의 오류 계약을 Supabase가 주던 모양으로 옮긴다.
   * FORBIDDEN은 42501로 — 이 값 하나로 기존 권한 처리가 전부 그대로 동작한다.
   * @param {number} status @param {any} body
   */
  function toError(status, body) {
    const b = /** @type {any} */ (body && typeof body === 'object' ? body : {});
    const apiCode = String(b.code || b.error || '');
    const message = String(b.message || `요청이 실패했습니다 (${status})`);
    const forbidden = status === 403 || apiCode === 'FORBIDDEN';
    return {
      code: forbidden ? '42501' : apiCode,
      apiCode: apiCode,
      status: status,
      message: message,
      details: b.details,
      revision: b.revision
    };
  }

  /**
   * @param {string} method @param {string} path @param {any=} body
   * @param {boolean=} anon 로그인 없이도 되는 요청인가 — 초대 미리보기는 로그인 전에 부른다(§6)
   * @returns {Promise<{data:any,error:any}>}
   */
  async function request(method, path, body, anon) {
    const token = await _getToken();
    if (!token && !anon) return { data: null, error: { code: '', apiCode: 'UNAUTHORIZED', status: 401, message: '로그인이 필요합니다.' } };
    const doFetch = _fetch || (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) return { data: null, error: { code: '', apiCode: 'INTERNAL_ERROR', status: 0, message: '이 환경에서는 네트워크를 쓸 수 없습니다.' } };

    let response;
    try {
      /** @type {Record<string,string>} */
      const headers = {};
      if (token) headers.authorization = 'Bearer ' + token;
      if (body !== undefined) headers['content-type'] = 'application/json';
      response = await doFetch(_base + path, {
        method: method,
        headers: headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (e) {
      // 끊긴 네트워크도 호출부에는 error로 보인다 — 예외를 던지지 않는다
      const message = (e instanceof Error && e.message) || '서버에 연결하지 못했습니다.';
      return { data: null, error: { code: '', apiCode: 'NETWORK_ERROR', status: 0, message: message } };
    }

    let payload = null;
    try { payload = await response.json(); } catch (_) { payload = null; }
    if (!response.ok) return { data: null, error: toError(response.status, payload) };
    return { data: payload || {}, error: null };
  }

  /** 응답 봉투에서 예전 RPC가 주던 값만 꺼낸다 @param {string} key */
  const pick = (key) => (/** @type {any} */ payload) => (payload && key in payload ? payload[key] : null);

  /**
   * RPC 이름 → HTTP. 여행 안의 대상(멤버·후보·코멘트·초대)은 경로가 여행 아래에 있어 tripId가 필요하다.
   * @type {Record<string,(args:any,tripId:string|undefined)=>{method:string,path:string,body?:any,unwrap:(p:any)=>any,needsTrip?:boolean,anon?:boolean}>}
   */
  const ROUTES = {
    list_trip_members: (a) => ({ method: 'GET', path: `/api/v1/trips/${seg(a.p_client_id)}/members`, unwrap: pick('members') }),
    manage_trip_member: (a, t) => ({ needsTrip: true, method: 'PATCH', path: `/api/v1/trips/${seg(t)}/members/${seg(a.p_member_id)}`, body: { action: a.p_action, value: a.p_value == null ? null : String(a.p_value) }, unwrap: pick('ok') }),
    leave_trip: (a) => ({ method: 'POST', path: `/api/v1/trips/${seg(a.p_client_id)}/members/leave`, body: {}, unwrap: pick('ok') }),

    list_trip_invites: (a) => ({ method: 'GET', path: `/api/v1/trips/${seg(a.p_client_id)}/invites`, unwrap: pick('invites') }),
    create_trip_invite: (a) => ({ method: 'POST', path: `/api/v1/trips/${seg(a.p_client_id)}/invites`, body: { role: a.p_role, hours: a.p_hours == null ? null : Number(a.p_hours), maxUses: a.p_max_uses == null ? null : Number(a.p_max_uses) }, unwrap: pick('invite') }),
    revoke_trip_invite: (a, t) => ({ needsTrip: true, method: 'DELETE', path: `/api/v1/trips/${seg(t)}/invites/${seg(a.p_invite_id)}`, unwrap: pick('ok') }),
    // 로그인 전에 부른다 — 링크가 유출돼도 이름·기간·역할까지만 보인다(§6)
    invite_preview: (a) => ({ anon: true, method: 'GET', path: `/api/v1/invites/${seg(a.p_token)}`, unwrap: pick('preview') }),
    accept_trip_invite: (a) => ({ method: 'POST', path: `/api/v1/invites/${seg(a.p_token)}/accept`, body: { displayName: a.p_display_name == null ? null : String(a.p_display_name) }, unwrap: pick('result') }),

    list_trip_candidates: (a) => ({ method: 'GET', path: `/api/v1/trips/${seg(a.p_client_id)}/candidates`, unwrap: pick('candidates') }),
    add_trip_candidate: (a) => ({
      method: 'POST', path: `/api/v1/trips/${seg(a.p_client_id)}/candidates`,
      body: { title: a.p_title, place_id: a.p_place_id ?? null, lat: a.p_lat ?? null, lng: a.p_lng ?? null, addr: a.p_addr ?? null, note: a.p_note ?? null, url: a.p_url ?? null },
      unwrap: pick('id')
    }),
    react_to_candidate: (a, t) => ({ needsTrip: true, method: 'PUT', path: `/api/v1/trips/${seg(t)}/candidates/${seg(a.p_candidate_id)}/reaction`, body: { reaction: a.p_reaction == null ? null : String(a.p_reaction) }, unwrap: pick('ok') }),
    manage_trip_candidate: (a, t) => ({ needsTrip: true, method: 'PATCH', path: `/api/v1/trips/${seg(t)}/candidates/${seg(a.p_candidate_id)}`, body: { action: a.p_action, value: a.p_value == null ? null : String(a.p_value) }, unwrap: pick('ok') }),

    list_candidate_comments: (a, t) => ({ needsTrip: true, method: 'GET', path: `/api/v1/trips/${seg(t)}/candidates/${seg(a.p_candidate_id)}/comments`, unwrap: pick('comments') }),
    add_candidate_comment: (a, t) => ({ needsTrip: true, method: 'POST', path: `/api/v1/trips/${seg(t)}/candidates/${seg(a.p_candidate_id)}/comments`, body: { body: a.p_body }, unwrap: pick('id') }),
    delete_candidate_comment: (a, t) => ({ needsTrip: true, method: 'DELETE', path: `/api/v1/trips/${seg(t)}/comments/${seg(a.p_comment_id)}`, unwrap: pick('ok') }),

    list_trip_activity: (a) => ({ method: 'GET', path: `/api/v1/trips/${seg(a.p_client_id)}/activity?limit=${encodeURIComponent(String(a.p_limit || 40))}`, unwrap: pick('activity') }),
    list_trip_preferences: (a) => ({ method: 'GET', path: `/api/v1/trips/${seg(a.p_client_id)}/preferences`, unwrap: pick('preferences') }),
    set_trip_preference: (a) => ({ method: 'PUT', path: `/api/v1/trips/${seg(a.p_client_id)}/preferences`, body: { prefs: a.p_prefs || {} }, unwrap: pick('prefs') })
  };

  /**
   * 예전 `sb.rpc(name, args)` 자리에 그대로 들어간다.
   * @param {string} name @param {any} args @param {string=} tripId 여행 안의 대상일 때 필요
   * @returns {Promise<{data:any,error:any}>}
   */
  async function rpc(name, args, tripId) {
    const build = ROUTES[name];
    if (!build) return { data: null, error: { code: '', apiCode: 'INTERNAL_ERROR', status: 0, message: `알 수 없는 요청입니다: ${name}` } };
    const spec = build(args || {}, tripId);
    if (spec.needsTrip && !tripId) {
      return { data: null, error: { code: '', apiCode: 'INTERNAL_ERROR', status: 0, message: `${name}에는 여행 id가 필요합니다.` } };
    }
    const { data, error } = await request(spec.method, spec.path, spec.body, spec.anon);
    if (error) return { data: null, error: error };
    return { data: spec.unwrap(data), error: null };
  }

  /** 여행 버전 이력 — 예전에는 trip_snapshots 테이블을 직접 읽고 썼다. 오래된 것 정리는 이제 서버가 한다 */
  const snapshots = {
    /** @param {string} tripId @param {string=} name */
    create: async (tripId, name) => {
      const r = await request('POST', `/api/v1/trips/${seg(tripId)}/snapshots`, { name: name == null ? null : String(name) });
      return r.error ? r : { data: r.data.snapshot, error: null };
    },
    /** @param {string} tripId */
    list: async (tripId) => {
      const r = await request('GET', `/api/v1/trips/${seg(tripId)}/snapshots`);
      return r.error ? r : { data: r.data.snapshots || [], error: null };
    },
    /** @param {string} tripId @param {number|string} snapshotId */
    load: async (tripId, snapshotId) => {
      const r = await request('GET', `/api/v1/trips/${seg(tripId)}/snapshots/${seg(snapshotId)}`);
      return r.error ? r : { data: r.data.snapshot, error: null };
    }
  };

  const API = { configure, rpc, snapshots, DEFAULT_BASE };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; }   // Node (테스트)
  global.TC_API = API;
})(/** @type {any} */ (typeof globalThis !== 'undefined' ? globalThis : this));
