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
  /** @typedef {{role?:string}} RoleRow  역할만 보면 되는 것(roleOf) */
  /** @typedef {{id?:string,role?:string,memberCount?:number,owner?:boolean,supabaseTripId?:string|number|null}} MeTripRow  GET /api/v1/me의 여행 한 줄 */
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
   * @param {Record<string, RoleRow>|null|undefined} roles  여행 id로 인덱싱한 역할 맵(tripRoleMap 결과)
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
   * GET /api/v1/me의 여행들 → 여행 id 인덱스. 같은 id가 둘이면(내 것 + 공유받은 것) 소유한 쪽이 이긴다.
   * @param {MeTripRow[]|null|undefined} rows
   * @returns {Record<string, {role:Role, count:number, owner:boolean}>}
   */
  function tripRoleMap(rows){
    /** @type {Record<string, {role:Role, count:number, owner:boolean, serverId:string}>} */ const out={};
    (rows||[]).forEach((r)=>{
      if(!r || !r.id) return;
      const role=normRole(r.role); if(!role) return;
      const id=String(r.id);
      if(out[id] && out[id].owner && !r.owner) return;
      // serverId는 **Supabase 실시간을 쓸 때만** 온다(GET /api/v1/me의 supabaseTripId).
      // 자체 실시간은 client_id로 구독하므로 내부 id가 필요 없고, 서버도 그때는 보내지 않는다.
      out[id]={role, count:Math.max(1, Math.round(Number(r.memberCount)||1)), owner:!!r.owner,
               serverId:String(r.supabaseTripId==null?'':r.supabaseTripId)};
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

  // ── 후보 장소와 반응 (2단계) ────────────────────────────────────────────
  //
  // 여기 있는 것은 **집계와 표현**이다. 합의 점수(§20)는 다음 단계고, 이 단계는
  // "몇 명이 뭐라고 했는가"와 "어디에 의견이 더 필요한가"까지만 말한다.
  // 인기가 많다고 일정에 자동으로 들어가는 일은 없다(§12·§79) — 넣는 것은 언제나 사람이 누른다.

  const REACTIONS = Object.freeze(['MUST','OK','PASS']);
  /** @type {Readonly<Record<string,string>>} */
  const REACTION_LABEL = Object.freeze({MUST:'꼭 가고 싶어요', OK:'괜찮아요', PASS:'이번엔 패스'});
  /** @type {Readonly<Record<string,string>>} */
  const REACTION_ICON = Object.freeze({MUST:'❤️', OK:'👍', PASS:'👋'});
  /** 후보가 지금 어떤 상태인지 — 점수가 아니라 '무엇을 더 하면 되는지'를 가리킨다(§57·§58) */
  /** @type {Readonly<Record<string,string>>} */
  const MOOD_TEXT = Object.freeze({
    NONE:  '아직 아무도 의견을 안 냈어요',
    QUIET: '의견이 더 필요해요',
    SPLIT: '의견이 갈려요',
    COOL:  '아직 끌리는 사람이 없어요',
    LOVED: '다들 좋아해요'
  });

  /** @param {unknown} r @returns {'MUST'|'OK'|'PASS'|null} */
  function normReaction(r){
    const v = String(r==null?'':r).trim().toUpperCase();
    return REACTIONS.indexOf(v)>=0 ? /** @type {'MUST'|'OK'|'PASS'} */(v) : null;
  }

  /** @param {unknown} reaction @returns {string} */
  function reactionLabel(reaction){ const r=normReaction(reaction); return r? REACTION_LABEL[r] : '의견 없음'; }
  /** @param {unknown} reaction @returns {string} */
  function reactionIcon(reaction){ const r=normReaction(reaction); return r? REACTION_ICON[r] : '·'; }

  /** 후보를 낼 수 있는가 — 보기 권한은 의견만 낸다(여행에 내용을 만들지는 않는다) */
  /** @param {unknown} role @returns {boolean} */
  function canPropose(role){ return canEdit(role); }
  /** 반응은 활성 멤버라면 누구나 — 의견을 내는 것은 일정을 바꾸는 것이 아니다 */
  /** @param {unknown} role @returns {boolean} */
  function canReact(role){ return normRole(role)!==null; }
  /** 일정에 넣기·되돌리기는 편집 권한 (여행 문서를 실제로 바꾼다) */
  /** @param {unknown} role @returns {boolean} */
  function canScheduleCandidate(role){ return canEdit(role); }
  /** 후보를 거두는 기준은 역할이 아니라 '누가 냈는가'다 — 낸 사람이나 주최자만 */
  /** @param {unknown} role @param {{mine?:boolean}|null} cand @returns {boolean} */
  function canRemoveCandidate(role, cand){ return !!(cand && cand.mine) || normRole(role)==='OWNER'; }

  /**
   * 반응 집계. 서버가 이미 세어 주지만(must_count 등) 화면이 낙관적으로 바꾼 뒤에도 같은 답이 나와야 해서
   * 여기서 한 번 더 순수하게 센다.
   * @param {{must_count?:number,ok_count?:number,pass_count?:number,reactions?:Array<{reaction?:string}>|null}|null} cand
   * @param {number} [memberCount] 이 여행의 활성 멤버 수 — 몇 명이 아직 말하지 않았는지 알려면 필요하다
   * @returns {{must:number,ok:number,pass:number,voted:number,silent:number,members:number}}
   */
  function tallyReactions(cand, memberCount){
    let must=0, ok=0, pass=0;
    const list = cand && Array.isArray(cand.reactions) ? cand.reactions : null;
    if(list){
      for(const r of list){
        const v = normReaction(r && r.reaction);
        if(v==='MUST') must++; else if(v==='OK') ok++; else if(v==='PASS') pass++;
      }
    } else if(cand){
      must = Math.max(0, Number(cand.must_count)||0);
      ok   = Math.max(0, Number(cand.ok_count)||0);
      pass = Math.max(0, Number(cand.pass_count)||0);
    }
    const voted = must+ok+pass;
    const members = Math.max(Number(memberCount)||0, voted, 1);
    return {must, ok, pass, voted, silent: Math.max(0, members-voted), members};
  }

  /**
   * 이 후보가 지금 어떤 상태인가. 점수가 아니라 **다음에 무엇을 하면 되는지**를 가리키는 이름이다.
   * 순서가 곧 규칙이다: 아무도 말 안 함 → 갈림 → 아무도 안 끌림 → 전원 찬성 → 아직 다 말 안 함.
   * '다들 좋아해요'는 **전원이 의견을 냈고 아무도 패스하지 않았을 때만** 쓴다 — 두 명이 좋다고 넷의 마음을 말하지 않는다.
   * @param {{must_count?:number,ok_count?:number,pass_count?:number,reactions?:Array<{reaction?:string}>|null}|null} cand
   * @param {number} [memberCount]
   * @returns {'NONE'|'SPLIT'|'COOL'|'LOVED'|'QUIET'}
   */
  function candidateMood(cand, memberCount){
    const t = tallyReactions(cand, memberCount);
    if(t.voted===0) return 'NONE';
    if(t.must>0 && t.pass>0) return 'SPLIT';
    if(t.must===0 && t.pass>0) return 'COOL';
    if(t.pass===0 && t.must>0 && t.silent===0) return 'LOVED';
    return 'QUIET';
  }

  /** @param {unknown} mood @returns {string} */
  function moodText(mood){ const m=String(mood||''); return MOOD_TEXT[m] || MOOD_TEXT.QUIET; }

  /** 만든 순으로 가르는 안정 키 — 정렬과 제안이 같은 키를 써서 렌더마다 순서가 흔들리지 않는다 @param {any} c */
  function candKey(c){ return String((c&&c.created_at)||'')+'#'+String((c&&c.id)||''); }

  /**
   * 보드의 세 묶음(§57·§58). '의견 필요'는 **아직 결정하지 못한 것**이지 나쁜 것이 아니다.
   * 일정에 들어간 후보(SCHEDULED)는 따로 뺀다 — 이미 결정된 것을 계속 물어보지 않는다.
   * @param {Array<any>|null} candidates
   * @param {number} [memberCount]
   * @returns {{loved:any[],needsOpinion:any[],resting:any[],scheduled:any[],rejected:any[]}}
   */
  function groupCandidates(candidates, memberCount){
    const loved=[], needsOpinion=[], resting=[], scheduled=[], rejected=[];
    for(const c of (Array.isArray(candidates)?candidates:[])){
      if(!c) continue;
      if(String(c.status||'')==='SCHEDULED'){ scheduled.push(c); continue; }
      if(String(c.status||'')==='REJECTED'){ rejected.push(c); continue; }   // 이번엔 뺀 것 — 의견은 남아 있고 되돌릴 수 있다
      const mood = candidateMood(c, memberCount);
      if(mood==='LOVED') loved.push(c);
      else if(mood==='COOL') resting.push(c);
      else needsOpinion.push(c);   // NONE · QUIET · SPLIT — 사람이 한마디 하면 풀린다
    }
    return {loved, needsOpinion, resting, scheduled, rejected};
  }

  /**
   * 반응 요약 한 줄 — '❤️ 3 · 👍 1'. 0인 것은 쓰지 않는다.
   * @param {any} cand @param {number} [memberCount] @returns {string}
   */
  function reactionSummary(cand, memberCount){
    const t = tallyReactions(cand, memberCount);
    const parts=[];
    if(t.must) parts.push(REACTION_ICON.MUST+' '+t.must);
    if(t.ok)   parts.push(REACTION_ICON.OK+' '+t.ok);
    if(t.pass) parts.push(REACTION_ICON.PASS+' '+t.pass);
    return parts.join(' · ');
  }

  /**
   * 누가 냈는지 — 가볍게. 책임을 묻는 말이 되지 않게 한다(§13).
   * @param {{mine?:boolean,proposed_by_label?:string|null}|null} cand @returns {string}
   */
  function candidateAttribution(cand){
    if(!cand) return '';
    if(cand.mine) return '내가 추가';
    const name = String(cand.proposed_by_label||'').trim();
    return (name || '멤버') + '가 추가';
  }

  /**
   * 화면 정렬. 기본은 최근 순(서버가 주는 순서)이고, 'interest'는 관심이 모인 순이다.
   * **정렬은 표시일 뿐 결정이 아니다** — 위에 있다고 일정에 자동으로 들어가지 않는다(§12).
   * 같은 값이면 만든 순으로 갈라 렌더마다 순서가 흔들리지 않게 한다.
   * @param {Array<any>|null} candidates @param {'recent'|'interest'} [mode] @param {number} [memberCount]
   * @returns {any[]}
   */
  function sortCandidates(candidates, mode, memberCount){
    const list = (Array.isArray(candidates)?candidates:[]).filter(Boolean).slice();
    if(mode!=='interest') return list.sort((a,b)=> candKey(b).localeCompare(candKey(a)));
    return list.sort((a,b)=>{
      const ca=consensusOf(a,memberCount), cb=consensusOf(b,memberCount);
      return (cb.score-ca.score) || (cb.strongSupportCount-ca.strongSupportCount) || candKey(b).localeCompare(candKey(a));
    });
  }

  // ── 코멘트 · 활동 기록 · 실시간 (3단계) ─────────────────────────────────
  //
  // 활동 기록의 **문장**은 여기서 만든다(§39 — 내부 구조를 그대로 노출하지 않는다). 서버는 재료(kind·subject·이름표)만 준다.
  // 실시간 이벤트를 받으면 **무엇을 다시 읽을지**도 여기서 정한다(§41 — payload를 믿지 않고 RPC로 다시 읽는다).

  const ACTIVITY_KINDS = Object.freeze(['MEMBER_JOINED','MEMBER_LEFT','MEMBER_REMOVED',
    'CANDIDATE_PROPOSED','CANDIDATE_SCHEDULED','CANDIDATE_REJECTED','REACTION','COMMENT_ADDED','SCHEDULE_CHANGED','BOOKING_ADDED']);

  /** 코멘트는 의견이다 — 반응과 같은 규칙: 활성 멤버 전원 */
  /** @param {unknown} role @returns {boolean} */
  function canComment(role){ return normRole(role)!==null; }
  /** 지우기는 쓴 사람이나 주최자만 */
  /** @param {unknown} role @param {{mine?:boolean}|null} comment @returns {boolean} */
  function canDeleteComment(role, comment){ return !!(comment && comment.mine) || normRole(role)==='OWNER'; }

  /** 을/를 — 받침이 있으면 '을'. 한글이 아니면 '를'(외국어 상호가 많다) */
  /** @param {unknown} word @returns {string} */
  function objParticle(word){
    const s=String(word==null?'':word); if(!s) return '를';
    const code=s.charCodeAt(s.length-1)-0xAC00;
    if(code<0||code>11171) return '를';
    return (code%28)===0? '를':'을';
  }

  /**
   * 활동 한 건을 사람 말로(§37). 모르는 종류는 빈 문자열 — 화면이 그 줄을 건너뛴다.
   * @param {{kind?:string,mine?:boolean,actor_label?:string|null,member_label?:string|null,subject?:any,count?:number}|null} ev
   * @returns {string}
   */
  function activityText(ev){
    if(!ev) return '';
    const s=(ev.subject&&typeof ev.subject==='object')? ev.subject : {};
    const who = ev.mine? '내가' : (String(ev.actor_label||'').trim()||'멤버')+'님이';
    const member = String(ev.member_label||'').trim()||'멤버';
    const title = String(s.title||'').trim()||'후보';
    const t = title+objParticle(title);
    switch(String(ev.kind||'')){
      case 'MEMBER_JOINED':      return ev.mine? '내가 함께하게 됐어요' : `${member}님이 함께하게 됐어요`;
      case 'MEMBER_LEFT':        return ev.mine? '내가 여행에서 나갔어요' : `${member}님이 여행에서 나갔어요`;
      case 'MEMBER_REMOVED':     return `${who} ${member}님을 내보냈어요`;
      case 'CANDIDATE_PROPOSED': return `${who} ${t} 후보로 담았어요`;
      case 'CANDIDATE_SCHEDULED':return s.ref? `${who} ${t} Day ${s.ref}에 넣었어요` : `${who} ${t} 일정에 넣었어요`;
      case 'CANDIDATE_REJECTED': return `${who} ${t} 이번 일정에서 뺐어요`;
      case 'REACTION': {
        const r=normReaction(s.reaction);
        return r? `${who} ${t} "${REACTION_LABEL[r]}"로 골랐어요` : `${who} ${t} 골랐어요`;
      }
      case 'COMMENT_ADDED': {
        const ex=String(s.excerpt||'').trim();
        return ex? `${who} ${title}에 한마디: “${ex}”` : `${who} ${title}에 한마디 남겼어요`;
      }
      case 'SCHEDULE_CHANGED': { const n=Number(ev.count)||1; return n>1? `${who} 일정을 바꿨어요 (${n}번)` : `${who} 일정을 바꿨어요`; }
      case 'BOOKING_ADDED':    { const n=Number(s.count)||1; return n>1? `${who} 예약 ${n}건을 추가했어요` : `${who} 예약을 추가했어요`; }
      default: return '';
    }
  }

  /** @param {any} a @param {any} b */
  function sameActor(a,b){ return !!a.mine===!!b.mine && String(a.actor_label||'')===String(b.actor_label||''); }

  /**
   * 읽기 쉬운 피드(§38·§39): 서버는 저장마다 한 줄씩 남기지만 화면은 그걸 그대로 보이지 않는다.
   * - 같은 사람의 **연속** 일정 변경은 한 줄로(횟수 표시). 창(windowMs) 안에서만 묶는다.
   * - 같은 사람이 같은 후보에 남긴 반응은 **마지막 것만** — 마음이 바뀐 흔적을 줄줄이 보이지 않는다.
   * 입력·출력 모두 최신순이다. 원본은 건드리지 않는다.
   * @param {Array<any>|null} rows @param {number} [windowMs]
   * @returns {any[]}
   */
  function condenseActivity(rows, windowMs){
    const W = (Number(windowMs)>0)? Number(windowMs) : 10*60*1000;
    /** @type {any[]} */ const out=[]; const seenReact=new Set();
    for(const ev of (Array.isArray(rows)?rows:[])){
      if(!ev) continue;
      const kind=String(ev.kind||'');
      if(kind==='REACTION'){
        const key=`${ev.mine?'me':String(ev.actor_label||'')}#${(ev.subject||{}).candidate_id}`;
        if(seenReact.has(key)) continue; seenReact.add(key);
      }
      const last=out[out.length-1];
      if(kind==='SCHEDULE_CHANGED' && last && last.kind==='SCHEDULE_CHANGED' && sameActor(last,ev)){
        const edge=Date.parse(last.first_at||last.created_at||''), cur=Date.parse(ev.created_at||'');
        if(isFinite(edge)&&isFinite(cur)&&Math.abs(edge-cur)<=W){ last.count=(last.count||1)+1; last.first_at=ev.created_at; continue; }
      }
      out.push(Object.assign({}, ev, kind==='SCHEDULE_CHANGED'? {count:1, first_at:ev.created_at} : {}));
    }
    return out;
  }

  /** '방금' · 'N분 전' · 'N시간 전' · 'N일 전' · 'M/D'. 시각을 모르면 빈 문자열 */
  /** @param {unknown} iso @param {number} [now] @returns {string} */
  function relativeTime(iso, now){
    const t=Date.parse(String(iso==null?'':iso)); if(!isFinite(t)) return '';
    const n=(typeof now==='number')? now : Date.now();
    const d=Math.max(0, n-t);
    if(d<60e3) return '방금';
    if(d<3600e3) return Math.floor(d/60e3)+'분 전';
    if(d<86400e3) return Math.floor(d/3600e3)+'시간 전';
    if(d<7*86400e3) return Math.floor(d/86400e3)+'일 전';
    const dt=new Date(t); return `${dt.getMonth()+1}/${dt.getDate()}`;
  }

  /**
   * 실시간으로 받은 활동 한 건이 화면에 **무엇을 요구하는가**. payload의 내용은 믿지 않는다 —
   * 다시 읽을 것만 고른다(§41). `mine`은 호출측이 actor_id로 계산해 넣는다.
   * - candidates: 후보 보드를 다시 읽는다 (후보·반응·코멘트)
   * - members:    역할·인원을 다시 읽는다
   * - pull:       여행 문서를 당겨온다 — 남의 저장일 때만(내 저장은 이미 내 화면이다)
   * - notify:     조용히 알릴 만한가 — 남이 후보를 담았을 때와 새 멤버가 왔을 때만(§51). 반응·코멘트·일정 변경은 화면 갱신으로 충분하다
   * @param {{kind?:string,mine?:boolean}|null} ev
   * @returns {{candidates:boolean,members:boolean,pull:boolean,activity:boolean,notify:boolean}}
   */
  function liveEffects(ev){
    const kind=String((ev&&ev.kind)||''); const mine=!!(ev&&ev.mine);
    const known=ACTIVITY_KINDS.indexOf(kind)>=0;
    const cand=/^CANDIDATE_|^REACTION$|^COMMENT_ADDED$/.test(kind);
    const mem=/^MEMBER_/.test(kind);
    const doc=kind==='SCHEDULE_CHANGED'||kind==='BOOKING_ADDED';
    return {candidates:cand, members:mem, pull:doc&&!mine, activity:known,
            notify:!mine&&(kind==='CANDIDATE_PROPOSED'||kind==='MEMBER_JOINED')};
  }

  // ── 여행 취향 · 그룹 컨텍스트 · 합의 (4단계) ─────────────────────────────
  //
  // 취향은 **이 여행에 대한** 것이다(§18) — 고정 프로필이 아니다. 선택형이 기본(§16).
  // 그룹 컨텍스트(§19)와 합의(§20~§22)는 여기서 계산한다. 점수는 내부값이고 **사용자에게는 문장만** 보인다(§21·§22).
  // 결정은 하지 않는다(§62) — "의견이 갈려 있어요"까지만 말하고 자동으로 빼지 않는다(§23).

  /** @typedef {{pace?:'RELAXED'|'NORMAL'|'PACKED', walking?:'LOW'|'NORMAL'|'HIGH', morning?:boolean, night?:boolean, interests?:string[], dislikes?:string[], note?:string}} Prefs */

  const PREF = Object.freeze({
    pace: Object.freeze([['RELAXED','여유롭게'],['NORMAL','보통'],['PACKED','빡빡하게']]),
    walking: Object.freeze([['LOW','많이 걷기 싫어요'],['NORMAL','걷는 건 보통'],['HIGH','많이 걸어도 좋아요']]),
    topics: Object.freeze(['미술관','박물관','자연','야경','맛집','카페','쇼핑','시장','건축','공연','액티비티','휴식']),
    listMax: 12, itemMax: 30, noteMax: 120
  });
  /** @type {Readonly<Record<string,string>>} */
  const PACE_LABEL = Object.freeze({RELAXED:'여유롭게', NORMAL:'보통', PACKED:'빡빡하게'});
  /** @type {Readonly<Record<string,string>>} */
  const WALK_LABEL = Object.freeze({LOW:'많이 걷기 싫어요', NORMAL:'걷는 건 보통', HIGH:'많이 걸어도 좋아요'});
  /** @type {Readonly<Record<string,string>>} */
  const CONSENSUS_TEXT = Object.freeze({
    STRONG_MATCH: '모두가 좋아할 가능성이 높아요',
    GOOD_MATCH:   '괜찮아 보여요 — 반대가 없어요',
    MIXED:        '의견이 조금 갈려요',
    CONFLICT:     '의견이 갈려 있어요'
  });

  /**
   * 화면이 무엇을 보내든 아는 값만 남긴다 — 서버(tc_norm_prefs)와 **같은 규칙**이다. 저장 뒤에는 서버가 돌려준 것이 이긴다.
   * @param {unknown} p @returns {Prefs}
   */
  function normPrefs(p){
    const src = (p && typeof p==='object' && !Array.isArray(p)) ? /** @type {any} */(p) : {};
    /** @type {any} */ const out={};
    if(['RELAXED','NORMAL','PACKED'].indexOf(src.pace)>=0) out.pace=src.pace;
    if(['LOW','NORMAL','HIGH'].indexOf(src.walking)>=0) out.walking=src.walking;
    if(typeof src.morning==='boolean') out.morning=src.morning;
    if(typeof src.night==='boolean') out.night=src.night;
    for(const k of ['interests','dislikes']){
      if(!Array.isArray(src[k])) continue;
      const seen=new Set(); /** @type {string[]} */ const arr=[];
      for(const e of src[k]){
        if(typeof e!=='string') continue;
        const v=e.trim().slice(0,PREF.itemMax); if(!v||seen.has(v)) continue;
        seen.add(v); arr.push(v); if(arr.length>=PREF.listMax) break;
      }
      arr.sort((a,b)=> a<b?-1:a>b?1:0);
      if(arr.length) out[k]=arr;   // 빈 배열은 정보가 없다 — 서버(tc_norm_prefs)도 같다
    }
    const note=String(src.note==null?'':src.note).trim().slice(0,PREF.noteMax); if(note) out.note=note;
    return out;
  }

  /** 취향 한 줄 — '여유롭게 · 많이 걷기 싫어요 · 관심: 미술관, 야경 · 별로: 쇼핑' @param {unknown} p @returns {string} */
  function prefsText(p){
    const q=normPrefs(p); /** @type {string[]} */ const parts=[];
    if(q.pace) parts.push(PACE_LABEL[q.pace]);
    if(q.walking) parts.push(WALK_LABEL[q.walking]);
    if(q.morning===true) parts.push('아침 일찍도 괜찮아요'); else if(q.morning===false) parts.push('아침 일찍은 어려워요');
    if(q.night===true) parts.push('늦은 밤도 좋아요'); else if(q.night===false) parts.push('늦은 밤은 싫어요');
    if(q.interests&&q.interests.length) parts.push('관심: '+q.interests.join(', '));
    if(q.dislikes&&q.dislikes.length) parts.push('별로: '+q.dislikes.join(', '));
    if(q.note) parts.push('“'+q.note+'”');
    return parts.join(' · ');
  }

  /**
   * §19 GroupTravelContext. 여행 전체의 결정은 여기서 하지 않는다 — 어디가 맞고 어디가 갈리는지만 정리한다.
   * - pace: 다수. 동률이면 null. paceSplit: 여유/빡빡이 같이 있으면 true
   * - walking: 답한 사람 중 **가장 낮은** 허용치 — 제약은 가장 약한 사람 기준이다
   * - morningNo/nightNo: 아침 일찍·늦은 밤이 어려운 사람
   * - sharedInterests: 두 명 이상이 고른 관심(빈도순, 같으면 이름순)
   * - conflicts: 한 사람의 관심이 다른 사람의 '별로'에 있는 주제
   * @param {Array<{label?:string|null,mine?:boolean,prefs?:unknown}>|null} rows @param {number} [memberCount]
   */
  function groupContext(rows, memberCount){
    const list=(Array.isArray(rows)?rows:[]).filter(Boolean)
      .map(r=>({name: r.mine?'나':(String(r.label||'').trim()||'멤버'), p: normPrefs(r.prefs)}));
    const answered=list.filter(x=>Object.keys(x.p).length>0);
    const members=Math.max(Number(memberCount)||0, list.length, 1);
    /** @type {Record<string,number>} */ const paceCount={RELAXED:0,NORMAL:0,PACKED:0};
    for(const x of answered) if(x.p.pace) paceCount[x.p.pace]++;
    /** @type {{value:string,count:number}|null} */ let pace=null;
    { const e=Object.entries(paceCount).sort((a,b)=>b[1]-a[1]); if(e[0][1]>0 && e[0][1]>e[1][1]) pace={value:e[0][0], count:e[0][1]}; }
    const paceSplit = paceCount.RELAXED>0 && paceCount.PACKED>0;
    /** @type {Record<string,number>} */ const order={LOW:0,NORMAL:1,HIGH:2};
    /** @type {string|null} */ let walking=null;
    let walkingWho=/** @type {string[]} */([]);
    for(const x of answered){
      if(!x.p.walking) continue;
      if(walking===null || order[x.p.walking]<order[walking]){ walking=x.p.walking; walkingWho=[x.name]; }
      else if(x.p.walking===walking) walkingWho.push(x.name);
    }
    const morningNo=answered.filter(x=>x.p.morning===false).map(x=>x.name);
    const nightNo=answered.filter(x=>x.p.night===false).map(x=>x.name);
    /** @type {Map<string,string[]>} */ const likes=new Map(); /** @type {Map<string,string[]>} */ const dislikes=new Map();
    for(const x of answered){
      for(const t of (x.p.interests||[])) likes.set(t,(likes.get(t)||[]).concat(x.name));
      for(const t of (x.p.dislikes||[])) dislikes.set(t,(dislikes.get(t)||[]).concat(x.name));
    }
    const byCountThenName=(/** @type {[string,string[]]} */a,/** @type {[string,string[]]} */b)=> (b[1].length-a[1].length) || (a[0]<b[0]?-1:a[0]>b[0]?1:0);
    const sharedInterests=[...likes.entries()].filter(([,who])=>who.length>=2).sort(byCountThenName).map(([t])=>t);
    const conflicts=[...likes.entries()].filter(([t])=>dislikes.has(t))
      .map(([t,who])=>({topic:t, likes:who, dislikes:dislikes.get(t)||[]}))
      .sort((a,b)=> a.topic<b.topic?-1:a.topic>b.topic?1:0);
    return {members, answered:answered.length, pace, paceSplit, walking, walkingWho, morningNo, nightNo, sharedInterests, conflicts};
  }

  /** 그룹 요약 문장들(§19·§61의 "현재 의견" 정리). 결정하지 않고 정리만 한다(§62). @param {ReturnType<typeof groupContext>|null} ctx @returns {string[]} */
  function groupContextText(ctx){
    if(!ctx||!ctx.answered) return ['아직 아무도 취향을 남기지 않았어요. 내 취향을 남기면 일행이 참고할 수 있어요.'];
    /** @type {string[]} */ const out=[`${ctx.members}명 중 ${ctx.answered}명이 취향을 남겼어요`];
    if(ctx.paceSplit) out.push('여유롭게 vs 빡빡하게 — 페이스 생각이 갈려요');
    else if(ctx.pace) out.push(`${ctx.pace.count}명이 "${PACE_LABEL[ctx.pace.value]}"를 원해요`);
    if(ctx.walking==='LOW') out.push(`많이 걷기 싫어요 (${ctx.walkingWho.join(', ')}) — 동선은 이 기준으로`);
    if(ctx.morningNo.length) out.push(`아침 일찍은 어려워요 (${ctx.morningNo.join(', ')})`);
    if(ctx.nightNo.length) out.push(`늦은 밤은 싫어요 (${ctx.nightNo.join(', ')})`);
    if(ctx.sharedInterests.length) out.push('함께 관심: '+ctx.sharedInterests.join(', '));
    for(const c of ctx.conflicts) out.push(`${c.topic}: ${c.likes.join(', ')}은(는) 좋고 ${c.dislikes.join(', ')}은(는) 별로예요`);
    return out;
  }

  /**
   * §20~§22 합의. 단순 다수결이 아니다 — MUST와 PASS의 무게가 다르고, 아직 말하지 않은 사람이 있으면 확신을 줄인다.
   * score는 0~100 **내부값**이다. 화면에 숫자를 쓰지 않는다(§21).
   * status: STRONG_MATCH(전원이 말했고 반대 없고 절반 이상이 MUST) · GOOD_MATCH(반대 없음) ·
   *         MIXED(MUST 없이 PASS가 있음) · CONFLICT(MUST와 PASS가 같이) · null(아무도 안 말함)
   * §20의 예: 장소 A(MUST2·OK1·PASS1)는 CONFLICT, 장소 B(MUST1·OK3)는 GOOD_MATCH — B가 위다.
   * @param {any} cand @param {number} [memberCount]
   * @returns {{score:number,strongSupportCount:number,oppositionCount:number,status:'STRONG_MATCH'|'GOOD_MATCH'|'MIXED'|'CONFLICT'|null,voted:number,members:number}}
   */
  function consensusOf(cand, memberCount){
    const t=tallyReactions(cand, memberCount);
    if(t.voted===0) return {score:50, strongSupportCount:0, oppositionCount:0, status:null, voted:0, members:t.members};
    const raw=(t.must + t.ok*0.5 - t.pass)/t.members;          // -1 ~ 1
    let score=50+50*raw;
    score=50+(score-50)*(t.voted/t.members);                     // 아직 안 말한 사람만큼 확신을 줄인다
    score=Math.max(0, Math.min(100, Math.round(score)));
    /** @type {'STRONG_MATCH'|'GOOD_MATCH'|'MIXED'|'CONFLICT'} */ let status;
    if(t.must>0 && t.pass>0) status='CONFLICT';
    else if(t.pass>0) status='MIXED';
    else if(t.must>0 && t.silent===0 && t.must*2>=t.members) status='STRONG_MATCH';
    else status='GOOD_MATCH';
    return {score, strongSupportCount:t.must, oppositionCount:t.pass, status, voted:t.voted, members:t.members};
  }

  /** @param {unknown} status @returns {string} */
  function consensusText(status){ return CONSENSUS_TEXT[String(status||'')] || ''; }

  /**
   * 카드 배지. 두 명 이상이 말했으면 합의 문장(§22), 아니면 '무엇을 더 하면 되는지'(mood). 숫자는 없다.
   * @param {any} cand @param {number} [memberCount] @returns {{text:string,tone:'good'|'split'|'mixed'|'quiet',status:string|null}}
   */
  function candidateVerdict(cand, memberCount){
    const c=consensusOf(cand, memberCount);
    if(c.status && c.voted>=2){
      const tone = (c.status==='STRONG_MATCH'||c.status==='GOOD_MATCH') ? 'good' : c.status==='CONFLICT' ? 'split' : 'mixed';
      return {text:consensusText(c.status), tone, status:c.status};
    }
    const m=candidateMood(cand, memberCount);
    return {text:moodText(m), tone: m==='LOVED'?'good': m==='SPLIT'?'split':'quiet', status:null};
  }

  // ── 충돌과 제안 (5단계) ─────────────────────────────────────────────────
  //
  // 의견이 갈린 후보를 자동으로 빼지 않는다(§23). 선택지를 보여주고(§24) 사람이 고른다.
  // 제안(§28·§29)은 미리보기다 — 반대 없는 후보를 동선(거리)·여유 기준으로 어느 날에 넣을지 정리하고 이유를 붙인다.
  // 시간·운영시간·예약 충돌은 여기서 판단하지 않는다(§63 — 기존 도메인 로직의 몫). 여기는 '어느 날'까지만.

  /** @param {any} cand @param {'MUST'|'OK'|'PASS'} reaction @returns {string[]} */
  function namesBy(cand, reaction){
    /** @type {any[]} */ const list=(cand && Array.isArray(cand.reactions))? cand.reactions : [];
    return list.filter(r=>r && normReaction(r.reaction)===reaction).map(r=> r.me? '나' : (String(r.name||'').trim()||'멤버'));
  }

  /**
   * §23 충돌 탐지 — MUST와 PASS가 같이 있을 때만. 자동 제거는 없다.
   * @param {any} cand @param {number} [memberCount]
   * @returns {{title:string,must:string[],ok:string[],pass:string[]}|null}
   */
  function candidateConflict(cand, memberCount){
    if(!cand) return null;
    if(consensusOf(cand, memberCount).status!=='CONFLICT') return null;
    return {title:String(cand.title||'').trim()||'후보', must:namesBy(cand,'MUST'), ok:namesBy(cand,'OK'), pass:namesBy(cand,'PASS')};
  }

  /**
   * §24 세 선택지. action은 서버 액션(SCHEDULE·REJECT) — 분리(SPLIT)는 다음 단계라 action이 없다(안내만).
   * @param {{title:string,must:string[],pass:string[]}|null} conflict
   * @returns {Array<{key:'TOGETHER'|'SPLIT'|'SKIP',title:string,text:string,action:'SCHEDULE'|'REJECT'|null}>}
   */
  function conflictOptions(conflict){
    if(!conflict) return [];
    const who=(/** @type {string[]} */a)=>a.length? a.join(', ') : '';
    const must=who(conflict.must), pass=who(conflict.pass);
    return [
      {key:'TOGETHER', title:'다 같이 방문', text: pass? `${pass}도 함께 — 짧게 들르는 걸로` : '다 같이 들러요', action:'SCHEDULE'},
      {key:'SPLIT', title:'자유시간으로 분리',
       text: `${must||'원하는 분'}은(는) ${conflict.title} · ${pass||'다른 분'}은(는) 다른 곳 — 분리 일정은 다음 단계에서`, action:null},
      {key:'SKIP', title:'이번 일정에서는 제외', text:'후보에는 남겨 두고 이번엔 빼요 — 언제든 되돌릴 수 있어요', action:'REJECT'}
    ];
  }

  /** 두 좌표 사이 km(하버사인). lib.js에도 있지만 이 모듈은 의존이 없어야 해서 작게 하나 둔다. */
  /** @param {{lat:number,lng:number}} a @param {{lat:number,lng:number}} b @returns {number} */
  function distanceKm(a,b){
    const R=6371, toR=(/** @type {number} */d)=>d*Math.PI/180;
    const dLat=toR(b.lat-a.lat), dLng=toR(b.lng-a.lng);
    const h=Math.sin(dLat/2)**2 + Math.cos(toR(a.lat))*Math.cos(toR(b.lat))*Math.sin(dLng/2)**2;
    return 2*R*Math.asin(Math.sqrt(h));
  }
  /** @param {any} p @returns {p is {lat:number,lng:number}} */
  function hasCoord(p){ return !!p && p.lat!=null && p.lng!=null && isFinite(Number(p.lat)) && isFinite(Number(p.lng)); }

  /**
   * §28·§29 그룹 제안 — **미리보기**다. 반대 없고 두 명 이상이 말한 후보를 골라(합의 점수 순, 최대 max개)
   * 각각 어느 날에 넣을지 정한다: 좌표가 있으면 그 날 마지막 장소에서 가장 가까운 날, 없으면 장소가 가장 적은 날.
   * 같은 입력이면 같은 답이다. 점수는 정렬에만 쓰고 문장에는 없다.
   *
   * **그 날 어디에**는 이 모듈이 정하지 않는다(§63) — 타임라인·운영시간·예약을 아는 것은 일정 도메인이다.
   * `opts.slotOf`를 주면(웹·서버 모두 `adaptive.js`의 `proposalPlacer`를 준다) 시간대까지 말하고,
   * 없거나 자리를 못 찾으면 예전처럼 '어느 날'까지만 말하고 그 날 **맨 뒤**에 붙는다.
   * 자리를 지어내지 않는다 — 모르면 말하지 않는다.
   *
   * @param {any[]|null} candidates
   * @param {Array<{spots?:Array<{name?:string,lat?:number|null,lng?:number|null}|null>}|null>|null} days
   * @param {number} [memberCount] @param {{walking?:string|null}|null} [ctx] @param {number} [max]
   * @param {{slotOf?:((di:number,cand:any,placed:any[])=>any)|null}|null} [opts] 앞의 결정(`placed`)을 함께 받는다 — 두 곳이 같은 틈을 차지하지 않게
   * @returns {{headline:string,picks:Array<{candidate:any,di:number,km:number|null,reasons:string[],slot:any}>}|null}
   */
  function buildGroupProposal(candidates, days, memberCount, ctx, max, opts){
    const limit=(Number(max)>0)? Number(max) : 3;
    const dayList=(Array.isArray(days)?days:[]).map((d,i)=>({di:i, spots:((d&&Array.isArray(d.spots))?d.spots:[]).filter(Boolean)}));
    if(!dayList.length) return null;
    const eligible=(Array.isArray(candidates)?candidates:[]).filter(c=>c && String(c.status||'PROPOSED')==='PROPOSED')
      .map(c=>({c, k:consensusOf(c, memberCount)}))
      .filter(x=>x.k.voted>=2 && (x.k.status==='STRONG_MATCH'||x.k.status==='GOOD_MATCH'))
      .sort((a,b)=>(b.k.score-a.k.score)||(b.k.strongSupportCount-a.k.strongSupportCount)||candKey(b.c).localeCompare(candKey(a.c)));
    const slotOf=(opts&&typeof opts.slotOf==='function')? opts.slotOf : null;
    /** @type {any[]} */ const placed=[];
    /** @type {Array<{candidate:any,di:number,km:number|null,reasons:string[],slot:any}>} */ const picks=[];
    for(const {c,k} of eligible.slice(0,limit)){
      /** @type {{di:number,km:number|null,last:any,score:number,count:number}|null} */ let best=null;
      for(const d of dayList){
        const last=[...d.spots].reverse().find(hasCoord);
        const km=(hasCoord(c)&&last)? distanceKm({lat:+c.lat,lng:+c.lng},{lat:+last.lat,lng:+last.lng}) : null;
        const score= km!=null ? km : 1000+d.spots.length;   // 좌표를 모르면 여유로운 날(장소가 적은 날) — 앞의 날이 먼저
        if(!best || score<best.score) best={di:d.di, km, last, score, count:d.spots.length};
      }
      if(!best) continue;
      // 시간대(§63) — 자리를 찾았을 때만 말한다. 못 찾았으면 그 날 맨 뒤이고, 시각은 말하지 않는다.
      const slot=slotOf? (slotOf(best.di, c, placed)||null) : null;
      if(slot) placed.push(slot);
      /** @type {string[]} */ const reasons=[];
      reasons.push(k.voted>=k.members ? `${k.members}명 모두 관심 있어요 · 반대 없음` : `${k.strongSupportCount}명이 꼭 가고 싶어 해요 · 반대 없음`);
      // 자리가 정해졌으면 자리를 말한다. '마지막 장소에서 몇 km'와 함께 쓰면 두 문장이 서로 다른 곳을 가리켜 헷갈린다.
      if(slot) reasons.push(`Day ${best.di+1} ${slot.segment} ${slot.startText}쯤 · ${slot.afterName? slot.afterName+' 다음' : '그 날 첫 일정으로'}`
        + (slot.travelMin>0 ? ` (이동 약 ${slot.travelMin}분)` : ''));
      else if(best.km!=null) reasons.push(`Day ${best.di+1} 마지막 장소(${String(best.last.name||'장소')})에서 약 ${best.km<10? best.km.toFixed(1) : String(Math.round(best.km))} km`);
      else reasons.push(`Day ${best.di+1}이 가장 여유로워요 (장소 ${best.count}개)`);
      if(ctx&&ctx.walking==='LOW'&&best.km!=null&&best.km<=2) reasons.push('걷기 부담이 적은 거리예요');
      picks.push({candidate:c, di:best.di, km:best.km, reasons, slot});
    }
    if(!picks.length) return null;
    const dayset=[...new Set(picks.map(p=>p.di))], allKm=picks.every(p=>p.km!=null);
    const timed=picks.every(p=>p.slot);
    const where = dayset.length===1 ? `Day ${dayset[0]+1}에 넣으면` : '각각 가장 맞는 날에 넣으면';
    const how = timed ? '시간까지 무리 없이 들어가요' : (allKm? '동선이 자연스러워요' : '무리가 없어요');
    const headline=`이 ${picks.length}곳은 다들 좋아해요 — ${where} ${how}`;
    return {headline, picks};
  }

  // ── 함께 움직이지 않는 시간 (6단계 · §25~§27) ─────────────────────────────
  //
  // 모든 멤버가 늘 함께 움직인다고 가정하지 않는다(§25). 일정에 참여자를 지정할 수 있고(§26),
  // 갈라졌다가 다시 만나는 지점을 둔다(§27).
  //
  // 여기는 **문장과 판정만** 만든다. 시각 계산은 lib.js의 computeTimeline이 하고,
  // 갈리는 규칙(같은 참여자 = 한 가지)은 lib.js의 whoKey/splitSegments가 단일 소스다.

  /** 참여자 지정은 일정을 바꾸는 일이다 — 의견이 아니라 편집 권한(§12) @param {unknown} role @returns {boolean} */
  function canAssignWho(role){ return canEdit(role); }

  /**
   * user_id → 이름표. 이름표는 서버(`tc_member_label`)가 만든 것을 그대로 쓴다 — 이메일은 여행에 나오지 않는다(§69).
   * @param {Array<{user_id?:string,display_name?:string|null,me?:boolean}>|null} members
   * @returns {Map<string,{name:string,me:boolean}>}
   */
  function memberLabelMap(members){
    /** @type {Map<string,{name:string,me:boolean}>} */ const map=new Map();
    for(const m of (Array.isArray(members)?members:[])){
      if(!m || typeof m.user_id!=='string') continue;
      map.set(m.user_id, {name:String(m.display_name||'').trim()||'멤버', me:!!m.me});
    }
    return map;
  }

  /**
   * 참여자 이름표 목록. 나는 늘 '나'로 부르고 맨 앞에 둔다 — 내 일정인지 한눈에 보이게.
   * 모르는 id는 '멤버'로 둔다(나간 사람일 수 있다 — 지우지 않는다: 지난 일정의 기록이다).
   * @param {string[]|null|undefined} who @param {Array<any>|null} members @returns {string[]}
   */
  function whoLabels(who, members){
    const map=memberLabelMap(members);
    /** @type {string[]} */ const mine=[]; /** @type {string[]} */ const rest=[];
    for(const id of (Array.isArray(who)?who:[])){
      const hit=map.get(String(id));
      if(hit && hit.me) mine.push('나');
      else rest.push(hit? hit.name : '멤버');
    }
    return mine.concat(rest);
  }

  /**
   * '모두' 또는 '나 · 지민'. 값이 없으면 **모든 여행자**다(§26) — 기본이 함께 다니는 것이다.
   * @param {any} spot @param {Array<any>|null} members @returns {string}
   */
  function whoText(spot, members){
    const who=(spot && Array.isArray(spot.who))? spot.who : null;
    if(!who || !who.length) return '모두';
    return whoLabels(who, members).join(' · ');
  }

  /** 이 일정에 내가 들어 있는가. 지정이 없으면 모두이므로 참이다. @param {any} spot @param {string|null|undefined} myId @returns {boolean} */
  function includesMe(spot, myId){
    const who=(spot && Array.isArray(spot.who))? spot.who : null;
    if(!who || !who.length) return true;
    return !!myId && who.indexOf(String(myId)) >= 0;
  }

  /**
   * 반응에서 사람을 갈라낸다 — 분리를 만들려면 이름이 아니라 id가 필요하다(동명이인).
   * `list_trip_candidates`가 reactions에 user_id를 함께 준다.
   * @param {any} cand @param {'MUST'|'OK'|'PASS'} reaction @returns {string[]}
   */
  function reactorIds(cand, reaction){
    /** @type {any[]} */ const list=(cand && Array.isArray(cand.reactions))? cand.reactions : [];
    /** @type {string[]} */ const out=[]; const seen=new Set();
    for(const r of list){
      if(!r || normReaction(r.reaction)!==reaction) continue;
      const id=(typeof r.user_id==='string')? r.user_id : '';
      if(!id || seen.has(id)) continue;
      seen.add(id); out.push(id);
    }
    return out;
  }

  /**
   * §24의 "자유시간으로 분리"를 실제 일정으로. **미리보기다** — 누르기 전에는 저장되지 않는다.
   *
   * 가고 싶은 사람은 그 후보로, 나머지는 자유시간으로 간다. 자유시간에는 장소를 정해 주지 않는다 —
   * 무엇을 할지는 그 사람들이 정할 일이지 앱이 고를 일이 아니다(§23).
   * 합류(§27)는 장소를 모르므로 표시만 만들고, 시각은 타임라인이 정한다.
   *
   * @param {any} cand 후보 (reactions에 user_id 포함)
   * @param {Array<any>|null} members
   * @param {{stayMin?:number, splitId?:string}} [opts]
   * @returns {{goers:string[], others:string[], spots:any[], text:string}|null}
   */
  function buildSplitPlan(cand, members, opts){
    if(!cand) return null;
    const goers=reactorIds(cand,'MUST').concat(reactorIds(cand,'OK'));
    const others=reactorIds(cand,'PASS');
    // 한쪽이 비면 갈릴 것이 없다 — 다 같이 가거나, 아무도 안 가거나다.
    if(!goers.length || !others.length) return null;
    const splitId=String((opts&&opts.splitId)||'').trim() || ('sp'+Math.random().toString(36).slice(2,8));
    const stayMin=(opts&&Number(opts.stayMin)>0)? Math.round(Number(opts.stayMin)) : 120;
    const title=String(cand.title||'').trim()||'후보';
    /** @type {any[]} */ const spots=[
      {name:title, city:String(cand.addr||'').trim()||'', desc:String(cand.note||''),
       lat:(cand.lat==null?null:Number(cand.lat)), lng:(cand.lng==null?null:Number(cand.lng)),
       stayMin, split:splitId, who:goers.slice()},
      {name:'자유시간', city:'', desc:'가고 싶은 곳을 각자 정해요',
       lat:null, lng:null, stayMin, split:splitId, who:others.slice()},
      {name:'다시 만나기', city:'', lat:null, lng:null, stayMin:0, reunion:true}
    ];
    const a=whoLabels(goers, members).join(', '), b=whoLabels(others, members).join(', ');
    return {goers, others, spots, text:`${a}은(는) ${title}, ${b}은(는) 자유시간 — 끝나면 다시 만나요`};
  }

  /**
   * 합류 안내 한 줄. 장소를 정했으면 그것을, 아니면 정하라고 말한다 — 아는 척하지 않는다.
   * @param {any} spot @param {string} [when] 'HH:MM'
   * @returns {string}
   */
  function reunionText(spot, when){
    const place=String((spot&&spot.name)||'').trim();
    const named=place && place!=='다시 만나기';
    const at=String(when||'').trim();
    if(named) return at? `${at} ${place}에서 만나요` : `${place}에서 만나요`;
    return at? `${at}에 만나요 — 어디서 만날지는 정해 주세요` : '어디서 만날지 정해 주세요';
  }

  const API={ROLES, ROLE_LABEL, COLLAB_CFG, JOIN_REASON, REACTIONS, REACTION_LABEL, REACTION_ICON, MOOD_TEXT, ACTIVITY_KINDS, PREF, PACE_LABEL, WALK_LABEL, CONSENSUS_TEXT,
    normRole, canEdit, canManage, canLeave, canDelete, roleLabel, roleIcon, roleOf, tripRoleMap,
    memberName, displayNameFromEmail, memberSummary,
    buildInviteLink, parseJoinHash, inviteVerdict, joinReasonText, inviteRangeText,
    isForbiddenError, forbiddenText,
    normReaction, reactionLabel, reactionIcon, canPropose, canReact, canScheduleCandidate, canRemoveCandidate,
    tallyReactions, candidateMood, moodText, groupCandidates, reactionSummary, candidateAttribution, sortCandidates,
    canComment, canDeleteComment, objParticle, activityText, condenseActivity, relativeTime, liveEffects,
    normPrefs, prefsText, groupContext, groupContextText, consensusOf, consensusText, candidateVerdict,
    candidateConflict, conflictOptions, distanceKm, buildGroupProposal,
    canAssignWho, memberLabelMap, whoLabels, whoText, includesMe, reactorIds, buildSplitPlan, reunionText};
  if(typeof module!=='undefined' && module.exports) module.exports=API;   // Node (테스트)
  else /** @type {any} */(root).TC_COLLAB=API;                            // 브라우저 전역
})(typeof window!=='undefined'?window:globalThis);
