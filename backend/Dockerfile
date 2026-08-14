# syntax=docker/dockerfile:1
#
# YORR 백엔드 런타임 이미지 — [ADR-0006](docs/adr/0006-github-actions-ghcr-arm64-single-host.md).
#
# 대상은 **Oracle Cloud Ampere A1(linux/arm64)** 단일 호스트이고, 이미지는
# GitHub Actions의 x86 러너에서 만들어 GHCR에 올린다. 그래서 이 파일의 구조는
# "멀티스테이지"보다 먼저 **크로스 빌드**가 목적이다:
#
#   컴파일·의존성 설치 스테이지는 전부 `--platform=$BUILDPLATFORM`(= x86 러너의
#   네이티브 아키텍처)에서 돌고, 최종 arm64 스테이지에는 **`RUN`이 한 줄도 없다.**
#   그래서 QEMU 에뮬레이션 없이 arm64 이미지가 나온다(빌드 수 분 → 수십 초).
#
#   ⚠️ 런타임 스테이지에 `RUN`을 추가하는 순간 이 전제가 깨져 QEMU가 필요해진다.
#      추가하려면 ADR-0006을 먼저 읽어라.
#
# 크로스 빌드가 성립하는 근거(2026-08-14 확인):
#   런타임 의존성 트리 73개 패키지에 **네이티브 애드온·아키텍처 게이트(`cpu`/`os`)·
#   install 스크립트가 하나도 없다**(fastify · ioredis · mysql2 · ws · zod 전부 순수 JS).
#   `ws`의 `bufferutil`·`utf-8-validate`는 optional peer이고 lockfile에 들어 있지 않다.
#   아래 `prod-deps` 스테이지가 이 전제를 매 빌드마다 검사해서, 언젠가 네이티브
#   의존성이 들어오면 조용히 깨지는 대신 빌드가 실패한다.
#
# 베이스를 alpine이 아니라 debian slim으로 잡은 이유: 빌드 스테이지가 쓰는 컴파일러가
# **네이티브 바이너리**다(typescript 7 = Go로 짠 tsgo, `@typescript/typescript-linux-*`).
# musl 호환 여부를 이 환경에서 실제로 확인할 수 없었고, 12GB 호스트에서 이미지 100MB
# 차이는 값이 아니다. glibc는 개발 환경과 같아 변수가 하나 줄어든다.

ARG NODE_IMAGE=node:22-bookworm-slim

# ── 1. 빌드용 의존성 (devDependencies 포함) ─────────────────────────────────────
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS deps
WORKDIR /app
# package.json·lock만 먼저 복사해 소스 변경이 의존성 레이어를 무효화하지 않게 한다.
COPY package.json package-lock.json ./
RUN npm ci

# ── 2. 컴파일 (tsc → dist) ─────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /app
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
# tsconfig.build.json: rootDir=src, outDir=dist, `src/**/__tests__` 제외.
RUN npm run build
# 배선 누락과 같은 종류의 조용한 실패를 막는다 — 진입점이 없으면 여기서 죽는다.
RUN test -f dist/main.js

# ── 3. 런타임 의존성 (devDependencies 없이) ────────────────────────────────────
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
# `--ignore-scripts`: 런타임 트리에 install 스크립트가 있는 패키지는 없다(위 근거).
# 없다는 전제를 옵션으로도 못박아 두면, 새로 생겼을 때 조용히 실행되지 않는다.
RUN npm ci --omit=dev --ignore-scripts
# 크로스 빌드 전제의 자동 검사. 빌드 호스트(x86)에서 설치한 node_modules를 arm64
# 런타임에 그대로 옮길 수 있는 것은 네이티브 애드온이 없기 때문이다.
RUN if [ -n "$(find node_modules -name '*.node' -print -quit)" ]; then \
      echo "런타임 의존성에 네이티브 애드온(.node)이 생겼다 — 크로스 빌드 전제가 깨졌다." >&2; \
      echo "ADR-0006을 읽고 arm64 러너 빌드로 전환하거나 그 의존성을 걷어내라." >&2; \
      find node_modules -name '*.node' >&2; \
      exit 1; \
    fi

# ── 4. 런타임 (linux/arm64 — RUN 금지) ─────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

ENV NODE_ENV=production
# 계약: DATETIME(6)은 UTC 벽시계다(docs/design/persistence.md의 `finished_at`).
# 주간 랭킹의 KST 경계는 코드가 상수(+09:00)로 갖고 있어 `TZ`와 무관하지만,
# 로그·`Date` 출력이 환경마다 달라지지 않게 여기서 못박는다.
ENV TZ=UTC

# package.json은 런타임에도 필요하다 — `"type": "module"`이 없으면 node가 dist의
# `.js`를 CommonJS로 읽어 부팅이 즉시 깨진다.
COPY --chown=node:node package.json ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# 마이그레이션 SQL은 tsc 산출물에 들어가지 않는다. 기동 시 `verifyMigrations`가
# `dist/infra/migrations/`에서 `../../../db/migration/`를 읽으므로(discover.ts)
# 이 디렉터리가 없으면 ENOENT → exit 1로 죽는다. **필수 산출물이다.**
COPY --chown=node:node db ./db

USER node

# 프록시가 기대하는 포트. 실제 값은 `.env`의 `SERVER_PORT`가 정한다(문서용 선언).
EXPOSE 8080

# 이미지가 스스로 건강 판정을 갖고 있게 한다. 배포 파이프라인의 검증은 여전히
# `sleep 15` + Running 확인이지만(operations.md), compose의 `depends_on`과
# `docker ps`의 health 표시가 여기서 나온다.
# curl·wget 없이 node 내장 fetch만 쓴다 — 런타임 이미지에 도구를 늘리지 않는다.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "const p=process.env.SERVER_PORT||'8080';fetch('http://127.0.0.1:'+p+'/actuator/health').then(r=>r.json()).then(b=>process.exit(b.status==='UP'?0:1)).catch(()=>process.exit(1))"]

# `npm start`로 감싸지 않는다. npm이 PID 1이 되면 SIGTERM을 자식에게 전달하지
# 않아 `main.ts`의 종료 훅(하트비트·마감 스케줄러·소켓 정리)이 돌지 않는다.
# node가 직접 PID 1이면 `process.on('SIGTERM')` 핸들러가 그대로 발화한다.
#
# ⚠️ 알려진 틈: main.ts는 `createServer`·`verifyMigrations`를 await한 **뒤에**
#    핸들러를 등록한다. 그 사이(기동 수 초)에 온 SIGTERM은 PID 1 기본 동작이
#    없어 무시되고 `docker stop`이 10초 뒤 SIGKILL한다. 기동 중에만 해당하며
#    compose의 `init: true`가 좀비 수확은 맡는다.
CMD ["node", "dist/main.js"]
