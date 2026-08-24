#!/usr/bin/env bash
# controller를 호스트에 심는다. **여러 번 실행해도 같은 결과다**(idempotent).
#
#   deploy/bootstrap.sh                  # 심기만 한다(타이머는 켜지 않는다)
#   deploy/bootstrap.sh --enable-timer   # 심고 5분 타이머까지 켠다
#   deploy/bootstrap.sh --uninstall      # 타이머 끄고 유닛·controller 제거(상태는 남긴다)
#
# 타이머를 기본으로 켜지 않는 이유: cutover 절차가 "손으로 한 번 → test release →
# 롤백 강제 테스트 → 그다음 타이머"이기 때문이다(PLAN.md PR 4). 지난번 자동화는
# **한 번도 실행되지 않은 채 머지됐다**(`deploy.yml` 0회 실행). 기본값이 "켜짐"이면
# 검증 없이 켜는 쪽으로 기울고, 그러면 같은 결과가 난다.
#
# ── 무엇을 어디에 두는가 ──────────────────────────────────────────────────────
#   /usr/local/lib/yorr-deploy/converge   controller(체크아웃 바깥 — git reset에 안 흔들린다)
#   /etc/default/yorr-deploy              호스트별 설정(**git 추적 파일이 아니다**)
#   /etc/systemd/system/yorr-converge.*   유닛(템플릿의 @USER@를 이 실행의 계정으로 치환)
#   /var/lib/yorr-deploy/                 last-good · halted · lock
#
# 설정을 git 밖에 두는 것이 이 스크립트의 존재 이유다. 예전 안내는 유닛 파일을 손으로
# 고치라고 했고, 그 파일은 git 추적 파일이라 고치면 `git pull --ff-only`가 막힌다 —
# 세 배포 경로가 그 한 줄을 공유하므로 동시에 죽는다(PLAN.md §4 가설 1).
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

LIB_DIR=/usr/local/lib/yorr-deploy
UNIT_DIR=/etc/systemd/system
CONFIG=/etc/default/yorr-deploy
STATE_DIR=/var/lib/yorr-deploy

enable_timer=false
action=install
while [[ $# -gt 0 ]]; do
  case $1 in
    --enable-timer) enable_timer=true ;;
    --uninstall) action=uninstall ;;
    *) echo "쓰임: $0 [--enable-timer] [--uninstall]" >&2; exit 2 ;;
  esac
  shift
done

command -v systemctl >/dev/null || { echo "systemd가 없다 — 이 호스트에는 설치할 수 없다." >&2; exit 1; }

if [[ $action == uninstall ]]; then
  echo "== 타이머를 끄고 유닛·controller를 지운다"
  # 상태 디렉터리는 남긴다 — last-good이 사라지면 다음 실패에서 되돌릴 대상이 없다.
  sudo systemctl disable --now yorr-converge.timer 2>/dev/null || true
  sudo rm -f "$UNIT_DIR/yorr-converge.service" "$UNIT_DIR/yorr-converge.timer"
  sudo systemctl daemon-reload
  sudo rm -rf "$LIB_DIR"
  echo "완료 — $STATE_DIR 와 $CONFIG 는 그대로 두었다."
  exit 0
fi

user=$(id -un)
checkout=$(cd .. && pwd)

echo "== 설치: User=$user 체크아웃=$checkout"
id -nG "$user" | tr ' ' '\n' | grep -qx docker ||
  echo "!! $user 가 docker 그룹에 없다 — 수렴이 도커를 못 부를 수 있다(id -nG 로 확인)."

# ── 1. controller ────────────────────────────────────────────────────────────
sudo install -d -m 755 "$LIB_DIR"
sudo install -m 755 converge "$LIB_DIR/converge"
echo "-- $LIB_DIR/converge"

# ── 2. 호스트별 설정 ─────────────────────────────────────────────────────────
# **이미 있으면 덮어쓰지 않는다.** 여기에 알림 웹훅·하트비트 URL이 들어 있고, 그것을
# 재설치가 날려 버리면 다음 실패가 조용해진다.
if [[ -f $CONFIG ]]; then
  echo "-- $CONFIG (이미 있다 — 그대로 둔다)"
else
  sudo tee "$CONFIG" >/dev/null <<EOF
# YORR 배포 controller 설정 — **git이 추적하지 않는 파일이다.**
# 유닛이나 스크립트를 손으로 고치는 대신 여기를 고친다.
YORR_CHECKOUT=$checkout
YORR_IMAGE_REPO=ghcr.io/jadewisemann/yorr-backend
# 발견용 태그. 실행은 언제나 digest로 고정된다.
YORR_DISCOVERY_TAG=main
# up -d --wait 의 상한(초).
YORR_WAIT_TIMEOUT=150
# 게임 때문에 미루는 시간의 상한(초). 0이면 게임이 끝날 때까지 영원히 기다린다.
# 이 게이트는 마감 시각 영속화(PR 6) 이후 PR 7에서 사라진다.
YORR_DEPLOY_MAX_DEFER=21600
# 디스크 여유가 이 비율 미만이면 배포하지 않는다(퍼센트).
YORR_DISK_MIN_FREE_PCT=10
# 실패·롤백·HALT를 보낼 Discord 웹훅. 비어 있으면 로그에만 남는다.
YORR_NOTIFY_WEBHOOK=
# 한 회차가 건강하게 끝날 때 ping하는 데드맨 URL(무변화·게임 때문에 미룸·배포 성공).
# **HALT·인프라 장애·배포 실패에는 보내지 않는다** — 멈춘 자동화는 죽은 자동화이고,
# 그것을 알리는 것이 데드맨의 존재 이유다.
YORR_HEARTBEAT_URL=
EOF
  echo "-- $CONFIG (새로 만들었다 — 웹훅·하트비트 URL을 채워라)"
