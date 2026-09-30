#!/usr/bin/env bash
# 배포 리허설 — 발행 후보 이미지를 **운영과 같은 compose · 같은 apply.sh**로 띄우고,
# 프록시(Caddy) 너머에서 블랙박스 스위트를 돌린 뒤 컨테이너별 자원을 잰다.
#
#   deploy/tests/rehearsal.sh <이미지 참조>
#
# SQLite의 "test what you fly"를 옮긴 것이다: 소스가 아니라 **호스트가 받을 바로 그
# 이미지**를 시험한다. backend.yml은 이것이 통과한 digest에만 `:main`을 붙인다 —
# 호스트는 `:main`만 보고 배포하므로(deploy/PLAN.md D2), 리허설을 못 넘은 이미지는
# 운영에 닿지 않는다.
#
# ⚠️ CI 러너(또는 로컬 docker) 전용이다. deploy/.env를 새로 쓰고, 끝나면 스택을 볼륨까지
#    지운다. 운영 체크아웃에서 부르면 .env가 이미 있으므로 시작하지 않는다.
set -euo pipefail

image=${1:?"쓰임: $0 <이미지 참조>"}
here=$(cd "$(dirname "$0")" && pwd)
deploy=$(cd "$here/.." && pwd)
backend=$(cd "$deploy/../backend" && pwd)
work=${REHEARSAL_WORK:-$(mktemp -d)}
report=${REHEARSAL_REPORT:-$work/rehearsal.md}
base_url=http://localhost

cd "$deploy"
if [[ -e .env ]]; then
  echo "!! deploy/.env가 이미 있다 — 운영 체크아웃으로 보인다. 리허설을 시작하지 않는다." >&2
  exit 1
fi

# 운영 스택과 이름이 겹치지 않게 프로젝트·컨테이너 이름을 따로 쓴다.
export COMPOSE_FILE=compose.yaml:tests/rehearsal/compose.rehearsal.yaml
export COMPOSE_PROJECT_NAME=yorr-rehearsal

cleanup() {
  [[ -n ${sampler:-} ]] && kill "$sampler" 2>/dev/null
  docker compose logs --no-color backend > "$work/backend.log" 2>&1 || true
  docker compose down -v --remove-orphans > /dev/null 2>&1 || true
  rm -f .env
}
trap cleanup EXIT

step() { printf '\n== %s\n' "$*"; }

mkdir -p "$work/backup" "$work/state/metrics"
cat > .env <<EOF
PUBLIC_HOST=localhost
SERVER_PORT=8080
DB_NAME=yorr
DB_USERNAME=yorr
DB_PASSWORD=$(openssl rand -hex 16)
MYSQL_ROOT_PASSWORD=$(openssl rand -hex 16)
BACKUP_DIR=$work/backup
YORR_STATE_DIR=$work/state
CORS_ALLOWED_ORIGINS=$base_url
BACKEND_CONTAINER=rehearsal-backend
CADDY_CONTAINER=rehearsal-caddy
REDIS_CONTAINER=rehearsal-redis
MYSQL_CONTAINER=rehearsal-mysql
MYSQL_BACKUP_CONTAINER=rehearsal-mysql-backup
BACKEND_IMAGE=$image
EOF
chmod 600 .env

# 컨테이너별 메모리(MiB)를 2초마다 받아 둔다 — 최댓값이 "이 스택을 담을 호스트 크기"다.
to_mib() {
  awk '{
    v = $1; u = $1; gsub(/[0-9.]+/, "", u); gsub(/[^0-9.]/, "", v)
    if (u == "GiB") v *= 1024; else if (u == "KiB" || u == "kB") v /= 1024; else if (u == "B") v /= 1048576
    printf "%.1f\n", v
  }'
}
sample() {
  while :; do
    docker stats --no-stream --format '{{.Name}} {{.MemUsage}} {{.CPUPerc}}' 2> /dev/null |
      while read -r name used _ _ cpu; do
        printf '%s %s %s\n' "$name" "$(printf '%s' "$used" | to_mib)" "${cpu%\%}"
      done >> "$work/samples"
    sleep 2
  done
}
snapshot() {
  docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' |
    while read -r name used _; do printf '%s %s\n' "$name" "$(printf '%s' "$used" | to_mib)"; done
}

