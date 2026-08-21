#!/usr/bin/env bash
# YORR 백엔드 배포 — OCI 호스트에서 사람이 실행한다.
#
#   ~/yorr/deploy/deploy.sh          # 확인을 한 번 묻고 배포
#   ~/yorr/deploy/deploy.sh -y       # 묻지 않는다(배포 창을 이미 정한 경우)
#
# 자동 배포를 걸지 않는 이유는 이 스크립트가 존재하는 이유와 같다: **배포가 진행 중
# 게임을 끊는다**(WS 구독·라운드 마감 타이머가 프로세스 인메모리 — DESIGN.md 원칙 8,
# ADR-0006). 그래서 "언제 할지"는 사람이 정하고, "무엇을 할지"만 여기 고정한다.
#
# 순서가 계약이다:
#   1) git pull  — deploy/compose.yaml은 **이미지가 아니라 이 체크아웃에서** 읽힌다.
#                  공개 주소(CORS 목록·콜백 세 개)의 정본이 그 파일이므로, 빼먹으면
#                  새 이미지가 옛 설정으로 뜬다(증상은 "배포했는데 그대로").
#   2) pull      — GitHub Actions가 GHCR에 올린 linux/arm64 이미지를 내려받는다.
#   3) up -d     — backend만 교체한다(MySQL·Redis·Caddy는 건드리지 않는다).
#   4) 확인      — 기동 실패는 exit≠0으로만 드러난다(HTTP 헬스체크가 아니다).
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

assume_yes=false
pin=""
while [[ $# -gt 0 ]]; do
  case $1 in
    -y | --yes) assume_yes=true ;;
    # 배포할 이미지 태그. `main`이면 고정을 **푼다**(평상시 상태로 되돌린다).
    --tag) shift; pin=${1-} ;;
    *) echo "쓰임: $0 [-y] [--tag <main|sha-xxxxxxx>]" >&2; exit 2 ;;
  esac
  shift
done

# ── 이미지 고정(롤백) ────────────────────────────────────────────────────────
# 고정은 `.env`의 `BACKEND_IMAGE`에 적는다 — 셸 환경변수로만 주면 이 실행에만
# 걸리고 **5분 타이머가 다음 회차에 `:main`으로 되돌린다**(그때 증상은 "롤백했는데
# 잠시 뒤 다시 올라갔다"라서 원인을 찾기 어렵다).
#
# ⚠️ sha에 고정해 두면 자동 배포는 **아무것도 하지 않는다**(그 태그는 움직이지
#    않으므로). 그것이 롤백의 의도다 — 원인을 고친 뒤 `--tag main`으로 푼다.
if [[ -n $pin ]]; then
  image_repo="ghcr.io/jadewisemann/yorr-backend"
  sed -i'' -e '/^BACKEND_IMAGE=/d' .env
  if [[ $pin == main ]]; then
    echo "== 이미지 고정 해제 — 평상시(:main)로 되돌린다"
  else
    echo "== 이미지 고정: $image_repo:$pin (자동 배포는 이 태그에 머문다)"
    printf 'BACKEND_IMAGE=%s:%s\n' "$image_repo" "$pin" >> .env
  fi
fi

branch=$(git rev-parse --abbrev-ref HEAD)
echo "== 체크아웃: $branch @ $(git rev-parse --short HEAD)"
[[ $branch == main ]] || echo "!! main이 아니다 — 의도한 것인지 확인하라."

if [[ $assume_yes == false ]]; then
  echo
  echo "이 배포는 **진행 중인 게임을 끊는다.** 접속자를 확인했다면 계속한다."
  read -r -p "계속할까? [y/N] " answer
  [[ $answer == y || $answer == Y ]] || { echo "취소했다."; exit 1; }
fi

echo
echo "== 1/4 설정·compose 갱신 (git pull)"
git pull --ff-only

echo
echo "== 2/4 이미지 내려받기"
docker compose pull backend

echo
echo "== 3/4 backend 교체"
docker compose up -d backend

echo
echo "== 4/4 확인"
# 기동 중(스키마 확인·MySQL 왕복)에는 아직 죽지 않았을 수 있어 잠깐 기다린다.
sleep 15
docker compose ps
echo
echo "-- 주입된 공개 주소 (정본은 compose.yaml, .env에 값이 있으면 그것이 이긴다)"
docker compose config | grep -E "CORS_ALLOWED_ORIGINS|AUTH_FRONTEND_REDIRECT_URI|REDIRECT_URI" || true
echo
echo "-- backend 로그 (마지막 50줄)"
docker compose logs --tail 50 backend
