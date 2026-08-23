#!/usr/bin/env bash
# 릴리스 하나를 실제로 적용한다 — controller의 **안쪽** 절반.
#
# 이 파일이 체크아웃 안에 있는 이유(PLAN.md D8): `converge`가 `git reset --hard`로
# 릴리스 B를 체크아웃한 **뒤에** 이것을 부른다. 즉 **B의 배포 로직이 B를 배포한다** —
# compose 서비스 목록이나 환경변수 계약이 같은 커밋에서 바뀌었어도 앞뒤가 맞는다.
# 반대로 lock·발견·상태·HALT·롤백은 여기 없다. 그쪽은 체크아웃 바깥에 있어야
# `git reset`에 함께 흔들리지 않는다.
#
#   apply.sh <이미지 참조> [--wait 초]
#   apply.sh ghcr.io/jadewisemann/yorr-backend@sha256:abc... 150
#
# 사람이 직접 불러도 된다(긴급 롤백). 다만 그때 자동 배포는 다음 회차에 `:main`으로
# 되돌리므로, 손으로 고정하려면 `converge rollback`을 쓴다 — 그쪽은 HALT까지 건다.
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

ref=${1:?"쓰임: $0 <이미지 참조> [--wait 초]"}
wait_timeout=${2:-150}

[[ -f .env ]] || {
  echo "!! deploy/.env가 없다 — compose의 필수 변수를 채울 수 없다." >&2
  exit 1
}

# ── digest 고정을 `.env`에 남긴다 ─────────────────────────────────────────────
# 셸 환경변수로만 주면 **이 실행에만** 걸리고, 그다음 누군가 손으로 `docker compose
# up -d`를 하면 compose 기본값인 `:main`으로 조용히 돌아간다. 그때 증상은 "롤백했는데
# 잠시 뒤 다시 올라갔다"라서 원인을 찾기 어렵다. 파일에 적으면 이 디렉터리에서 나가는
# 모든 compose 명령이 같은 릴리스를 본다.
#
# `.env`는 git이 추적하지 않으므로(루트 .gitignore) 이 쓰기가 `git pull`을 막지 않는다.
{
  grep -v '^BACKEND_IMAGE=' .env || true
  printf 'BACKEND_IMAGE=%s\n' "$ref"
} > .env.tmp
# 비밀(DB 비밀번호·OAuth 시크릿)이 든 파일이다 — 권한을 넓히지 않는다.
chmod --reference=.env .env.tmp 2>/dev/null || chmod 600 .env.tmp
mv -f .env.tmp .env

echo "== 릴리스 적용: $ref"
echo "   체크아웃: $(git rev-parse --short HEAD 2>/dev/null || echo '알 수 없음')"

# ── 게이트: `--wait` + 진짜 health ───────────────────────────────────────────
# 예전 경로는 `up -d` → `sleep 15` → `docker compose ps`였다. `up -d`는 컨테이너
# *시작*만 확인하고 exit 0을 내며 `ps`·`logs`는 무슨 일이 있어도 exit 0이라,
# **실패한 배포가 "완료"로 보고됐다**(PLAN.md 버그 B). `--wait`는 healthcheck가
# healthy가 될 때까지 기다리고 안 되면 실패한다 — 그리고 `/actuator/health`가
# 이제 readiness라(PR 1) 그 healthy가 실제로 무언가를 뜻한다.
#
# 서비스 목록을 제한하지 않는 이유(D7): `backend`만 건드리면 같은 릴리스에 들어온
# redis·caddy 설정 변경이 적용되지 않아 "git은 B, 실행 중 스택은 A"가 된다.
# 인프라 이미지가 몰래 올라가지 않는 것은 compose가 로컬에 있는 이미지를 다시 당기지
# 않기 때문이며, PR 5에서 digest 고정이 그것을 계약으로 만든다.
if ! docker compose up -d --wait --wait-timeout "$wait_timeout"; then
  echo
  echo "!! ${wait_timeout}초 안에 healthy가 되지 못했다. 상태와 로그:" >&2
  docker compose ps -a || true
  docker compose logs --tail 80 backend || true
  exit 1
fi

echo
echo "== 적용 완료 — 주입된 공개 주소"
docker compose config | grep -E "CORS_ALLOWED_ORIGINS|AUTH_FRONTEND_REDIRECT_URI|REDIRECT_URI" || true
