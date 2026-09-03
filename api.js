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

  /**
   * 여행 동기화 — 예전 sync_trip / tombstone_trip의 **반환 모양을 그대로** 재현한다.
   * app.js의 CAS·충돌 처리는 이 앱에서 가장 위험한 코드다. 한 줄도 바꾸지 않으려고 번역을 여기서 한다.
   *
   *   {applied, conflict, revision, data, deleted_at}
   *
   * 충돌은 오류가 아니라 CAS의 정상적인 결과다 — 서버가 409에 현재 문서를 실어 주면 여기서 행으로 바꾼다.
   * 권한 오류(403)와 그 밖의 실패는 **던진다**: 호출부가 forbidden으로 멈추거나 재시도해야 하기 때문이다.
   */
  const CONFLICT_CODES = ['STALE_VERSION', 'CONFLICT'];

  /**
   * @param {any} error @param {number|null|undefined} fallbackRevision
   * @returns {{applied:boolean,conflict:boolean,revision:number,data:any,deleted_at:string|null}|null}
   */
  function conflictRow(error, fallbackRevision) {
    if (!error || CONFLICT_CODES.indexOf(error.apiCode) < 0) return null;
    const d = error.details || {};
    return {
      applied: false, conflict: true,
      revision: Number(d.revision != null ? d.revision : error.revision) || fallbackRevision || 1,
      data: d.document == null ? null : d.document,
      deleted_at: d.deletedAt == null ? null : String(d.deletedAt)
    };
  }
  /** 오류를 그대로 던진다 — 예전 rpcRow가 그랬듯이 @param {any} error */
  function raise(error) {
    const e = new Error(error.message || '요청이 실패했습니다');
    return Object.assign(e, error);
  }

  const sync = {
    /** 로그인 병합용 전체 조회 — 삭제(tombstone)된 여행까지, 예전 trips select와 같은 행 모양으로 */
    list: async () => {
      const r = await request('GET', '/api/v1/sync/trips');
      if (r.error) return r;
      const rows = (r.data && r.data.trips) || [];
      return { data: rows.map((/** @type {any} */ t) => ({
        client_id: t.id, data: t.document == null ? null : t.document,
        revision: Number(t.revision) || 1, deleted_at: t.deletedAt == null ? null : t.deletedAt,
        updated_at: t.updatedAt
      })), error: null };
    },

    /**
     * sync_trip 자리. revision이 없으면 새로 만들고, 서버에 없으면(404) 만든다 — 예전 RPC의 upsert와 같다.
     * @param {string} tripId @param {any} doc @param {number|null} expectedRevision @param {boolean} force
     */
    save: async (tripId, doc, expectedRevision, force) => {
      const applied = (/** @type {any} */ payload) => ({
        applied: true, conflict: false,
        revision: Number(payload && payload.trip && payload.trip.revision) || 1,
        data: (payload && payload.document) || null, deleted_at: null
      });
      const create = async () => {
        const r = await request('POST', '/api/v1/trips', { trip: doc });
        if (!r.error) return applied(r.data);
        const conflict = conflictRow(r.error, expectedRevision);
        if (conflict) return conflict;
        throw raise(r.error);
      };
      if (expectedRevision == null) return create();

      const r = await request('PUT', '/api/v1/trips/' + seg(tripId), { trip: doc, expectedRevision: expectedRevision, force: !!force });
      if (!r.error) return applied(r.data);
      // 로컬에 revision이 남아 있어도 서버에 그 여행이 없을 수 있다(다른 계정·이관 직후) — 예전 RPC처럼 새로 만든다
      if (r.error.apiCode === 'NOT_FOUND') return create();
      const conflict = conflictRow(r.error, expectedRevision);
      if (conflict) return conflict;
      throw raise(r.error);
    },

    /**
     * tombstone_trip 자리. 서버에 없는 여행을 지우는 것은 성공이다(멱등)
     * @param {string} tripId @param {number|null} expectedRevision
     */
    tombstone: async (tripId, expectedRevision) => {
      const r = await request('DELETE', '/api/v1/trips/' + seg(tripId) + '?expectedRevision=' + encodeURIComponent(String(expectedRevision == null ? 1 : expectedRevision)));
      if (!r.error) {
        return { applied: true, conflict: false, revision: Number(r.data && r.data.revision) || expectedRevision || 1, data: null, deleted_at: null };
      }
      if (r.error.apiCode === 'NOT_FOUND') {
        return { applied: true, conflict: false, revision: expectedRevision || 1, data: null, deleted_at: null };
      }
      const conflict = conflictRow(r.error, expectedRevision);
      if (conflict) return conflict;
      throw raise(r.error);
    }
  };

  /** 내 역할·인원과 어느 실시간을 쓸지 — 로그인 직후·역할 갱신 때 한 번(my_trip_roles 대체) */
  async function me() {
    return request('GET', '/api/v1/me');
  }

  /**
   * 자체 실시간(WebSocket). 서버가 /me에서 쓰라고 한 경우에만 부른다.
   *
   * 규약(server/realtime/hub.ts): 붙으면 첫 프레임으로 AUTH — **토큰을 URL에 싣지 않는다**(프록시·접근 로그에 남는다).
   * READY 뒤에 SUBSCRIBE, 그다음부터 ACTIVITY가 온다. PING에는 PONG으로 답해야 끊기지 않는다.
   * 페이로드는 신호일 뿐이라 내용은 호출측이 API로 다시 읽는다(§41·§45).
   *
   * 거절(4401·4403)은 다시 붙지 않는다 — 재시도해도 같은 답이다. 그냥 끊긴 것은 다시 붙는다.
   * @param {{url:string, tripId:string, getToken:()=>Promise<string|null>, onEvent:(e:any)=>void,
   *          onState:(on:boolean)=>void, socketImpl?:any, retryMs?:number}} options
   */
  function connectRealtime(options) {
    const retryMs = options.retryMs || 3000;
    const Socket = options.socketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    /** @type {any} */ let socket = null;
    /** @type {any} */ let timer = null;
    let stopped = false, attempts = 0;

    /** @param {boolean} on */
    const setState = (on) => { try { options.onState(on); } catch (_) { /* 화면 갱신 실패는 삼킨다 */ } };

    async function open() {
      if (stopped || !Socket) return;
      // 구독이 열리기 전까지는 '실시간'이 아니다 — 호출측이 초기 상태를 추측하지 않게 여기서 알린다
      setState(false);
      const token = await options.getToken();
      if (stopped || !token) { setState(false); return; }   // 로그아웃 상태면 붙지 않는다
      let ws;
      try { ws = new Socket(options.url); } catch (_) { setState(false); schedule(); return; }
      socket = ws;
      ws.onopen = () => { try { ws.send(JSON.stringify({ type: 'AUTH', token: token })); } catch (_) { /* 곧 onclose가 온다 */ } };
      ws.onmessage = (/** @type {any} */ event) => {
        let msg = null;
        try { msg = JSON.parse(String(event && event.data)); } catch (_) { return; }
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'READY') { ws.send(JSON.stringify({ type: 'SUBSCRIBE', tripId: options.tripId })); return; }
        if (msg.type === 'SUBSCRIBED') { attempts = 0; setState(true); return; }
        if (msg.type === 'PING') { ws.send(JSON.stringify({ type: 'PONG' })); return; }
        if (msg.type === 'ERROR') { stopped = true; setState(false); return; }   // 권한·형식 문제는 재시도해도 같다
        if (msg.type === 'ACTIVITY') { try { options.onEvent(msg); } catch (_) { /* 화면 갱신 실패는 삼킨다 */ } }
      };
      ws.onerror = () => { /* onclose가 이어서 온다 */ };
      ws.onclose = () => { socket = null; setState(false); schedule(); };
    }

    function schedule() {
      if (stopped || timer) return;
      attempts += 1;
      // 흔들리는 네트워크에 매달리지 않는다 — 폴백(탭 복귀 pull)이 있으므로 몇 번만 시도한다
      if (attempts > 5) return;
      timer = setTimeout(() => { timer = null; void open(); }, retryMs * Math.min(attempts, 4));
    }

    void open();
    return {
      close() {
        stopped = true;
        if (timer) { clearTimeout(timer); timer = null; }
        const current = socket; socket = null;
        if (current) { try { current.close(1000); } catch (_) { /* 이미 닫힘 */ } }
      }
    };
  }

  const API = { configure, rpc, snapshots, me, sync, realtime: { connect: connectRealtime }, DEFAULT_BASE };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; }   // Node (테스트)
  global.TC_API = API;
})(/** @type {any} */ (typeof globalThis !== 'undefined' ? globalThis : this));
