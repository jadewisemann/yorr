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
  printf '0' > "$FAKE_ROOT/players"
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

# cutover 첫 회차의 실측 상태: 사람이 손으로 git pull을 해서 **체크아웃만 앞서 나갔다**.
# 그때 롤백 대상을 체크아웃에서 가져오면 "새 설정 + 옛 이미지"가 되어, D5가 막으려는
# 불일치를 롤백이 스스로 만든다. 실행 중인 릴리스의 revision은 그 이미지의 라벨이다.
echo "3b. 체크아웃이 앞서 나간 상태에서도 롤백은 실행 중이던 릴리스로 돌아간다"
setup
# 실행 중: A 이미지(라벨 REV_A). 체크아웃: 손 pull로 이미 REV_B. 후보: B.
git -C "$T/checkout" reset --hard -q "$REV_B"
printf '%s' "$DIGEST_A" > "$FAKE_ROOT/running_digest"
printf '%s' "$DIGEST_B" > "$FAKE_ROOT/registry_tag"
printf 'fail ok' > "$FAKE_ROOT/up_results"   # 배포 실패 → 롤백
out=$(converge); rc=$?
check "종료 코드 1" 1 "$rc"
# 체크아웃이 REV_B였더라도 되돌아갈 곳은 실행 중이던 이미지의 revision인 REV_A다.
check "체크아웃이 REV_A로 돌아갔다" "$REV_A" "$(head_rev)"
check "이미지도 A다" "$DIGEST_A" "$(running_digest)"
contains "HALT의 롤백 대상이 REV_A다" "ROLLBACK_REVISION=$REV_A" "$(cat "$T/state/halted")"
contains "불일치를 로그에 남긴다" "체크아웃이 실행 중 릴리스와 다르다" "$out"

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

echo "10. 사람이 플레이 중이면 미룬다"
setup
printf '3' > "$FAKE_ROOT/rooms"
printf '2' > "$FAKE_ROOT/players"
printf '%s' "$DIGEST_B" > "$FAKE_ROOT/registry_tag"
out=$(converge); rc=$?
check "종료 코드 0" 0 "$rc"
contains "미룬다" "미룬다" "$out"
check "체크아웃 그대로" "$REV_A" "$(head_rev)"
check "미룸 시각 기록" "있음" "$([[ -f $T/state/deferred-since ]] && echo 있음 || echo 없음)"

# 2026-08-24 운영 실측: 방은 PLAYING으로 세어지는데 라이브 소켓이 0이었다.
#
#     yorr_rooms_active 1
#     yorr_game_participants_active{game="YACHT_DICE"} 0
#
# 원인은 인메모리 누수다(PLAYING 방의 마지막 소켓이 끊기면 좌석이 markOffline으로 남고
# phase가 playing으로 남는다). 방을 세는 게이트는 **이미 없는 방** 때문에 매번
# MAX_DEFER(6시간)까지 배포를 미뤘다. 끊길 사람이 없으면 미룰 이유도 없다.
echo "10b. 유령 방(사람 0)은 게이트를 막지 못한다"
setup
printf '1' > "$FAKE_ROOT/rooms"      # phase가 PLAYING인 방 하나
printf '0' > "$FAKE_ROOT/players"    # 그런데 라이브 소켓은 0
printf '%s' "$DIGEST_B" > "$FAKE_ROOT/registry_tag"
printf 'ok' > "$FAKE_ROOT/up_results"
out=$(converge); rc=$?
check "종료 코드 0" 0 "$rc"
check "미루지 않고 배포했다" "$REV_B" "$(head_rev)"
check "미룸 기록도 남지 않았다" "없음" \
  "$([[ -f $T/state/deferred-since ]] && echo 있음 || echo 없음)"
check "미룬다는 로그가 없다" "없음" "$([[ $out == *미룬다* ]] && echo 있음 || echo 없음)"

# 앞 테스트의 잔여 상태에 기대지 않고 스스로 상황을 만든다 — 사이에 시나리오가
# 하나 끼는 것만으로 조용히 무의미해지는 테스트였다(실제로 그렇게 됐다).
echo "11. 상한을 넘기면 사람이 있어도 배포한다"
setup
printf '3' > "$FAKE_ROOT/rooms"
printf '2' > "$FAKE_ROOT/players"
printf '%s' "$DIGEST_B" > "$FAKE_ROOT/registry_tag"
printf 'ok' > "$FAKE_ROOT/up_results"
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
printf 'missing' > "$FAKE_ROOT/gauge_result"   # 게이지를 읽지 못하는 상태
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

