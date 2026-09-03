# tripcanvas-api — NAS(Docker Compose)용 이미지. 저장소 루트를 컨텍스트로 빌드한다(판단 엔진 adaptive.js 등이 루트에 있다):
#   docker build -f next/Dockerfile -t tripcanvas-api .
# ⚠️ 작성 환경에 Docker가 없어 빌드 미검증 — docs/nas-deployment.md의 확인 절차를 따를 것.

# ── deps: next/의 의존성(devDependencies 포함 — drizzle-kit migrate에 필요) ──
FROM node:22-alpine AS deps
WORKDIR /repo/next
COPY next/package.json next/package-lock.json ./
RUN npm ci --no-audit --no-fund

# ── build: standalone 출력 ──
FROM node:22-alpine AS build
WORKDIR /repo
COPY . .
COPY --from=deps /repo/next/node_modules ./next/node_modules
WORKDIR /repo/next
ENV TC_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── migrate: 스키마 적용 전용(일회성 서비스). 앱 이미지에 drizzle-kit을 싣지 않는다 ──
FROM build AS migrate
WORKDIR /repo/next
CMD ["npx", "drizzle-kit", "migrate"]

# ── runtime: 최소 이미지 ──
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S tc && adduser -S tc -G tc
# outputFileTracingRoot가 저장소 루트라 standalone 안에 next/ 경로가 그대로 있다
COPY --from=build --chown=tc:tc /repo/next/.next/standalone ./
COPY --from=build --chown=tc:tc /repo/next/.next/static ./next/.next/static
USER tc
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "next/server.js"]

# ── realtime: WebSocket 사이드카(§42). Next와 별도 프로세스다 — Route Handler는 업그레이드를 다루지 않는다 ──
FROM build AS realtime
WORKDIR /repo/next
RUN npm run tools:build
ENV REALTIME_PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3001/health || exit 1
CMD ["node", "dist-tools/server/realtime/main.js"]
