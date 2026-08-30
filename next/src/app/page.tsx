// 이관 상태 랜딩 — 병행 운영 중 어느 영역이 Next로 넘어왔는지 보여준다.
// 레거시 앱(루트 index.html)은 기능 동등성 확보 전까지 그대로 프로덕션이다 (§12·§24).
const AREAS: { name: string; status: '이관됨' | '진행 중' | '레거시' }[] = [
  { name: 'Booking/Pricing 도메인 타입 + Saving Engine', status: '이관됨' },
  { name: 'Booking/Price UI (/bookings)', status: '진행 중' },
  { name: 'API — hotel-offers (Route Handler)', status: '이관됨' },
  { name: 'API — car-offers · cron', status: '레거시' },
  { name: 'Itinerary (Trip/Day/Spot)', status: '레거시' },
  { name: 'Map', status: '레거시' }
];

export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 20px' }}>
      <h1>Trip Canvas — Next 이관 워크스페이스</h1>
      <p style={{ color: 'var(--muted)' }}>
        Strangler Migration: 레거시 정적 앱과 병행하며 기능 단위로 이관한다. 이 페이지는 배포되지 않는다.
      </p>
      <ul style={{ lineHeight: 2 }}>
        {AREAS.map(a => (
          <li key={a.name}>
            {a.name} — <b>{a.status}</b>
          </li>
        ))}
      </ul>
    </main>
  );
}