step "빈 DB에 스키마 세우기 (docker compose run --rm migrate — 운영의 부트스트랩과 같은 진입점)"
docker compose run --rm migrate

step "릴리스 적용 (apply.sh — up -d --wait, 운영과 같은 health 게이트)"
started=$(date +%s)
./apply.sh "$image" 240
ready_seconds=$(( $(date +%s) - started ))

step "프록시 너머 readiness"
curl -fsS "$base_url/actuator/health" | tee "$work/health.json"
grep -q '"UP"' "$work/health.json"
echo
snapshot > "$work/idle"

step "블랙박스 스위트 (E2E_BASE_URL=$base_url)"
sample &
sampler=$!
(cd "$backend" && E2E_BASE_URL=$base_url npm run -s test:e2e)
kill "$sampler"; sampler=

step "프로세스 재시작 뒤에도 다시 healthy (마감 시각은 Redis에 있다 — DESIGN.md 원칙 8)"
docker compose restart backend
for _ in $(seq 1 60); do
  state=$(docker inspect --format '{{.State.Health.Status}}' rehearsal-backend 2> /dev/null || echo starting)
  [[ $state == healthy ]] && break
  sleep 2
done
[[ $state == healthy ]] || { echo "!! 재시작 뒤 healthy가 되지 못했다 ($state)" >&2; exit 1; }
curl -fsS "$base_url/actuator/health" | grep -q '"UP"'

step "핸들러 밖으로 샌 예외가 없다"
if docker compose logs --no-color backend | grep -q 'WS 메시지 처리 실패'; then
  docker compose logs --no-color backend | grep -A3 'WS 메시지 처리 실패' | head -40 >&2
  echo "!! 게이트웨이가 삼킨 예외가 있다 — 버그다(TESTING.md 「새어 나온 예외 0건」)" >&2
  exit 1
fi
echo "0건"

step "자원 보고서"
image_mib=$(docker image inspect --format '{{.Size}}' "$image" | awk '{printf "%.0f", $1/1048576}')
{
  echo "## 배포 리허설"
  echo
  echo "- 이미지: \`$image\` ($image_mib MiB)"
  echo "- \`apply.sh\` → healthy까지 ${ready_seconds}초 (\`up -d --wait\`)"
  echo "- 프록시 너머 블랙박스 스위트 통과 · 재시작 뒤 healthy · 새어 나온 예외 0건"
  echo
  echo "| 컨테이너 | 대기 (MiB) | 스위트 중 최대 (MiB) | 스위트 중 최대 CPU (%) |"
  echo "|---|---:|---:|---:|"
  total_idle=0; total_peak=0
  while read -r name idle; do
    peak=$(awk -v n="$name" '$1 == n && $2 > m { m = $2 } END { printf "%.1f", m + 0 }' "$work/samples")
    cpu=$(awk -v n="$name" '$1 == n && $3 > m { m = $3 } END { printf "%.1f", m + 0 }' "$work/samples")
    echo "| ${name#rehearsal-} | $idle | $peak | $cpu |"
    total_idle=$(awk -v a="$total_idle" -v b="$idle" 'BEGIN { printf "%.1f", a + b }')
    total_peak=$(awk -v a="$total_peak" -v b="$peak" 'BEGIN { printf "%.1f", a + b }')
  done < <(sort "$work/idle")
  echo "| **합계** | **$total_idle** | **$total_peak** | |"
  echo
  echo "> 러너는 호스트와 같은 linux/arm64다. 모니터링 에이전트(Alloy)는 별도 프로젝트라 포함하지 않았다."
} | tee "$report"