# 설정 파일을 `source`로 읽으면 그 파일에 들어온 무엇이든 실행된다. 편집기 붙여넣기가
# 한 번 어긋나 파일 앞에 `ssh …` 줄이 끼었던 실제 사고(2026-08-23)가 그 위험을 보여
# 줬다. systemd의 EnvironmentFile처럼 **파싱만** 하는지 고정한다.
echo "14b. 설정 파일의 이상한 줄을 실행하지 않고 경고만 한다"
setup
# 실행되는 줄을 **깨진 줄보다 앞에** 둔다. 뒤에 두면 `source` 방식에서도 `set -e`가
# 깨진 줄에서 먼저 죽어 실행에 도달하지 않고, 테스트가 줄 순서 운에 기대게 된다.
cat > "$T/bad.env" <<EOF
# 정상 주석
touch $FAKE_ROOT/EXECUTED
ssh -t -i ~/.ssh/x opc@1.2.3.4 'echo 침입'
YORR_DISK_MIN_FREE_PCT=99
이건 알 수 없는 줄이다
EOF
printf '%s' "$DIGEST_B" > "$FAKE_ROOT/registry_tag"
out=$(env YORR_DEPLOY_CONFIG="$T/bad.env"   YORR_CHECKOUT="$T/checkout" YORR_STATE_DIR="$T/state" YORR_IMAGE_REPO="$REPO"   "$SRC/converge" 2>&1); rc=$?
check "파일의 명령이 실행되지 않았다" "없음"   "$([[ -e $FAKE_ROOT/EXECUTED ]] && echo 있음 || echo 없음)"
contains "알 수 없는 줄을 경고한다" "알 수 없는 줄" "$out"
# 정상 키는 실제로 읽혔다: 여유 99% 미만이면 배포하지 않는다 = preflight가 거부한다.
check "정상 키는 반영됐다(디스크 임계 99%)" 1 "$rc"
contains "디스크를 지목한다" "디스크 여유가 99% 미만" "$out"
check "체크아웃 그대로" "$REV_A" "$(head_rev)"

echo "15. status가 실제 상태를 보여 준다"
setup
printf 'REVISION=%s\nIMAGE=%s\n' "$REV_A" "$DIGEST_A" > "$T/state/last-good"
out=$(converge status)
contains "desired" "desired release : $REV_A / $DIGEST_A" "$out"
contains "running" "running release : $REV_A / $DIGEST_A" "$out"
contains "automation" "automation      : RUNNING" "$out"
contains "backend" "backend         : healthy" "$out"
check "같을 때는 체크아웃 줄이 없다" "없음" \
  "$([[ $out == *checkout* ]] && echo 있음 || echo 없음)"

# 2026-08-24 호스트에서 실제로 본 상태: 게임 때문에 배포를 미루는 동안 체크아웃만
# 앞서 나갔다. 그때 status가 git HEAD를 "실행 중 revision"으로 찍어 **journal과 서로
# 다른 답**을 냈다. 운영자가 "지금 무엇이 돌고 있는가"를 보려고 읽는 화면이다.
echo "15b. 체크아웃이 앞서 나갔으면 status가 실행 중 릴리스를 정확히 말한다"
setup
git -C "$T/checkout" reset --hard -q "$REV_B"        # 손 pull로 앞서 나간 체크아웃
printf '%s' "$DIGEST_A" > "$FAKE_ROOT/running_digest"  # 실행 중은 A 이미지(라벨 REV_A)
out=$(converge status)
contains "실행 중 revision은 이미지 라벨이다" "running release : $REV_A / $DIGEST_A" "$out"
contains "체크아웃을 따로 보여 준다" "checkout        : $REV_B" "$out"
check "체크아웃을 실행 중으로 오인하지 않는다" "아니다" \
  "$([[ $out == *"running release : $REV_B"* ]] && echo 오인한다 || echo 아니다)"

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
