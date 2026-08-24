# 모니터링 — 무엇을 보고, 무엇이 깨졌을 때 알림이 오는가

> 결정과 그 근거는 [`PLAN.md`](PLAN.md) §10에 있다. 이 파일은 **절차**다.

## 구성

```
호스트                                          Grafana Cloud (무료 티어)
────────────────────────────────────────       ─────────────────────────
converge  ──.prom──┐
mysql-backup ──────┤                            메트릭 (Prometheus)
backend /actuator/prometheus ─┤── alloy ──►     로그   (Loki)
호스트 /proc·/sys ────────────┤                 알림   (Alert rules)
journalctl -u yorr-converge ──┘                 uptime (Synthetic)
```

호스트에 도는 것은 **수집 에이전트 하나**다. 대시보드·알림·uptime 체크는 Grafana가
호스팅한다. 그렇게 나눈 이유가 있다: **감시 대상 위에 감시자를 올리면 호스트가 죽을 때
그것을 알려 줄 것도 같이 죽는다.**

에이전트는 **배포 스택과 다른 compose 프로젝트**다
([`compose.metrics.yaml`](compose.metrics.yaml)). `apply.sh`가 서비스를 지정하지 않고
`docker compose up -d --wait`를 부르므로, 같은 프로젝트에 두면 에이전트의 재시작 루프
하나가 정상 릴리스를 롤백시킨다. 그 경로를 구조적으로 없앤 것이다.

## 호스트에서 할 일

Grafana Cloud에서 스택을 만들고 값 다섯 개를 받아 온다. 좌측 하단 계정 메뉴 →
스택 세부 정보에서, Prometheus 카드의 **Remote Write Endpoint**와 **Username**,
Loki 카드의 **URL**과 **User**를 읽고, Access Policies에서 `metrics:write` ·
`logs:write` 권한의 토큰을 하나 만든다.

**여기서 두 번 틀린다.**

- **Loki 카드의 URL에는 경로가 없다.** `https://logs-prod-0NN.grafana.net`까지만
  적혀 있으므로 뒤에 `/loki/api/v1/push`를 **직접 붙여야 한다.** Prometheus 쪽은
  이미 `/api/prom/push`가 들어 있어서 그대로 쓰면 되는데, 그 차이 때문에 Loki도
  된 줄 알고 넘어간다. 설정은 이 값을 그대로 쓰고 보정하지 않는다.
- **사용자 ID가 서로 다르다.** 같은 줄 알고 하나만 복사하면 메트릭은 잘 들어오고
  로그만 401을 받는다 — 잘 되는 쪽이 보이니 문제를 늦게 발견한다. 토큰은 하나를
  두 곳에 같이 쓴다.

`deploy/.env`에 다섯 줄을 더한다.

```bash
sudo -u opc tee -a ~/yorr/deploy/.env >/dev/null <<'EOF'
GRAFANA_CLOUD_PROM_URL=…/api/prom/push
GRAFANA_CLOUD_PROM_USER=…
GRAFANA_CLOUD_LOKI_URL=…/loki/api/v1/push
GRAFANA_CLOUD_LOKI_USER=…
GRAFANA_CLOUD_TOKEN=…
EOF
```

띄운다. `up`은 재기동 **전에** 설정을 검증한다 — 문법이 깨진 설정으로 재기동해서
잘 돌고 있는 수집기를 재시작 루프로 바꾸지 않기 위한 순서다.

```bash
~/yorr/deploy/metrics.sh up
```

수집이 되고 있는지 본다. `remote_write` 오류가 없으면 1~2분 안에 Grafana에 계열이
보인다.

```bash
~/yorr/deploy/metrics.sh logs
```

계측 디렉터리는 `bootstrap.sh`가 만든다. 컨트롤러를 이미 설치한 뒤에 이 문서를 보고
있으면 한 번 더 돌린다 — 있는 것은 건드리지 않는다.

```bash
cd ~/yorr && deploy/bootstrap.sh
```

## Grafana Cloud에서 할 일

### 알림 규칙

**「No data」 상태를 반드시 `Alerting`으로 둔다.** 기본값은 `No Data`인데, 호스트가
죽으면 계열이 사라지므로 그 설정에서는 **가장 중요한 순간에 아무 알림도 오지 않는다.**

