#!/usr/bin/env bash
# converge 실패 주입 검증 — deploy/PLAN.md §9의 표를 그대로 돌린다.
#
#   deploy/tests/converge.test.sh
#
# **shell 단위 테스트가 아니라 실패 주입이다.** 배포 controller에서 확인하고 싶은 것은
# "함수가 값을 옳게 내는가"가 아니라 "배포가 깨졌을 때 릴리스 전체가 되돌아오고 자동화가
# 멈추는가"이기 때문이다. 그래서 **git은 진짜**로 두고(커밋 두 개짜리 저장소를 만든다)
# docker만 대역으로 바꿔, `up --wait` 실패·인프라 장애·게임 진행·잠금 경합을 실제로 주입한다.
#
# 이 파일이 존재하는 이유는 이 저장소의 실제 사고 이력이다: 지난번 자동화
# (`.github/workflows/deploy.yml`)는 **한 번도 실행되지 않은 채 머지됐다.** 호스트
# cutover(PR 4) 없이 검증할 수 있는 부분은 여기서 다 검증해 둔다.
set -uo pipefail
SP=$(dirname "$(readlink -f "$0")")
SRC=${1:-$(cd "$SP/.." && pwd)}
T=$SP/work
rm -rf "$T"; mkdir -p "$T/bin" "$T/fake" "$T/state"
cp "$SP/fake-docker" "$T/bin/docker"
export PATH="$T/bin:$PATH"
export FAKE_ROOT="$T/fake"
REPO=ghcr.io/jadewisemann/yorr-backend
DIGEST_A=sha256:aaaa; DIGEST_B=sha256:bbbb; DIGEST_C=sha256:cccc

pass=0; fail=0
check() {
  local label=$1 expected=$2 actual=$3
  if [[ $expected == "$actual" ]]; then pass=$((pass+1)); printf '  ✓ %s\n' "$label"
  else fail=$((fail+1)); printf '  ✗ %s\n     기대: %s\n     실제: %s\n' "$label" "$expected" "$actual"; fi
}
contains() {
  local label=$1 needle=$2 haystack=$3
  if [[ $haystack == *"$needle"* ]]; then pass=$((pass+1)); printf '  ✓ %s\n' "$label"
  else fail=$((fail+1)); printf '  ✗ %s\n     "%s"가 없다\n     받은 것: %s\n' "$label" "$needle" "$haystack"; fi
}

# ── 시나리오마다 저장소·상태를 새로 만든다 ──────────────────────────────────
setup() {
  rm -rf "$T/origin.git" "$T/checkout" "$T/state" "$FAKE_ROOT"
  mkdir -p "$FAKE_ROOT" "$T/state"
  git init -q --bare "$T/origin.git"
  # 기본 브랜치를 맞춰 둔다 — 안 하면 clone이 "remote HEAD가 없다"고 경고한다.
  git -C "$T/origin.git" symbolic-ref HEAD refs/heads/main
  git init -q "$T/seed" 2>/dev/null || true
  rm -rf "$T/seed"; mkdir -p "$T/seed/deploy"
  cd "$T/seed"
  git init -q -b main .
  git config user.email t@t; git config user.name t
  cp "$SRC/apply.sh" deploy/apply.sh; chmod +x deploy/apply.sh
  printf 'compose\n' > deploy/compose.yaml
  git add -A; git commit -qm A
  REV_A=$(git rev-parse HEAD)
  printf 'compose v2\n' > deploy/compose.yaml
  git add -A; git commit -qm B
  REV_B=$(git rev-parse HEAD)
  git push -q "$T/origin.git" main
  cd "$SP"
  git clone -q "$T/origin.git" "$T/checkout"
  git -C "$T/checkout" config user.email t@t
  git -C "$T/checkout" config user.name t
  git -C "$T/checkout" reset --hard -q "$REV_A"
  printf 'PUBLIC_HOST=1.2.3.4\nBACKEND_IMAGE=%s@%s\n' "$REPO" "$DIGEST_A" > "$T/checkout/deploy/.env"
  chmod 600 "$T/checkout/deploy/.env"

  # 레지스트리 대역: digest → revision
  printf '%s %s\n%s %s\n%s %s\n' "$DIGEST_A" "$REV_A" "$DIGEST_B" "$REV_B" "$DIGEST_C" "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" > "$FAKE_ROOT/registry"
  printf '%s' "$DIGEST_A" > "$FAKE_ROOT/registry_tag"
  printf '%s' "$DIGEST_A" > "$FAKE_ROOT/running_digest"
  printf 'healthy' > "$FAKE_ROOT/backend_health"
  printf 'healthy' > "$FAKE_ROOT/mysql_health"
  printf 'healthy' > "$FAKE_ROOT/redis_health"
  printf '0' > "$FAKE_ROOT/rooms"
}

