import type { NextConfig } from 'next';
import path from 'node:path';

// 레거시 순수 모듈(../price.js 등)을 워크스페이스 밖에서 import하기 위해
// 루트를 저장소 최상위로 지정한다 — 로직을 복제하지 않고 단일 소스를 유지(Strangler).
const nextConfig: NextConfig = {
  turbopack: { root: path.join(__dirname, '..') },
  outputFileTracingRoot: path.join(__dirname, '..'),
  // NAS Docker 이미지(next/Dockerfile)만 standalone — Vercel 배포는 그대로
  ...(process.env.TC_STANDALONE ? { output: 'standalone' as const } : {})
};

export default nextConfig;
