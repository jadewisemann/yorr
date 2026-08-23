#!/usr/bin/env bash
# 지금 무엇이 돌고 있는지. 운영 인터페이스는 이것과 journalctl 둘이면 충분하다.
#
#   deploy/status.sh                  # desired / running / last-good / HALT
#   journalctl -u yorr-converge       # 무엇을 판단했는지
#
# 판단 로직을 여기 복제하지 않는다 — 하나뿐인 구현(controller)에 그대로 넘긴다.
# **설치된 사본을 먼저 찾는 이유**: 그것이 타이머가 실제로 실행하는 파일이다.
# 체크아웃의 사본을 먼저 보면 "여기서는 이렇게 나오는데 자동 배포는 다르게 판단한다"는
# 상황을 만들 수 있다.
set -euo pipefail

for candidate in \
  "${YORR_CONTROLLER:-}" \
  /usr/local/lib/yorr-deploy/converge \
  "$(dirname "$(readlink -f "$0")")/converge"; do
  [[ -n $candidate && -x $candidate ]] || continue
  exec "$candidate" status "$@"
done

echo "!! controller를 찾지 못했다. 설치: deploy/bootstrap.sh" >&2
exit 1