converge() {
  env YORR_DEPLOY_CONFIG=/dev/null \
      YORR_CHECKOUT="$T/checkout" \
      YORR_STATE_DIR="$T/state" \
      YORR_IMAGE_REPO="$REPO" \
      YORR_WAIT_TIMEOUT=5 \
      "$SRC/converge" "$@" 2>&1
}
running_digest() { cat "$FAKE_ROOT/running_digest"; }
head_rev() { git -C "$T/checkout" rev-parse HEAD; }

# origin/main은 B인데 GHCR `:main`은 아직 A다 — main CI가 약 3분이므로 실제로 존재하는
# 상태다. 이때 git을 기준으로 배포하면 "설정은 B, 이미지는 A"가 된다(PLAN.md D1).
echo "1. CI/build race: git=B · GHCR=A → A를 유지한다"
setup
check "origin/main은 B다" "$REV_B" "$(git -C "$T/checkout" rev-parse origin/main)"
out=$(converge); rc=$?
check "종료 코드 0" 0 "$rc"
contains "no-op 로그" "할 일이 없다" "$out"
check "체크아웃은 A에 머문다" "$REV_A" "$(head_rev)"
check "실행 digest도 A다" "$DIGEST_A" "$(running_digest)"

# 2026-08-23 호스트 실측 상태의 재현: 체크아웃은 9커밋 뒤처졌는데 이미지는 `:main`으로
# 최신이라 digest가 같았다. 무변화 판정을 digest만으로 하면 controller가 "할 일 없다"로
# 넘어가고 **설정 불일치가 영구히 남는다** — 릴리스를 "revision + 설정 + digest"로
# 정의한 D1·D5를 판정이 배신하는 자리다.
echo "1b. 이미지는 같은데 체크아웃이 뒤처졌으면 수렴한다 (D1 불일치)"
setup
# 이미지는 A인 채로 실행 중이고 `:main`도 A다. 그런데 체크아웃만 옛 커밋(A)에 있고
# A 이미지의 revision 라벨은 B를 가리킨다 = 설정이 뒤처진 상태.
printf '%s %s\n' "$DIGEST_A" "$REV_B" > "$FAKE_ROOT/registry"
printf '%s' "$DIGEST_A" > "$FAKE_ROOT/registry_tag"
printf '%s' "$DIGEST_A" > "$FAKE_ROOT/running_digest"
printf 'ok' > "$FAKE_ROOT/up_results"
out=$(converge); rc=$?
check "종료 코드 0" 0 "$rc"
contains "불일치를 지목한다" "체크아웃이 다르다" "$out"
check "체크아웃이 이미지에 맞춰졌다" "$REV_B" "$(head_rev)"
check "last-good에 그 릴리스가 남았다" "REVISION=$REV_B" "$(grep REVISION "$T/state/last-good")"

echo "2. 정상 배포 A → B"
setup
printf '%s' "$DIGEST_B" > "$FAKE_ROOT/registry_tag"
printf 'ok' > "$FAKE_ROOT/up_results"
out=$(converge); rc=$?
check "종료 코드 0" 0 "$rc"
check "체크아웃이 B" "$REV_B" "$(head_rev)"
check "실행 digest가 B" "$DIGEST_B" "$(running_digest)"
check "last-good REVISION" "REVISION=$REV_B" "$(grep REVISION "$T/state/last-good")"
check "last-good IMAGE" "IMAGE=$DIGEST_B" "$(grep IMAGE "$T/state/last-good")"
check "HALT 없음" "없음" "$([[ -f $T/state/halted ]] && echo 있음 || echo 없음)"

echo "3. 깨진 backend → 릴리스 전체 롤백 + HALT"
setup
printf 'REVISION=%s\nIMAGE=%s\n' "$REV_A" "$DIGEST_A" > "$T/state/last-good"
printf '%s' "$DIGEST_B" > "$FAKE_ROOT/registry_tag"
printf 'fail ok' > "$FAKE_ROOT/up_results"   # 배포 실패 → 롤백 성공
out=$(converge); rc=$?
check "종료 코드 1" 1 "$rc"
check "체크아웃이 A로 돌아왔다" "$REV_A" "$(head_rev)"
check "실행 digest도 A로 돌아왔다" "$DIGEST_A" "$(running_digest)"
contains "HALT에 실패 revision" "FAILED_REVISION=$REV_B" "$(cat "$T/state/halted")"
contains "HALT에 실패 digest" "FAILED_IMAGE=$DIGEST_B" "$(cat "$T/state/halted")"
contains "HALT에 롤백 대상" "ROLLBACK_REVISION=$REV_A" "$(cat "$T/state/halted")"
contains "HALT에 원인" "REASON=" "$(cat "$T/state/halted")"

