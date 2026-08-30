import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Trip Canvas (Next)',
  description: '대화로 만드는 멀티시티 여행 동선 플래너 — Next.js 점진 이관 워크스페이스'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
