# tripcanvas-api — NAS(Docker Compose)용 이미지. 저장소 루트를 컨텍스트로 빌드한다(판단 엔진 adaptive.js 등이 루트에 있다):
#   docker build -f next/Dockerfile -t tripcanvas-api .
# 빌드는 PR마다 CI가 확인한다(`ci.yml`의 Docker image build — runtime·tools 두 타깃, 푸시하지 않는다).
# 운영 이미지는 `release.yml`만 만들어 GHCR에 올린다. 띄운 뒤의 확인은 docs/nas-deployment.md.

# ── deps: next/의 의존성(devDependencies 포함 — drizzle-kit migrate에 필요) ──
FROM node:22-alpine AS deps
WORKDIR /repo/next
COPY next/package.json next/package-lock.json ./
RUN npm ci --no-audit --no-fund

# ── build: standalone 출력 ──
FROM node:22-alpine AS build
ARG TC_REVISION=unknown
LABEL org.opencontainers.image.revision=$TC_REVISION
WORKDIR /repo
COPY . .
COPY --from=deps /repo/next/node_modules ./next/node_modules
WORKDIR /repo/next
ENV TC_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── tools: migrate·realtime **공용** 이미지 ──
# 둘은 같은 이미지에서 **명령만 다르게** 돈다(`deploy/docker-compose.yml`의 `command`).
# 한 태그가 곧 한 커밋이라 "api는 새 코드, migrate는 옛 코드"가 구조적으로 생기지 않는다(§배포).
# 앱(runtime) 이미지에는 drizzle-kit을 싣지 않는다 — 여기에만 있다.
FROM build AS tools
ARG TC_REVISION=unknown
ENV TC_REVISION=$TC_REVISION
WORKDIR /repo/next
# 독립 실행 도구(실시간 사이드카·이관 CLI)는 Next 번들과 따로 컴파일된다
RUN npm run tools:build
# ⚠️ root로 돌지 않는다 — 실시간 사이드카는 Funnel로 인터넷에 열려 있다(runtime 이미지의 `tc`와 같은 이유).
#    베이스 이미지의 `node`(uid 1000, 홈 /home/node)를 쓴다. /repo는 root 소유·읽기 전용으로 남고 쓸 곳은 없다:
#    migrate(`npx drizzle-kit migrate`)는 DB에만 쓰고 npm 로그·tsx 캐시는 홈과 /tmp로 간다, realtime은 파일을 쓰지 않는다.
#    이 아래의 migrate·realtime 타깃도 이 사용자를 물려받는다.
USER node

# ── migrate: 스키마 적용 전용(일회성). 운영은 tools 이미지에 command만 바꿔 띄우고,
#    이 타깃은 로컬·Fly.io가 **타깃 이름으로** 빌드할 때의 진입점이다 ──
FROM tools AS migrate
CMD ["npx", "drizzle-kit", "migrate"]

# ── runtime: 최소 이미지 ──
FROM node:22-alpine AS runtime
ARG TC_REVISION=unknown
LABEL org.opencontainers.image.revision=$TC_REVISION
# 라벨은 docker inspect로, 환경변수는 GET /api/health의 revision으로 본다 — 어떤 코드가 도는지 밖에서 알 수 있게(scripts/nas-deploy.sh)
ENV TC_REVISION=$TC_REVISION
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

# ── realtime: WebSocket 사이드카(§42). Next와 별도 프로세스다 — Route Handler는 업그레이드를 다루지 않는다.
#    운영은 tools 이미지 + command로 띄운다(위와 같은 이유). 이 타깃은 로컬·Fly.io용이다 ──
FROM tools AS realtime
ENV REALTIME_PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3001/health || exit 1
CMD ["node", "dist-tools/server/realtime/main.js"]