echo "4. HALT 상태면 아무것도 하지 않는다"
printf '%s' "$DIGEST_C" > "$FAKE_ROOT/registry_tag"
out=$(converge); rc=$?
check "종료 코드 0" 0 "$rc"
contains "HALT 안내" "HALT 상태다" "$out"
check "체크아웃 그대로" "$REV_A" "$(head_rev)"

echo "5. resume이 HALT를 푼다"
out=$(converge resume); rc=$?
check "종료 코드 0" 0 "$rc"
check "HALT 파일 삭제" "없음" "$([[ -f $T/state/halted ]] && echo 있음 || echo 없음)"

echo "6. 롤백까지 실패하면 CRITICAL이다"
setup
printf 'REVISION=%s\nIMAGE=%s\n' "$REV_A" "$DIGEST_A" > "$T/state/last-good"
printf '%s' "$DIGEST_B" > "$FAKE_ROOT/registry_tag"
printf 'fail fail' > "$FAKE_ROOT/up_results"
out=$(converge); rc=$?
check "종료 코드 1" 1 "$rc"
contains "CRITICAL 알림" "CRITICAL" "$out"
contains "HALT 원인에 롤백 실패" "롤백도 unhealthy" "$(cat "$T/state/halted")"

echo "7. 배포 전부터 깨져 있었으면 CRITICAL이 아니다 (PRE_EXISTING_FAILURE)"
setup
printf 'REVISION=%s\nIMAGE=%s\n' "$REV_A" "$DIGEST_A" > "$T/state/last-good"
printf 'unhealthy' > "$FAKE_ROOT/backend_health"
printf '%s' "$DIGEST_B" > "$FAKE_ROOT/registry_tag"
printf 'fail fail' > "$FAKE_ROOT/up_results"
out=$(converge); rc=$?
check "종료 코드 1" 1 "$rc"
contains "PRE_EXISTING_FAILURE" "PRE_EXISTING_FAILURE" "$(cat "$T/state/halted")"
contains "CRITICAL로 올리지 않는다" "no" "$([[ $out == *CRITICAL* ]] && echo yes || echo no)"

echo "8. backend가 깨져 있어도 배포는 진행한다 (D6)"
setup
printf 'unhealthy' > "$FAKE_ROOT/backend_health"
printf '%s' "$DIGEST_B" > "$FAKE_ROOT/registry_tag"
printf 'ok' > "$FAKE_ROOT/up_results"
out=$(converge); rc=$?
check "종료 코드 0" 0 "$rc"
check "새 릴리스가 올라갔다" "$REV_B" "$(head_rev)"
contains "진행한다는 로그" "배포는 진행한다" "$out"

echo "9. 인프라가 죽으면 배포하지 않는다 (D6)"
setup
printf 'unhealthy' > "$FAKE_ROOT/mysql_health"
printf '%s' "$DIGEST_B" > "$FAKE_ROOT/registry_tag"
out=$(converge); rc=$?
check "종료 코드 1" 1 "$rc"
contains "인프라 장애 알림" "인프라 장애다" "$out"
check "체크아웃 그대로" "$REV_A" "$(head_rev)"

echo "10. 게임이 진행 중이면 미룬다"
setup
printf '3' > "$FAKE_ROOT/rooms"
printf '%s' "$DIGEST_B" > "$FAKE_ROOT/registry_tag"
out=$(converge); rc=$?
check "종료 코드 0" 0 "$rc"
contains "미룬다" "미룬다" "$out"
check "체크아웃 그대로" "$REV_A" "$(head_rev)"
check "미룸 시각 기록" "있음" "$([[ -f $T/state/deferred-since ]] && echo 있음 || echo 없음)"

echo "11. 상한을 넘기면 게임 중에도 배포한다"
printf '%s' "$(( $(date -u +%s) - 99999 ))" > "$T/state/deferred-since"
out=$(env YORR_DEPLOY_MAX_DEFER=60 YORR_DEPLOY_CONFIG=/dev/null YORR_CHECKOUT="$T/checkout" \
  YORR_STATE_DIR="$T/state" YORR_IMAGE_REPO="$REPO" YORR_WAIT_TIMEOUT=5 "$SRC/converge" 2>&1); rc=$?
check "종료 코드 0" 0 "$rc"
contains "상한 안내" "그래도 배포한다" "$out"
check "배포됐다" "$REV_B" "$(head_rev)"