| 무엇 | 식 | 대기 |
|---|---|---|
| 자동화가 멈췄다 | `time() - yorr_converge_last_healthy_seconds > 900` | 5m |
| 자동 배포가 HALT다 | `yorr_converge_halted == 1` | 5m |
| 미룸이 상한에 다가간다 | `yorr_converge_deferred_seconds > 18000` | 10m |
| backend를 긁지 못한다 | `up{job="yorr-backend"} == 0` | 5m |
| 백업이 안 돈다 | `time() - yorr_backup_last_success_seconds > 172800` | 30m |
| 디스크가 찬다 | `100 * (1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) > 85` | 15m |
| 메모리가 없다 | `node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes < 0.10` | 15m |

첫 줄이 §10의 「자동화 데드맨」이다. 15분(900초)인 것은 타이머가 5분 주기이고
`RandomizedDelaySec=60`이 붙어 있어서, **두 회차를 연달아 놓쳐야** 울리게 하려는
것이다.

`yorr_converge_last_healthy_seconds`가 뜻하는 「건강하다」는 무변화 · 게임 때문에
미룸 · 배포 성공이다. **미룸이 포함되는 것이 중요하다** — 미룸은 정상 동작이므로
그때 시계가 멈추면 정상 자동화를 두고 거짓 경보가 계속 울린다. 실패한 회차는 이 시계를
앞당기지 않는다(그러면 멈춘 자동화를 두고 알림이 침묵한다).

### uptime 체크 (Synthetic Monitoring)

HTTP 체크를 `https://<공인 IP>/actuator/health`에 5분 주기로 만든다. 이 주소는
readiness라 Redis나 MySQL이 죽으면 503을 낸다 — 프로세스가 살아 있는데 게임이 안 되는
상태를 잡는다.

주의할 점이 둘 있다. IP가 ephemeral이므로 인스턴스를 재시작해 IP가 바뀌면 체크가
죽는다(알림이 울리는 것은 맞는 동작이지만 대상을 손으로 갱신해야 한다). 그리고
IP 인증서이므로 SSL 검증을 켠 채로도 통과해야 정상이다 — 실패하면 Caddy의 갱신이
깨진 것이다.

### 대시보드

[`grafana/dashboard.json`](grafana/dashboard.json)을 가져오면 된다. Dashboards → New →
Import → JSON을 붙이고 **Load**를 누르면 데이터 소스 두 개를 고르라고 묻는다.
UID는 스택마다 다르므로 파일에 박지 않고 가져올 때 고르게 해 두었다.

**새로 만들 것은 없다.** Grafana Cloud가 스택을 만들 때 이미 붙여 두었고, 이름이
`grafanacloud-<계정이름>-prom`(Prometheus)과 `grafanacloud-<계정이름>-logs`(Loki)다.
드롭다운이 종류별로 걸러 주므로 각 칸에 대개 선택지가 하나뿐이다. **두 칸에 서로 다른
것이 들어가야 한다** — 같은 것을 넣으면 로그 패널이 빈다.

핵심 패널은 **「회차마다 무엇을 판단했는가」**의 상태 타임라인이다. 이 규모에서 알고
싶은 것은 추이가 아니라 사건이라, 회차마다 상태가 하나씩 찍히는 이 모양이 데이터에
맞고 시계열 그래프는 맞지 않는다. 파란 구간이 길어지는 것은 고장이 아니라 게이트가
게임을 지키고 있다는 뜻이다.

직접 만들거나 Explore에서 볼 때 쓸 것은 이 정도다.

- `node_load1` · CPU · `node_memory_MemAvailable_bytes` · 디스크 사용률 — 호스트
- `yorr_game_participants_active{game}` — 게임별 실제 접속자
- `yorr_converge_halted` · `yorr_converge_deferred_seconds` — 자동 배포의 상태
- `time() - yorr_converge_last_healthy_seconds` — 자동화가 마지막으로 판단한 뒤 흐른 시간
- Loki에서 `{job="yorr-converge"}` — **무엇을 판단했는지.** 메트릭이 "지금 상태"만
  말하는 데 반해 이쪽에 「접속자 2명 플레이 중 — 이번 회차는 미룬다」가 그대로 있다.

**`yorr_rooms_active`는 쓰지 않는다.** 지금 거짓값을 낸다 — 게임 중 접속이 끊긴 방이
영구히 남는다([`PLAN.md`](PLAN.md) §17). 그것을 고치기 전에 대시보드에 올리면 거짓값을
그래프로 그리게 된다. `yorr_game_participants_active`는 신뢰할 수 있다.

## 알림이 오지 않을 때

