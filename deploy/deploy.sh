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
[[ ${1-} == -y || ${1-} == --yes ]] && assume_yes=true

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
