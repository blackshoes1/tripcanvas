// 지도 SDK 클라이언트 키 — app.js 상단과 동일 값 (공개 키, 도메인 제한으로 보호).
// GMAPS_KEY: HTTP 리퍼러 제한 · KAKAO_KEY: 플랫폼 도메인 제한.
// 등록 도메인: localhost:8000 · tripcanvas-ai.vercel.app — Next dev에서 지도를 보려면
// `npm run dev:8000`으로 8000 포트에 띄워야 한다 (3000은 키 도메인 미등록 → 타일 거부).
export const GMAPS_KEY = 'AIzaSyCE6I2dhqk2jzNvA0ZMzDSuPi7HAfWecAM';
export const KAKAO_KEY = '088123c29d265c5f9cc9ec8d356f54c8';