```bash
deploy/metrics.sh status              # 컨테이너가 도는가
deploy/metrics.sh logs               # remote_write가 401·403을 받고 있는가
ls -l /var/lib/yorr-deploy/metrics/  # .prom 파일이 갱신되는가
cat /var/lib/yorr-deploy/metrics/yorr-converge.prom
```

`metrics.sh logs`는 `-f`로 따라붙으므로 Ctrl-C로 끊어야 한다. 한 번만 훑고 끝내려면
이쪽이 편하다 — 아무것도 안 나오면 정상이다.

```bash
docker logs --tail 40 yorr-alloy 2>&1 | grep -Ei 'err|401|403|warn'
```

### journal이 Loki에 없다

`docker logs yorr-alloy`에 이것이 있으면 **호스트의 journald가 휘발성**이다.

```
level=error msg="error creating journal tailer"
  err="failed to open journal in directory \"/rootfs/var/log/journal\": no such file or directory"
```

`Storage=auto`(기본값)는 `/var/log/journal`이 **있을 때만** 영속으로 쓴다. 없으면 로그가
`/run/log/journal`(메모리)에만 남아 재부팅에서 사라진다. Alloy가 못 읽는 것은 그 결과일
뿐이고, 진짜 문제는 **운영 인터페이스인 `journalctl -u yorr-converge`의 이력이 날아간다**는
것이다. 실제 호스트(Oracle Linux 9)가 이 상태였다.

```bash
sudo mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nStorage=persistent\nSystemMaxUse=200M\n' \
  | sudo tee /etc/systemd/journald.conf.d/yorr.conf
# mkdir로 만들지 않는다 — 아래 「왜 mkdir이 아닌가」를 읽어라.
sudo systemd-tmpfiles --create --prefix /var/log/journal
sudo restorecon -R /var/log/journal 2>/dev/null || true
sudo systemctl restart systemd-journald
docker restart yorr-alloy
```

확인은 **디렉터리가 아니라 그 안**을 본다. journald는 machine-id 이름의 하위
디렉터리를 만들고 그 안에 쓴다.

```bash
sudo ls -ld /var/log/journal/*/
```

#### 왜 `mkdir`이 아닌가

`sudo mkdir -p /var/log/journal`만 하면 **디렉터리는 생기고 저널은 여전히 메모리에
남는다.** 두 가지가 빠지기 때문이다: journald가 요구하는 소유·모드·ACL
(`root:systemd-journal`, `2755`)과, SELinux 라벨(`systemd_journal_t`)이다. 손으로
만든 디렉터리는 `var_log_t`가 되고, SELinux가 enforcing이면 journald가 그곳에 쓰지
못한다. Oracle Linux 9는 기본이 enforcing이다.

**이 실패는 조용하다.** `systemctl restart systemd-journald`가 성공으로 끝나고
`journalctl`도 정상으로 보인다 — 메모리 저널을 읽고 있기 때문이다. `/var/log/journal`
아래가 비어 있는 것으로만 알 수 있다. 실제 호스트에서 이 함정에 한 번 빠졌다.

`SystemMaxUse`를 함께 두는 이유는 디스크다. journald의 기본 상한은 파일 시스템의 10%이고
preflight는 여유가 10% 미만이면 배포를 막는다 — 상한을 두지 않으면 **로그가 자라서 배포가
멈추는** 경로가 열린다.

`.prom`이 없거나 낡았으면 소유권을 본다. `bootstrap.sh` 없이 디렉터리가 먼저 만들어져
root 소유가 되면, `opc`로 도는 converge가 쓰지 못한 채 조용히 포기한다(계측이 배포를
막지 않게 일부러 그렇게 했다).

## 남은 것

- **Alloy 이미지 태그가 `latest`다.** 이 저장소는 인프라 이미지를 digest로 고정하는
  방향이므로(PLAN.md PR 5) 이것도 대상이다. `deploy/metrics.sh pin`이 지금 도는
  이미지의 digest를 알려 준다.
- **컨테이너별 사용량이 없다.** 얻으려면 docker 소켓을 마운트해야 하는데 그것은 사실상
  root 권한이다. §11의 보안 경계를 계측 때문에 지우지 않기로 하고 넘기지 않았다.
  호스트 전체의 CPU·메모리·디스크는 보인다.
- **backend 컨테이너 로그가 Loki에 없다.** json-file 드라이버로 나가 journal에 없고,
  가져오려면 위와 같은 소켓이 필요하다. `docker compose logs backend`가 여전히 정본이다.