fi

# ── 3. 상태 디렉터리 ─────────────────────────────────────────────────────────
# 유닛의 StateDirectory=가 systemd 실행에서 이것을 보장하지만, 손 실행도 같은 곳을
# 보므로 미리 만들어 둔다.
sudo install -d -m 755 -o "$user" "$STATE_DIR"
echo "-- $STATE_DIR"
# textfile 컬렉터가 읽는 곳(deploy/alloy/config.alloy). **여기서 미리 만드는 것이
# 중요하다**: 없으면 docker가 바인드 마운트 시점에 root 소유로 만들고, 그러면
# `$user`로 도는 converge가 자기 계열을 쓰지 못한 채 조용히 포기한다.
# 755이므로 컨테이너의 root(백업 서비스)와 `$user`(converge)가 둘 다 쓸 수 있다.
sudo install -d -m 755 -o "$user" "$STATE_DIR/metrics"
echo "-- $STATE_DIR/metrics (계측)"

# ── 4. 유닛 ──────────────────────────────────────────────────────────────────
# 템플릿의 @USER@만 치환한다. **추적 파일은 건드리지 않는다** — 그것이 이 단계의 요점이다.
sed "s|@USER@|$user|" systemd/yorr-converge.service |
  sudo tee "$UNIT_DIR/yorr-converge.service" >/dev/null
sudo install -m 644 systemd/yorr-converge.timer "$UNIT_DIR/yorr-converge.timer"
sudo systemctl daemon-reload
echo "-- $UNIT_DIR/yorr-converge.{service,timer}"

if $enable_timer; then
  sudo systemctl enable --now yorr-converge.timer
  echo
  sudo systemctl list-timers yorr-converge.timer --no-pager || true
else
  echo
  echo "타이머는 켜지 않았다. cutover 순서(PLAN.md PR 4):"
  echo "  1) $LIB_DIR/converge --dry-run   # 판단만 — 아무것도 바꾸지 않는다"
  echo "  2) $LIB_DIR/converge             # 손으로 한 번. 같은 릴리스면 no-op이어야 한다"
  echo "  3) test release 배포 → health 확인"
  echo "  4) 롤백을 강제로 테스트 → deploy/status.sh 로 HALT 확인 → converge resume"
  echo "  5) $0 --enable-timer"
  echo "  6) 옛 타이머 끄기: sudo systemctl disable --now yorr-auto-deploy.timer"
fi

# journald가 휘발성이면 **운영 인터페이스가 재부팅에서 비워진다.** `Storage=auto`(기본값)는
# /var/log/journal이 있을 때만 영속으로 쓰고, 없으면 로그가 메모리에만 남는다. 여기서
# 말해 주지 않으면 「journalctl에 아무것도 없다」를 재부팅 뒤에야 알게 된다 — 하필
# 무슨 일이 있었는지 가장 알고 싶을 때다. 실제 호스트가 이 상태였다.
#
# **디렉터리 존재로 판정하지 않는다.** 손으로 `mkdir`하면 디렉터리는 생기지만 소유·ACL과
# SELinux 라벨이 빠져 journald가 쓰지 못하고, 저널은 계속 메모리에 남는다. 실제 호스트가
# 정확히 그 상태였다 — 있으면서 비어 있었다. 그래서 **안에 무엇이 있는지**를 본다:
# journald는 machine-id 이름의 하위 디렉터리를 만들고 그 안에 쓴다.
if [[ -z $(ls -A /var/log/journal 2>/dev/null) ]]; then
  echo
  echo "!! journald가 영속 저널에 쓰고 있지 않다 — journalctl 이력이 재부팅에서 사라지고,"
  echo "   계측의 Loki 수집도 실패한다. 영속으로 바꾸려면:"
  echo "     sudo mkdir -p /etc/systemd/journald.conf.d"
  echo "     printf '[Journal]\\nStorage=persistent\\nSystemMaxUse=200M\\n' \\"
  echo "       | sudo tee /etc/systemd/journald.conf.d/yorr.conf"
  echo "     sudo systemd-tmpfiles --create --prefix /var/log/journal"
  echo "     sudo restorecon -R /var/log/journal 2>/dev/null || true"
  echo "     sudo systemctl restart systemd-journald"
  echo
  echo "   ** mkdir로 만들지 마라.** 디렉터리는 생기고 저널은 메모리에 남는다 —"
  echo "   소유·모드·ACL과 SELinux 라벨이 빠지고, 그 실패는 조용하다"
  echo "   (restart도 journalctl도 정상으로 보인다). 자세한 것은 MONITORING.md."
  echo "   상한을 함께 두는 이유도 거기 있다(디스크가 배포를 막는다)."
fi

echo
echo "상태:  deploy/status.sh"
echo "판단:  journalctl -u yorr-converge -f"
