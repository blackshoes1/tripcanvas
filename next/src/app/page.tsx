// 이관 상태 랜딩 — 병행 운영 중 어느 영역이 Next로 넘어왔는지 보여준다.
// 레거시 앱(루트 index.html)은 기능 동등성 확보 전까지 그대로 프로덕션이다 (§12·§24).
import Link from 'next/link';

const AREAS: { name: string; status: '이관됨' | '진행 중' | '레거시' }[] = [
  { name: 'Booking/Pricing 도메인 + Saving Engine', status: '이관됨' },
  { name: 'Booking/Price UI (/bookings)', status: '이관됨' },
  { name: 'API — hotel-offers · car-offers · kakao-directions · cron (Route Handler)', status: '이관됨' },
  { name: '일정 읽기·편집·추가·삭제·드래그 정렬 (/itinerary)', status: '이관됨' },
  { name: '지도 — 장소 담기(해외 POI·국내 POI 칩)·검색·경로 조회', status: '이관됨' },
  { name: '재생(동선 따라가기) · 여행·일자 관리 · 환율 갱신', status: '이관됨' },
  { name: '가져오기·내보내기·공유 링크·이미지(PNG)·붙여넣기 초안', status: '이관됨' },
  { name: '여행 모드 (/travel — 현장에서 보는 화면)', status: '이관됨' },
  { name: '클라우드 동기화 · 로그인 · 버전 히스토리 (Supabase)', status: '이관됨' },
  { name: '온보딩 · 실행취소 · 설정 메뉴 전반', status: '이관됨' }
];

const LINKS = [
  { href: '/itinerary', label: '일정', desc: '만들고 고치고 재생한다' },
  { href: '/travel', label: '여행 모드', desc: '여행 중에 보는 화면' },
  { href: '/bookings', label: '예약 · 가격 추적', desc: '숙박·렌터카·항공' }
];

export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 20px' }}>
      <h1>Trip Canvas — Next 이관 워크스페이스</h1>
      <p style={{ color: 'var(--muted)' }}>
        Strangler Migration: 레거시 정적 앱과 병행하며 기능 단위로 이관한다.
        같은 저장소(<code>tripcanvas_v1</code>)를 쓰므로 두 앱을 오가며 같은 여행을 볼 수 있다.
      </p>
      <nav style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '24px 0' }}>
        {LINKS.map(l => (
          <Link key={l.href} href={l.href} style={{
            flex: '1 1 170px', padding: '14px 16px', borderRadius: 12, textDecoration: 'none',
            background: 'var(--card)', color: 'var(--fg)',
            border: '1px solid color-mix(in srgb, var(--fg) 15%, transparent)'
          }}>
            <b>{l.label}</b>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{l.desc}</div>
          </Link>
        ))}
      </nav>
      <ul style={{ lineHeight: 2 }}>
        {AREAS.map(a => (
          <li key={a.name}>
            {a.name} — <b>{a.status}</b>
          </li>
        ))}
      </ul>
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
        레거시 앱에만 남는 것: ☰ 메뉴 하단의 <b>버전 표시</b>. 서비스 워커가 캐시한 앱 셸이
        옛 버전인지 보는 장치라, 앱 셸을 캐시하지 않는 이 워크스페이스에는 해당이 없다.
        <br />
        기능이 옮겨졌다고 레거시를 내리는 것은 아니다 — 실제 키(지도·검색·환율·AI)로 확인하기
        전까지 프로덕션은 루트의 정적 앱이다.
      </p>
    </main>
  );
}
