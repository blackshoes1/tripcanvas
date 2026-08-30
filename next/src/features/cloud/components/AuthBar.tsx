'use client';
// 로그인 · 동기화 상태 표시
import { useState } from 'react';

import type { CloudUser } from '../hooks/useCloudAuth';

export function AuthBar({ user, available, statusLabel, onSignIn, onSignOut, open, onOpenChange }: {
  user: CloudUser | null;
  available: boolean;
  /** 활성 여행의 동기화 상태 한 줄 */
  statusLabel: string;
  onSignIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  onSignOut: () => void;
  /** 로그인 창 열림 — 첫 방문 소개의 '로그인'에서도 바로 열 수 있게 바깥이 들고 있는다 */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setOpen = onOpenChange;
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!available) return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await onSignIn(email.trim(), pass);
      if (!r.ok) { setError(r.error ?? '로그인하지 못했습니다'); return; }
      setOpen(false);
      setEmail(''); setPass('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="itCloudBar">
      <span className="itCloudStatus">{statusLabel}</span>
      {user ? (
        <button type="button" onClick={onSignOut} title={`${user.email} — 로그아웃`}>
          👤 {user.email.split('@')[0]}
        </button>
      ) : (
        <button type="button" className="itCloudIn" onClick={() => { setError(null); setOpen(true); }}
          title="로그인하면 여행이 내 계정에 저장돼 어느 기기서든 열려요">
          로그인
        </button>
      )}

      {open && (
        <div className="itEditorBg" onClick={e => { if (e.target === e.currentTarget && !busy) setOpen(false); }}>
          <div className="itEditor" role="dialog" aria-modal="true" aria-label="로그인">
            <h2>로그인</h2>
            <p className="hint">로그인하면 여행이 내 계정에 저장돼 다른 기기에서도 이어서 볼 수 있어요.</p>
            <label>이메일
              <input type="email" value={email} autoComplete="username" autoFocus
                onChange={e => setEmail(e.target.value)} />
            </label>
            <label>비밀번호
              <input type="password" value={pass} autoComplete="current-password"
                onChange={e => setPass(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && email && pass && !busy) void submit(); }} />
            </label>
            {error && <div className="itEditErr" role="alert">{error}</div>}
            <div className="itEditBtns">
              <button type="button" onClick={() => setOpen(false)} disabled={busy}>취소</button>
              <button type="button" className="itEditSave" disabled={busy || !email.trim() || !pass}
                onClick={() => void submit()}>
                {busy ? '확인 중…' : '로그인'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
