#!/usr/bin/env bash
# YORR 백엔드 자동 배포 — **게임이 없을 때만** 배포한다.
#
# systemd timer가 몇 분 간격으로 이것을 부른다(deploy/systemd/). 한 번 실행이
# 한 판단이고, 조건이 안 맞으면 아무것도 하지 않고 끝난다(다음 회차에 다시 본다).
#
#   ① git pull → ② 이미지 pull → ③ 바뀐 것이 있나? → ④ 게임이 없나? → ⑤ 배포
#
# 왜 호스트가 "당기는가"(GitHub Actions가 SSH로 "밀지" 않는가):
#   · ADR-0006 §3이 자동 배포를 기각한 이유 두 개를 둘 다 피한다. 배포 키를
#     GitHub Secrets에 두지 않으므로 **저장소 쓰기 권한이 운영 셸 권한이 되지
#     않고**, 22번 포트를 러너에게 열 필요도 없다(여는 것은 여전히 80·443뿐).
#   · "사람이 한가한 시간을 고른다"는 완화책을 **측정으로 대체한다**:
#     `yorr_rooms_active`(PLAYING 방 수)가 0일 때만 배포한다. 사람의 눈대중보다
#     정확하다 — 배포가 게임을 끊는다는 사실 자체는 변하지 않았다(DESIGN.md 원칙 8).
#
# 조절 가능한 것(환경변수 또는 systemd Environment=):
#   YORR_DEPLOY_MAX_DEFER  게임 때문에 미룬 지 이 초를 넘기면 그래도 배포한다.
#                          기본 21600(6시간). 0이면 "영원히 기다린다".
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

MAX_DEFER=${YORR_DEPLOY_MAX_DEFER:-21600}
STATE=${YORR_DEPLOY_STATE_DIR:-/var/tmp}/yorr-auto-deploy-pending

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# 진행 중인 게임 수(`yorr_rooms_active` = phase가 PLAYING인 방). 읽지 못하면
# `unknown`이고 호출자는 그것을 "0이 아니다"로 다룬다 — 못 읽었을 때 끊는 쪽으로
# 기울지 않는다(영원한 대기는 MAX_DEFER 상한이 막는다).
#
# 컨테이너 **안에서** 묻는다: backend는 포트를 공개하지 않으므로(compose 계약)
# 호스트에서 직접 닿을 길이 없고, Caddy를 경유하면 TLS·DNS까지 이 판단에 끼어든다.
active_rooms() {
  local counted
  counted=$(docker compose exec -T backend node -e '
    fetch("http://127.0.0.1:8080/actuator/prometheus")
      .then((response) => response.text())
      .then((body) => {
        const matched = /^yorr_rooms_active (\d+)$/m.exec(body)
        console.log(matched === null ? "unknown" : matched[1])
      })
      .catch(() => console.log("unknown"))' 2>/dev/null | tr -d '\r' | tail -n1)
  [[ $counted =~ ^[0-9]+$ ]] && printf '%s' "$counted" || printf 'unknown'
}

# ── ① 설정·compose 갱신 ───────────────────────────────────────────────────────
# deploy/compose.yaml은 **이미지가 아니라 이 체크아웃에서** 읽힌다. 공개 주소
# (CORS 목록·콜백 세 개)의 정본이 그 파일이므로 이미지만 갱신하면 옛 설정으로 뜬다.
before=$(git rev-parse HEAD)
git pull --ff-only --quiet
after=$(git rev-parse HEAD)

config_changed=false
if [[ $before != "$after" ]] && ! git diff --quiet "$before" "$after" -- deploy/; then
  config_changed=true
fi

# ── ② 이미지 내려받기 ─────────────────────────────────────────────────────────
docker compose pull --quiet backend

# ── ③ 바꿀 것이 있나 ─────────────────────────────────────────────────────────
# 이미지 비교는 **컨테이너 자기 정보**로 한다: `.Config.Image`가 그 컨테이너를 만든
# 참조(태그)이고, `.Image`가 그때 실제로 쓰인 이미지 ID다. 같은 태그를 지금 조회한
# ID와 다르면 pull이 새 것을 가져온 것이다.
#
# ⚠️ `docker compose config --images backend`를 쓰지 않는다 — **서비스 인자를 무시하고
#    스택 전체를 출력한다**(실측: mysql·backend·redis 순). 첫 줄을 집으면 mysql을 집는다.
#    이미지 이름을 여기 적어 두는 방법도 피했다 — compose.yaml의 기본값과 갈라진다.
existing=$(docker compose ps -aq backend || true)   # 멈춘 것까지 — 존재 여부
running=$(docker compose ps -q backend || true)     # 실행 중인 것만

image_changed=false
if [[ -n $existing ]]; then
  running_image=$(docker inspect --format '{{.Image}}' "$existing")
  image_ref=$(docker inspect --format '{{.Config.Image}}' "$existing")
  pulled_image=$(docker image inspect --format '{{.Id}}' "$image_ref" 2>/dev/null || true)
  [[ -n $pulled_image && $pulled_image != "$running_image" ]] && image_changed=true
fi

# **바뀐 것이 없으면 아무것도 하지 않는다.** 이 스크립트는 *변경*에만 반응하고
# 상태에 반응하지 않는다 — 그래서 컨테이너가 없거나 멈춰 있어도 스스로 띄우지
# 않는다(첫 기동은 `docker compose up -d`로 사람이 한다. 운영자가 일부러 내려
# 둔 것을 5분마다 되살리는 싸움을 하지 않는 것이 더 중요하다).
#
# 단, 내려 둔 사이에 새 이미지가 오면 그때는 `up -d`가 다시 띄운다 — 오래 내려
# 두어야 하면 타이머를 끈다(`systemctl disable --now yorr-auto-deploy.timer`).
if [[ $image_changed == false && $config_changed == false ]]; then
  rm -f "$STATE"
  exit 0            # 조용히 끝낸다 — 아무 일도 없었다는 로그는 소음이다.
fi

log "배포 대상: image_changed=$image_changed config_changed=$config_changed"

# ── ④ 게임이 없나 ────────────────────────────────────────────────────────────
# 실행 중이 아니면 끊을 게임도 없다 — 게이지를 묻지 않는다.
if [[ -z $running ]]; then
  log "backend가 실행 중이 아니다 — 끊을 게임이 없다."
else
  rooms=$(active_rooms)

  if [[ $rooms != 0 ]]; then
    # 처음 미룬 시각을 기록해 둔다 — 바쁜 서버에서 영원히 밀리지 않게 하는 상한.
    [[ -f $STATE ]] || date -u +%s > "$STATE"
    waited=$(( $(date -u +%s) - $(cat "$STATE") ))
    if [[ $MAX_DEFER -gt 0 && $waited -ge $MAX_DEFER ]]; then
      log "게임 $rooms개 진행 중이지만 ${waited}초 미뤘다(상한 ${MAX_DEFER}s) — 그래도 배포한다."
    else
      log "게임 $rooms개 진행 중 — 미룬다(누적 ${waited}s). 다음 회차에 다시 본다."
      exit 0
    fi
  fi
fi

# ── ⑤ 배포 ───────────────────────────────────────────────────────────────────
# 손으로 하는 것과 **같은 경로**를 쓴다(두 갈래로 갈라지면 한쪽만 낡는다).
log "배포 시작"
./deploy.sh -y
rm -f "$STATE"
log "배포 완료"
