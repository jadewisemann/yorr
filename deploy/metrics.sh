#!/usr/bin/env bash
# 계측 수집기의 운영 진입점 — `-f`와 `--env-file` 조합을 외우지 않게 한다.
#
#   deploy/metrics.sh up        # 띄우기 · 설정 변경 반영 (검증 후에만 재기동한다)
#   deploy/metrics.sh check     # 설정 문법만 검증한다
#   deploy/metrics.sh logs      # 수집이 되고 있나
#   deploy/metrics.sh status    # 지금 도는가
#   deploy/metrics.sh pin       # 지금 도는 이미지의 digest (고정용)
#   deploy/metrics.sh down      # 내리기
#
# 이것은 **배포 경로가 아니다.** 왜 별도 프로젝트인지는 compose.metrics.yaml의
# 머리 주석에 있다. `converge`는 이 파일을 부르지 않는다.
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

COMPOSE=(docker compose -f compose.metrics.yaml)
CONFIG_IN_CONTAINER=/etc/alloy/config.alloy

[[ -f .env ]] || {
  echo "!! deploy/.env가 없다 — Grafana Cloud 자격을 읽을 수 없다." >&2
  echo "   .env.example의 「계측」 절을 참고해 다섯 줄을 채운다." >&2
  exit 1
}

# 이미지 이름을 compose에서 그대로 가져온다 — 두 곳에 적어 어긋나는 것을 막는다.
alloy_image() {
  "${COMPOSE[@]}" config --images 2>/dev/null | head -n1
}

# 설정 검증. **재기동보다 먼저 한다** — 문법이 깨진 설정으로 재기동하면 지금 잘
# 돌고 있는 수집기를 재시작 루프로 바꾼다.
check_config() {
  local image
  image=$(alloy_image)
  [[ -n $image ]] || { echo "!! 이미지 이름을 읽지 못했다." >&2; return 1; }
  echo "== 설정 검증 ($image)"
  # `sys.env`로 읽는 값들은 검증 시점에 비어 있으면 걸릴 수 있으므로 자리만 채운다.
  docker run --rm \
    -v "$PWD/alloy/config.alloy:$CONFIG_IN_CONTAINER:ro" \
    -e GC_PROM_URL=https://example.invalid/api/prom/push \
    -e GC_PROM_USER=0 -e GC_PROM_TOKEN=x \
    -e GC_LOKI_URL=https://example.invalid/loki/api/v1/push \
    -e GC_LOKI_USER=0 -e GC_LOKI_TOKEN=x \
    -e GC_BACKEND_TARGET=backend:8080 \
    "$image" validate "$CONFIG_IN_CONTAINER"
}

case ${1:-up} in
  up)
    check_config
    # textfile 컬렉터가 읽을 곳. converge가 먼저 돌았으면 이미 있다.
    metrics_dir=$(sed -n 's/^YORR_STATE_DIR=//p' /etc/default/yorr-deploy 2>/dev/null | tail -n1)
    metrics_dir=${metrics_dir:-/var/lib/yorr-deploy}/metrics
    [[ -d $metrics_dir ]] || {
      # 평소에는 bootstrap.sh가 만들어 둔다. 여기서 만드는 것은 계측만 먼저 붙일
      # 때를 위한 보험이고, **소유자를 controller와 맞추는 것이 요점이다** —
      # root 소유로 만들면 converge가 자기 계열을 쓰지 못한다.
      owner=$(stat -c %U "$(dirname "$metrics_dir")" 2>/dev/null || echo root)
      echo "-- $metrics_dir 가 없다 — $owner 소유로 만든다"
      sudo install -d -m 755 -o "$owner" "$metrics_dir"
    }
    echo
    "${COMPOSE[@]}" up -d
    echo
    "${COMPOSE[@]}" ps
    ;;
  check)  check_config ;;
  logs)   "${COMPOSE[@]}" logs --tail "${2:-80}" -f alloy ;;
  status) "${COMPOSE[@]}" ps ;;
  pin)
    cid=$("${COMPOSE[@]}" ps -q alloy)
    [[ -n $cid ]] || { echo "!! 도는 컨테이너가 없다 — 먼저 up." >&2; exit 1; }
    img=$(docker inspect --format '{{.Image}}' "$cid")
    echo "compose.metrics.yaml 또는 .env의 ALLOY_IMAGE에 이 값을 박는다:"
    docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$img" |
      grep -F 'grafana/alloy@' | head -n1
    ;;
  down)   "${COMPOSE[@]}" down ;;
  *)
    echo "쓰임: $0 {up|check|logs|status|pin|down}" >&2
    exit 1
    ;;
esac
