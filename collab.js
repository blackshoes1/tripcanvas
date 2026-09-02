// Trip Canvas — 함께하기(협업) 순수 로직 (DOM·네트워크·현재시각 접근 없음)
//
// 여기 있는 것은 **판정과 표현**뿐이다. 접근 제어의 진짜 경계는 DB(RLS·RPC)에 있고,
// 이 모듈은 그 결과를 화면에 어떻게 보이게 할지, 어떤 버튼을 감출지, 초대 링크를 어떻게
// 만들고 읽을지를 정한다. 여기서 '편집 가능'이라 해도 서버가 거절하면 그게 답이다.
// @ts-check
(function(root){
  'use strict';

  /** @typedef {'OWNER'|'EDITOR'|'VIEWER'} Role */
  /** @typedef {{id?:number|string,user_id?:string,role?:string,status?:string,display_name?:string|null,joined_at?:string|null,me?:boolean}} MemberRow */
  /** @typedef {{client_id?:string,role?:string,member_count?:number,owner?:boolean}} RoleRow */
  /** @typedef {{valid?:boolean,reason?:string|null,trip_name?:string|null,start_date?:string|null,day_count?:number|null,role?:string|null,expires_at?:string|null,already_member?:boolean}} InvitePreview */

  const ROLES = Object.freeze(['OWNER','EDITOR','VIEWER']);
  const ROLE_LABEL = Object.freeze({OWNER:'주최자', EDITOR:'편집', VIEWER:'보기'});
  const ROLE_ICON = Object.freeze({OWNER:'👑', EDITOR:'✏️', VIEWER:'👀'});
  const COLLAB_CFG = Object.freeze({
    inviteHours: 168,      // 초대 링크 기본 유효기간 — 7일. 영원한 링크는 만들지 않는다
    inviteMaxHours: 720,   // 30일
    nameMax: 40,           // 이 여행에서 보일 이름 최대 길이 (서버도 같은 값으로 자른다)
    tokenMin: 16, tokenMax: 128
  });
  /** 초대가 왜 안 되는지 — 서버 reason 코드 → 사람 말 */
  /** @type {Readonly<Record<string,string>>} */
  const JOIN_REASON = Object.freeze({
    OK: '',
    INVALID: '초대 링크가 올바르지 않아요. 보낸 사람에게 다시 받아 주세요',
    EXPIRED: '초대 링크가 만료됐어요. 보낸 사람에게 새 링크를 받아 주세요',
    REVOKED: '취소된 초대 링크예요. 보낸 사람에게 새 링크를 받아 주세요',
    EXHAUSTED: '이 링크는 사용 한도에 도달했어요. 보낸 사람에게 새 링크를 받아 주세요',
    TRIP_DELETED: '그 여행은 삭제됐어요',
    REMOVED: '이 여행에서 내보내진 뒤라 이 링크로는 다시 참여할 수 없어요. 새 링크를 받아 주세요',
    NETWORK: '초대 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요'
  });

  // ── 역할 ────────────────────────────────────────────────────────────────

  /** @param {unknown} role @returns {Role|null} */
  function normRole(role){
    const r = String(role==null?'':role).trim().toUpperCase();
    return /** @type {Role|null} */(ROLES.indexOf(r)>=0 ? r : null);
  }
  /** 일정을 바꿀 수 있는가 — 소유자와 편집자. @param {unknown} role */
  function canEdit(role){ const r=normRole(role); return r==='OWNER' || r==='EDITOR'; }
  /** 멤버·초대를 관리할 수 있는가 — 소유자만. @param {unknown} role */
  function canManage(role){ return normRole(role)==='OWNER'; }
  /** 여행에서 나갈 수 있는가 — 소유자는 못 나간다(§71). @param {unknown} role */
  function canLeave(role){ const r=normRole(role); return r==='EDITOR' || r==='VIEWER'; }
  /** 여행을 삭제할 수 있는가 — 소유자만. @param {unknown} role */
  function canDelete(role){ return normRole(role)==='OWNER'; }
  /** @param {unknown} role */
  function roleLabel(role){ const r=normRole(role); return r? ROLE_LABEL[r] : '멤버'; }
  /** @param {unknown} role */
  function roleIcon(role){ const r=normRole(role); return r? ROLE_ICON[r] : '👤'; }

  /**
   * 이 기기에서 이 여행을 어떤 역할로 다루는가.
   * 로그아웃 상태·역할 정보가 없는 여행(로컬 전용)은 **소유자**다 — 혼자 쓰는 여행은 지금까지처럼 전부 된다(§95).
   * @param {Record<string, RoleRow>|null|undefined} roles  my_trip_roles 결과를 client_id로 인덱싱한 것
   * @param {string} clientId
   * @param {boolean} signedIn
   * @returns {Role}
   */
  function roleOf(roles, clientId, signedIn){
    if(!signedIn || !roles) return 'OWNER';
    const row = roles[clientId];
    return (row && normRole(row.role)) || 'OWNER';
  }

  /**
   * my_trip_roles 행들 → client_id 인덱스. 같은 client_id가 둘이면(내 것 + 공유받은 것) 소유한 쪽이 이긴다.
   * @param {RoleRow[]|null|undefined} rows
   * @returns {Record<string, {role:Role, count:number, owner:boolean}>}
   */
  function tripRoleMap(rows){
    /** @type {Record<string, {role:Role, count:number, owner:boolean}>} */ const out={};
    (rows||[]).forEach((r)=>{
      if(!r || !r.client_id) return;
      const role=normRole(r.role); if(!role) return;
      const id=String(r.client_id);
      if(out[id] && out[id].owner && !r.owner) return;
      out[id]={role, count:Math.max(1, Math.round(Number(r.member_count)||1)), owner:!!r.owner};
    });
    return out;
  }

  // ── 멤버 표현 ───────────────────────────────────────────────────────────

  /**
   * 멤버 한 사람의 표시 이름. 계정 정보는 여행에 노출하지 않으므로(§69) 이름이 없으면 역할로 부른다.
   * @param {MemberRow|null|undefined} m
   */
  function memberName(m){
    if(!m) return '멤버';
    const name=String(m.display_name==null?'':m.display_name).trim();
    if(name) return name.slice(0, COLLAB_CFG.nameMax);
    return normRole(m.role)==='OWNER' ? '주최자' : '멤버';
  }

  /**
   * 이메일에서 기본 표시 이름을 만든다(참여 화면의 프리필). 도메인은 버린다.
   * @param {string|null|undefined} email
   */
  function displayNameFromEmail(email){
    const local=String(email||'').split('@')[0].trim();
    return local.slice(0, COLLAB_CFG.nameMax);
  }

  /**
   * 멤버 목록 요약 — 헤더 배지와 목록 뱃지에 쓴다.
   * @param {MemberRow[]|null|undefined} members
   * @returns {{total:number, owners:number, editors:number, viewers:number, names:string[]}}
   */
  function memberSummary(members){
    const active=(members||[]).filter((m)=>m && (m.status==null || m.status==='ACTIVE'));
    /** @param {Role} role */
    const by=(role)=>active.filter((m)=>normRole(m.role)===role).length;
    return {total:active.length, owners:by('OWNER'), editors:by('EDITOR'), viewers:by('VIEWER'), names:active.map(memberName)};
  }

  // ── 초대 링크 ───────────────────────────────────────────────────────────

  /**
   * 초대 링크. 토큰만 싣는다 — 여행 id·역할·만료는 서버가 토큰으로 찾는다(URL에 넣으면 조작·유출만 늘어난다).
   * @param {string} pageUrl  location.href (해시는 버린다)
   * @param {string} token
   */
  function buildInviteLink(pageUrl, token){
    const base=String(pageUrl||'').split('#')[0];
    return base + '#join=' + encodeURIComponent(String(token||''));
  }

  /**
   * #join=… 해시에서 토큰을 꺼낸다. 형식이 어긋나면 null — 서버에 아무 문자열이나 보내지 않는다.
   * @param {string|null|undefined} hash
   * @returns {string|null}
   */
  function parseJoinHash(hash){
    const m=/^#join=([^&]+)$/.exec(String(hash||''));
    if(!m) return null;
    let token='';
    try{ token=decodeURIComponent(m[1]); }catch(_){ return null; }
    if(token.length<COLLAB_CFG.tokenMin || token.length>COLLAB_CFG.tokenMax) return null;
    return /^[A-Za-z0-9_-]+$/.test(token) ? token : null;
  }

  /**
   * 초대 미리보기 → 화면 판정. 서버가 valid=false로 준 이유를 사람 말로 옮긴다.
   * @param {InvitePreview|null|undefined} preview
   * @returns {{ok:boolean, reason:string, text:string, alreadyMember:boolean, role:Role|null}}
   */
  function inviteVerdict(preview){
    if(!preview) return {ok:false, reason:'NETWORK', text:JOIN_REASON.NETWORK, alreadyMember:false, role:null};
    const reason=String(preview.reason||(preview.valid?'OK':'INVALID')).toUpperCase();
    const role=normRole(preview.role);
    if(preview.already_member) return {ok:true, reason:'OK', text:'이미 이 여행에 참여하고 있어요', alreadyMember:true, role};
    if(!preview.valid) return {ok:false, reason, text:JOIN_REASON[reason]||JOIN_REASON.INVALID, alreadyMember:false, role};
    return {ok:true, reason:'OK', text:'', alreadyMember:false, role};
  }

  /** @param {string|null|undefined} reason */
  function joinReasonText(reason){
    const key=String(reason||'').toUpperCase();
    return JOIN_REASON[key] || JOIN_REASON.INVALID;
  }

  /**
   * "10/25 ~ 11/7 · 14일" — 초대 카드의 한 줄. 시작일이 없으면 일수만.
   * @param {string|null|undefined} start  YYYY-MM-DD
   * @param {number|null|undefined} dayCount
   */
  function inviteRangeText(start, dayCount){
    const n=Math.max(0, Math.round(Number(dayCount)||0));
    const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(start||''));
    if(!m) return n? `${n}일` : '';
    const d0=new Date(Date.UTC(+m[1], +m[2]-1, +m[3]));
    const d1=new Date(d0.getTime() + Math.max(0,n-1)*86400000);
    /** @param {Date} d */
    const f=(d)=>`${d.getUTCMonth()+1}/${d.getUTCDate()}`;
    return n>1 ? `${f(d0)} ~ ${f(d1)} · ${n}일` : `${f(d0)}${n?` · ${n}일`:''}`;
  }

  // ── 오류 판별 ───────────────────────────────────────────────────────────

  /**
   * 서버가 권한으로 거절했는가 — PostgREST는 42501을 403으로 보내고 supabase-js는 error.code에 담는다.
   * 재시도해도 소용없는 오류라 호출측은 재시도 루프에 넣지 않는다.
   * @param {unknown} err
   */
  function isForbiddenError(err){
    if(!err || typeof err!=='object') return false;
    const e=/** @type {{code?:unknown,status?:unknown,message?:unknown,hint?:unknown}} */(err);
    if(String(e.code||'')==='42501') return true;
    if(Number(e.status)===403) return true;
    return /TRIP_FORBIDDEN|OWNER_CANNOT_LEAVE|OWNER_LOCKED|permission denied/i.test(String(e.message||''));
  }

  /**
   * 권한 오류를 사용자 문장으로. 서버 hint(왜 막았는지)를 우선한다.
   * @param {unknown} err
   * @param {Role|null|undefined} role
   */
  function forbiddenText(err, role){
    const e=/** @type {{hint?:unknown,message?:unknown}} */(err||{});
    const msg=String(e.message||'');
    if(/OWNER_CANNOT_LEAVE/.test(msg)) return '주최자는 여행을 나갈 수 없어요 — 여행을 삭제하거나 다른 사람에게 넘겨 주세요';
    if(/LEFT|REMOVED|나갔거나/.test(String(e.hint||''))) return '이 여행에 대한 권한이 없어요 — 나갔거나 내보내졌어요. 이 기기의 사본은 그대로 남아 있습니다';
    if(normRole(role)==='VIEWER') return '보기 권한이라 저장할 수 없어요 — 주최자에게 편집 권한을 요청하세요';
    return '이 여행을 바꿀 권한이 없어요';
  }

  const API={ROLES, ROLE_LABEL, COLLAB_CFG, JOIN_REASON,
    normRole, canEdit, canManage, canLeave, canDelete, roleLabel, roleIcon, roleOf, tripRoleMap,
    memberName, displayNameFromEmail, memberSummary,
    buildInviteLink, parseJoinHash, inviteVerdict, joinReasonText, inviteRangeText,
    isForbiddenError, forbiddenText};
  if(typeof module!=='undefined' && module.exports) module.exports=API;   // Node (테스트)
  else /** @type {any} */(root).TC_COLLAB=API;                            // 브라우저 전역
})(typeof window!=='undefined'?window:globalThis);
