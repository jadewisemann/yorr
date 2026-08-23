#!/usr/bin/env bash
# last-good 릴리스로 되돌린다 — git revision과 image digest를 **함께** 되돌린다.
#
#   deploy/rollback.sh
#
# 이미지만 되돌리지 않는 이유(PLAN.md D5): 그러면 "이미지는 A, 설정은 B"가 되고,
# 그것은 릴리스 경계를 어긴 배포와 같은 종류의 불일치다. `compose.yaml`이 공개
# 주소·필수 변수의 정본이므로 실제로 로그인이 깨지는 조합이 나온다.
#
# 되돌린 뒤 자동 배포는 **HALT 상태로 남는다.** 풀지 않으면 다음 회차가 방금 되돌린
# 그 릴리스를 다시 올려 5분마다 게임을 죽이는 플랩이 된다. 원인을 고친 뒤:
#
#   deploy/status.sh                                  # HALT 원인 확인
#   /usr/local/lib/yorr-deploy/converge resume        # 자동 배포 재개
set -euo pipefail

for candidate in \
  "${YORR_CONTROLLER:-}" \
  /usr/local/lib/yorr-deploy/converge \
  "$(dirname "$(readlink -f "$0")")/converge"; do
  [[ -n $candidate && -x $candidate ]] || continue
  exec "$candidate" rollback "$@"
done

echo "!! controller를 찾지 못했다. 설치: deploy/bootstrap.sh" >&2
exit 1