# D6이 preflight에서 경고한 것과 같은 함정이 게이트 쪽으로도 되살아날 수 있다:
# 게이지 조회는 컨테이너 안의 HTTP 왕복이라 crash 루프에서는 반드시 실패하고, 실패는
# "0이 아니다"로 다뤄져 미룸이 된다. 그러면 backend를 고치는 릴리스가 MAX_DEFER만큼
# 막힌다 — 가장 급할 때 멈추는 설계다.
echo "11b. backend가 깨져 있으면 게임 게이트를 묻지 않는다"
setup
printf 'unhealthy' > "$FAKE_ROOT/backend_health"
printf 'unknown' > "$FAKE_ROOT/rooms"          # 게이지를 읽지 못하는 상태
printf '%s' "$DIGEST_B" > "$FAKE_ROOT/registry_tag"
printf 'ok' > "$FAKE_ROOT/up_results"
out=$(converge); rc=$?
check "종료 코드 0" 0 "$rc"
contains "게이트를 건너뛴다" "게임 게이트를 건너뛴다" "$out"
check "고치는 릴리스가 올라갔다" "$REV_B" "$(head_rev)"

# compose config가 깨지면 `compose ps`도 실패한다. 순서가 뒤집히면 "mysql이 healthy가
# 아니다"라는 엉뚱한 진단이 나가고, 운영자가 없는 인프라 장애를 쫓게 된다.
echo "11c. compose config가 깨지면 그 사실을 진단으로 낸다"
setup
printf 'fail' > "$FAKE_ROOT/config_result"
printf '%s' "$DIGEST_B" > "$FAKE_ROOT/registry_tag"
out=$(converge); rc=$?
check "종료 코드 1" 1 "$rc"
contains "compose config를 지목한다" "compose config가 깨져 있다" "$out"
check "체크아웃 그대로" "$REV_A" "$(head_rev)"

echo "12. 발견한 revision이 git에 없으면 배포하지 않는다"
setup
printf '%s' "$DIGEST_C" > "$FAKE_ROOT/registry_tag"   # revision이 저장소에 없는 digest
out=$(converge); rc=$?
check "종료 코드 1" 1 "$rc"
contains "발견 불신" "git에 없다" "$out"
check "체크아웃 그대로" "$REV_A" "$(head_rev)"

echo "13. --dry-run은 아무것도 바꾸지 않는다"
setup
printf '%s' "$DIGEST_B" > "$FAKE_ROOT/registry_tag"
out=$(converge --dry-run); rc=$?
check "종료 코드 0" 0 "$rc"
check "체크아웃 그대로" "$REV_A" "$(head_rev)"
check "실행 digest 그대로" "$DIGEST_A" "$(running_digest)"
contains "후보를 보여 준다" "$REV_B" "$out"

echo "14. 수렴 중 손 실행은 진입하지 못한다 (single writer)"
setup
printf '%s' "$DIGEST_B" > "$FAKE_ROOT/registry_tag"
( flock -n 9 || exit 1; sleep 3 ) 9>"$T/state/lock" &
holder=$!
sleep 0.3
out=$(converge); rc=$?
check "종료 코드 0" 0 "$rc"
contains "건너뛴다" "이미 수렴 중이다" "$out"
wait $holder 2>/dev/null

echo "15. status가 실제 상태를 보여 준다"
setup
printf 'REVISION=%s\nIMAGE=%s\n' "$REV_A" "$DIGEST_A" > "$T/state/last-good"
out=$(converge status)
contains "desired" "desired release : $REV_A / $DIGEST_A" "$out"
contains "running" "running release : $REV_A / $DIGEST_A" "$out"
contains "automation" "automation      : RUNNING" "$out"
contains "backend" "backend         : healthy" "$out"

echo "16. rollback은 릴리스 전체를 되돌리고 HALT를 남긴다"
setup
git -C "$T/checkout" reset --hard -q "$REV_B"
printf '%s' "$DIGEST_B" > "$FAKE_ROOT/running_digest"
printf 'REVISION=%s\nIMAGE=%s\n' "$REV_A" "$DIGEST_A" > "$T/state/last-good"
printf 'ok' > "$FAKE_ROOT/up_results"
out=$(converge rollback); rc=$?
check "종료 코드 0" 0 "$rc"
check "체크아웃이 A" "$REV_A" "$(head_rev)"
check "실행 digest가 A" "$DIGEST_A" "$(running_digest)"
check "HALT를 남긴다" "있음" "$([[ -f $T/state/halted ]] && echo 있음 || echo 없음)"

echo "17. apply.sh가 .env에 digest를 남긴다(다음 손 compose가 같은 릴리스를 본다)"
check "BACKEND_IMAGE" "BACKEND_IMAGE=$REPO@$DIGEST_A" "$(grep BACKEND_IMAGE "$T/checkout/deploy/.env")"
check ".env 권한 유지" "600" "$(stat -c %a "$T/checkout/deploy/.env")"

printf '\n합계: %d 통과 / %d 실패\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
