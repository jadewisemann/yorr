# 인수인계 — 배포·모니터링 재설계 제안

> **상태: 제안. 아직 아무것도 구현하지 않았다.** 코드 변경 0줄.
> 이 문서는 다른 세션에서 논의를 이어가기 위한 것이다.
>
> 작성 2026-08-22 · 브랜치 `claude/deployment-automation-review-83zzmo` · 기준 커밋 `187bafc`

---

## 0. 세 줄 요약

1. 사용자 가설 두 개("GitHub Actions에서 이미지를 만들어서" · "서버 용량이 부족해서")는 **둘 다 아니다.**
2. 실제 원인은 **호스트 스크립트의 확정 버그 2개 + 켜졌다는 증거가 없는 1회성 설치 + 성공/실패를 구별할 수 없는 관측 공백.**
3. 근본 원인은 배포 파이프라인이 아니라 **재시작이 게임을 죽인다는 사실**이다. 그것만 없애면 배포 시스템이 256줄 → 25줄로 줄어든다.

---

## 1. 이 세션에서 **직접 확인한** 사실

다음 세션에서 다시 확인하지 않아도 된다. 확인 방법을 함께 적었다.

### GitHub / 레지스트리

| 사실 | 확인 방법 |
|---|---|
| `backend.yml` 18회 실행 **전부 success** | GitHub API |
| main push 파이프라인 **2분 52초** (verify 1m50s · compose 7s · image 55s, 그중 **arm64 build-push 26초**) | GitHub API |
| **`deploy.yml` 실행 횟수 0회** (2026-08-21 19:02 KST 등록) | GitHub API |
| GHCR 패키지 **public** — 익명 토큰으로 pull 가능, `docker login` 불필요 | 익명 토큰으로 tags/list·manifest 조회 |
| `main` 태그 = `sha-187bafc` **동일 digest** (`sha256:b7e792fb…`), 압축 약 80MB | 위와 동일 |
| **저장소가 public** | 미인증 `api.github.com/repos/jadewisemann/yorr` → 200 |
| 호스트 클론 remote가 **HTTPS** | `git remote -v` |

→ **GitHub 쪽은 건강하다.** "이미지를 Actions에서 만들어서 느리다/안 된다"는 성립하지 않는다.

### 호스트 (사용자가 콘솔에서 확인해 준 것)

- 공인 IP `161.33.36.118`은 **Ephemeral(임시)** — 인스턴스를 종료하면 사라진다
- 리전 `ap-osaka-1`, 컴파트먼트 루트, 인스턴스 생성 2026-08-14
- 서버용 DNS는 **두지 않기로 결정됨.** `PUBLIC_HOST`는 IP 리터럴이고 Let's Encrypt IP 인증서로 HTTPS/WSS가 성립한다

### 코드 (파일:라인)

| 사실 | 위치 |
|---|---|
| 마감 시각이 **프로세스 인메모리 Map**에만 있다 | `backend/src/game/round/roundTimerService.ts:104` |
| 그 값은 **이미 절대 벽시계 epoch ms**다 (재시작에 안전한 의미) | 같은 파일 `:147` |
| 재시작 후 재접속 스냅샷이 **반드시 실패**한다 — 라운드 상태는 Redis에서 읽히는데(`:62`) 마감 시각이 없어 `DEADLINE_NOT_FOUND` throw | `backend/src/game/reconnect/gameReconnectSnapshotService.ts:72-75` |
| 세 게임 상태 저장소가 **전부 Redis 구현** | `RedisYachtDiceStateStore` · `RedisDuelStateStore` · `RedisPingPongStateStore` |
| 코드 주석이 스스로 예약해 둔 삭제: **"타이머 복구가 생기면 이 함수는 삭제 대상이다"** | `backend/src/room/staleRoomCleaner.ts:16` · `docs/design/rooms-and-sessions.md:177` |
| `/actuator/health`가 **상수** `{status:'UP'}` — Redis·MySQL이 죽어도 UP | `backend/src/http/routes/health.ts:26` |
| 이미지에 **제대로 된 `HEALTHCHECK`가 이미 있다** (`SERVER_PORT`까지 존중) | `backend/Dockerfile:92` |
| 공개 주소 4개의 기본값이 **개발용**(`localhost:5173`·`localhost:8080`)이라 compose가 운영값으로 덮어써야 한다 | `backend/src/config/env.ts:40,72,78,81` |
| `yorr_rooms_active` 게이지가 **인메모리 phase**를 센다 → 재시작 직후 0을 보고한다 | `backend/src/ws/registry.ts:186` |
| compose에 리소스 제한 **0건** (`mem_limit`·`cpus`·`cpu_shares`·`cpuset`) | `deploy/compose.yaml` |
| `mysql:8.0`·`redis:7.4-alpine` 태그가 **고정돼 있지 않다** (caddy만 패치까지 고정) | 같은 파일 |

---

## 2. 확정된 버그 2개 (이 저장소에서 재현함)

### 버그 A — `config_changed`가 구조적으로 항상 false

`deploy/auto-deploy.sh:27`이 `deploy/`로 `cd`한 뒤 `:106`이 `git diff --quiet … -- deploy/`를 부른다.
git pathspec은 **cwd 기준**이라 실제 검사 대상은 `deploy/deploy/`이고, 매치가 없으면 git은 경고 없이 exit 0.

```
$ cd deploy && git diff --quiet HEAD~1 HEAD -- deploy/
exit=0     ← 스크립트가 쓰는 형태 ("변경 없음")
$ cd deploy && git diff --quiet HEAD~1 HEAD -- .
exit=1     ← 정답
$ cd deploy && git diff --quiet HEAD~1 HEAD -- ":/deploy/"
exit=1     ← 정답 (저장소 루트 magic pathspec)
```

그 커밋(`187bafc`)은 실제로 `deploy/` 아래 파일 **6개**를 바꿨다.

**대부분의 커밋에서 이 버그가 가려지는 이유:** `docker/metadata-action`이 커밋마다 다른 OCI 라벨
(`revision`·`created`)을 박아 image ID가 매번 바뀌므로 `image_changed=true`가 **우연히** 성립한다.

**수정:** `-- ":/deploy/"` (한 단어)

### 버그 B — 실패한 배포가 "배포 완료"로 보고되고, 그 뒤 재시도되지 않는다

`deploy/deploy.sh:73-85`의 검증은 `up -d` → `sleep 15` → `docker compose ps`다.
`up -d`는 컨테이너 *시작*만 확인하고 exit 0을 내며, `ps`·`logs`·`config|grep`은 **무슨 일이 있어도 exit 0**이다.
따라서 `main.ts`의 exit 1을 파이프라인이 **한 번도 보지 않는다.**

2차 피해가 더 크다: crash 루프 컨테이너는 이미 새 image ID를 가지므로 다음 회차에
`image_changed=false` → **자동 배포가 재시도조차 하지 않고 조용해진다.**

**수정:** `docker compose up -d --wait --wait-timeout 120` (이미지에 HEALTHCHECK가 이미 있다)

---

## 3. 매우 유력하지만 **호스트에서 확인해야 하는** 가설 2개

### 가설 1 — 문서가 git 추적 파일을 고치라고 지시해서 `git pull --ff-only`가 영구 실패

- `deploy/systemd/yorr-auto-deploy.{service,timer}`는 **git 추적 파일**이고 `187bafc`가 둘 다 바꿨다
- 그런데 유닛 파일 헤더와 `backend/docs/design/operations.md:242,248,423`이
  "User·경로를 이 호스트 계정에 맞춰 고쳐라"라고 지시한다
- 이를 피하려고 만든 `auto-deploy.sh --install`은 **저장소 전체에서 단 1곳**, 스크립트 자기 주석에만 있다 (문서에 없다)
- 걸리면 `git pull --ff-only`가 실패 → **세 배포 경로가 동시에 죽는다** (셋 다 그 한 줄을 공유한다)

**확인:** `git -C ~/yorr status --porcelain=v1 -b`

### 가설 2 — 부하 때문에 게임 게이트가 열리지 않는다

ADR-0006이 스스로 "상시 동접 50명, 방 10~20개"라고 적었다. `yorr_rooms_active == 0`이 안 되면
`YORR_DEPLOY_MAX_DEFER`(기본 6시간)가 실질 배포 주기가 된다. 체감은 정확히 "배포가 안 된다".

**확인:** `journalctl -u yorr-auto-deploy --since -24h`에 `게임 N개 진행 중`만 쌓여 있는지

---

## 4. 배제된 가설 (다시 파지 말 것)

| 가설 | 배제 근거 |
|---|---|
| SSH agent·credential helper가 없어 `git pull` 실패 | 저장소 public + remote HTTPS → 자격증명 불필요 |
| GHCR PAT 만료 · `docker login` 누락 | 패키지 public |
| 이미지가 없다/낡았다 · CI 빨간불 | `main` = `sha-187bafc` 동일 digest, 18/18 초록 |
| `deploy.sh`의 `sed -i .env`가 git 상태를 오염 | `.gitignore:14`가 `.env`를 무시 |
| `compose exec -T`가 TTY 없는 systemd에서 실패 | `-T`가 TTY 할당을 끄고 `node -e`는 stdin을 안 읽음 |
| 게이지 프로브 실패가 `set -e`로 스크립트를 죽임 | bash는 command substitution 서브셸에 errexit을 상속하지 않음 |

---

## 5. 핵심 주장

> **지금 구조가 복잡한 이유는 하나다 — 재시작이 진행 중인 게임을 죽인다.**
> 게이지도, 게이트도, 6시간 유예도, 세 개의 배포 경로도 전부 그 한 사실의 파생물이다.

ADR-0006과 `operations.md`는 두 명제를 한 문단에 붙여 놓았고, 그래서 둘째가 첫째의 필연처럼 읽힌다:

| 명제 | 판정 |
|---|---|
| 인메모리 상태 → 인스턴스 2대 불가 → **무중단 롤링 불가** | **참. 안 바뀐다** |
| 그러므로 **배포가 진행 중 게임을 끊는다** | **오늘의 구현 선택일 뿐이다** |

마감 시각을 Redis에 얹고 부팅 때 재무장하면 한 번에 넷이 해결된다:

1. 배포가 게임을 끊지 않는다 (배포 = 5~15초 재접속)
2. 재접속 스냅샷의 `DEADLINE_NOT_FOUND`가 사라진다
3. 크래시 복구가 덤으로 따라온다 (`restart: unless-stopped`가 지금은 조용히 게임을 죽인다)
4. 게임 게이트가 필수에서 선택으로 내려간다

**원칙 8(단일 인스턴스)을 바꾸지 않는다.** 프로세스 밖으로 나가는 것은 "마감 시각"이라는 *데이터*이고,
"누가 타이머를 발화하는가"라는 *책임*은 그대로 이 프로세스에 있다. 분산 락도 pub/sub도 필요 없다.

**리스크:** `staleRoomCleaner`가 막고 있던 실패 모드가 되살아난다 — 재무장 실패한 방은
"상태는 살아 있고 턴은 안 넘어가는 멈춘 게임"이 되고 JOIN도 `game_started`로 막힌다.
재무장은 반드시 **fail-closed**여야 한다: 방마다 try/catch, 실패한 방만 `rooms.close()`.
duel·pingpong도 각자 마감이 있어 세 게임을 모두 봐야 한다.

---

## 6. 제안하는 배포 구조

### 한 줄
서버가 5분마다 GitHub을 보고, 새 게 있으면 알아서 바꿔 단다. 사람이 하는 일은 머지뿐.

### 삭제하는 것
- **변경 감지 60줄 전체** — compose는 선언적이다. `up -d`는 바뀐 게 없으면 이미 no-op이고,
  이미지 ID가 달라졌으면 알아서 교체한다. 지금 코드는 **compose가 이미 보장하는 것을 다시 구현하면서 틀렸다**
- 게임 게이트 · `MAX_DEFER` · 상태 파일 (L0 이후)
- 배포 경로 3개 → 1개 (손 배포 = 같은 스크립트를 손으로 실행)
- 셀프호스티드 러너 + `.github/workflows/deploy.yml`
  → public 저장소 + docker 그룹 = 실질 root이고, **사용 횟수 0회**다.
  GitHub은 공개 저장소에 셀프호스티드 러너를 공식적으로 권하지 않는다

### 바꾸는 것
- `git pull --ff-only` → `git fetch && git reset --hard origin/main`
  호스트 체크아웃은 작업 트리가 아니라 **원하는 상태의 캐시**다. 로컬 수정이 배포를 막지 못하게 한다
- `env.ts`의 공개 주소 4개 기본값을 **개발용 → 운영값으로 뒤집는다**
  그러면 `compose.yaml`이 설정 경로에서 빠지고
  *"git pull을 빼먹으면 새 이미지가 옛 설정으로 뜬다"* 계약이 통째로 사라진다

### `deploy/converge.sh` (전문)

```bash
#!/usr/bin/env bash
# 배포 = 원하는 상태로 수렴시키는 것.
# "무엇이 바뀌었나"는 판단하지 않는다 — compose가 이미 그것을 한다.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
[[ -f .env.deploy ]] && . ./.env.deploy      # HC_URL, WEBHOOK (없으면 조용히 no-op)

beat()   { [[ -n ${HC_URL:-} ]] && curl -fsS -m 10 "$HC_URL" -o /dev/null || true; }
notify() { [[ -n ${WEBHOOK:-} ]] && curl -fsS -m 10 -X POST "$WEBHOOK" \
             -H 'content-type: application/json' --data-raw "{\"content\":\"$1\"}" \
             -o /dev/null || true; }

# 멈춤 표시가 있으면 아무것도 하지 않는다. 하트비트도 보내지 않는다 —
# 멈춘 자동화는 죽은 자동화이고, 데드맨이 그것을 알려야 한다.
[[ -f HALTED ]] && { echo "HALTED — 고친 뒤 이 파일을 지운다"; exit 0; }

# 1. 원하는 상태를 가져온다. reset --hard라 로컬 수정이 배포를 막지 못한다.
git fetch --quiet origin main
git reset --hard --quiet origin/main

# 2. 되돌아갈 곳을 기억한다.
prev=$(docker compose ps -q backend | head -n1 | xargs -r docker inspect -f '{{.Image}}')

# 3. 수렴한다. 바뀐 게 없으면 compose가 아무 일도 하지 않는다.
#    --wait 는 이미지의 HEALTHCHECK 가 healthy 가 될 때까지 기다린다.
docker compose pull --quiet
if docker compose up -d --wait --wait-timeout 150; then
  beat; exit 0
fi

# 4. 실패했다. 한 번만 되돌리고, 멈추고, 알린다.
touch HALTED
if [[ -n $prev ]] && BACKEND_IMAGE=$prev docker compose up -d --wait --wait-timeout 150; then
  notify "배포 실패 → 롤백 완료. 자동 배포 정지. $(git rev-parse --short HEAD)"
else
  notify "배포 실패 + 롤백 실패. 손이 필요하다. $(git rev-parse --short HEAD)"
fi
exit 1
```

**`HALTED`로 멈추는 이유:** 롤백만 하고 멈추지 않으면 다음 회차가 같은 깨진 이미지를 다시 올려
**5분마다 게임을 죽이는 플랩**이 된다.

**⚠️ 전제 조건:** "backend만 pull"에서 "스택 전체를 수렴"으로 바뀌므로
`mysql:8.0`·`redis:7.4-alpine` 같은 움직이는 태그를 그대로 두면
**무인 타이머가 DB 엔진을 패치 업그레이드한다.** 모든 이미지를 digest로 고정해야 한다.

### 급할 때 쓰는 명령 3개
```bash
sudo systemctl start yorr-converge   # 5분 못 기다릴 때
deploy/rollback.sh                   # 되돌리기
deploy/status.sh                     # 지금 뭐가 돌고 있나
```

---

## 7. 제안하는 모니터링

**쐐기돌 하나:** `/actuator/health`에 Redis PING + MySQL `SELECT 1`을 넣고 5초 캐시한다.
한 번의 변경이 **세 곳을 동시에 업그레이드한다** — 컨테이너 HEALTHCHECK, 배포 게이트(`--wait`), 외부 uptime 체크.

**신호 4개. 전부 호스트 밖. 컨테이너 0개.**

| 신호 | 무엇을 잡나 | 수단 |
|---|---|---|
| 외부 uptime | 프로세스·호스트·TLS·DNS·방화벽 — 한 번에 | 무료 SaaS, 5분 |
| 자동화 데드맨 | **아무것도 안 돌고 있음** ← 실제로 일어난 실패 | 수렴 끝에 ping |
| 배포 상태 변화 | 배포 실패 · 롤백 · 정지 | Discord webhook |
| 백업 데드맨 | 덤프 실패 · 오프사이트 복사 실패 | 백업 끝에 ping |

**Prometheus·Grafana를 넣지 않는 이유:** 노출 메트릭이 4계열(15일에 1.7 MiB)뿐이고,
게이지 2개의 **유일한 소비자가 배포 게이트**인데 게이트가 없어지면 소비자가 없다.
이 규모에서 알고 싶은 것은 시계열이 아니라 **이진 사건**이다.
운영 인력이 없는 프로젝트에서 아무도 안 보는 대시보드는 관측이 아니라 비용이다.
(용량 때문이 아니다 — 12GB 중 10GB 이상이 비어 있고, Jenkins까지 다 올려도 8.5GB가 남는다.)

---

## 8. 용량 분석 결론 — "서버가 부족해서"는 아니었다

| 자원 | 현재 사용 | 여유 |
|---|---|---|
| RAM (12GB) | 0.95~1.6 GB | **10.4~11 GB** |
| 디스크 (47~50GB) | 2~4 GB | 44~48 GB |
| CPU | 2 물리 코어 | **여기가 유일한 실제 제약** |

`backend/`를 실제로 빌드해 측정: verify 전체 **약 24초 / 61.5 CPU-초**, peak RSS 360 MiB,
`node_modules` dev 275MB / prod 28MB, 네이티브 애드온(`*.node`) **0개**.

**ADR-0006의 기각 사유 하나는 크기를 과대평가했다.** 빌드가 만드는 스케줄러 지터는 3~50ms인데
라운드 마감 **유예가 1,000ms**다 — 유예 예산의 0.3~5%. 결정 자체는 유효하지만,
실제로 그것을 지탱하는 근거는 ②"빌드 실패 시 배포 가능한 이미지가 없다"와 ③"이미지 태그의 재현성"이다.

**진짜 위험은 용량이 아니라 compose에 리소스 제한이 한 줄도 없다는 것이다.**

---

## 9. 전제가 바뀐 것 2개

### ARM 러너 기각 근거가 무효
저장소가 **public**이므로 Actions 분이 무제한이고 `ubuntu-24.04-arm`도 무료다.
ADR-0006의 "비공개 저장소에서 ARM 러너는 무료 분에 포함되지 않는다"는 성립하지 않는다.

**단 동작은 바꾸지 말 것** — arm64 빌드가 이미 26초라 얻을 속도가 없고,
네이티브 러너로 옮기면 `prod-deps`의 `*.node` 가드가 지키던 규율이 사라진다.
고칠 것은 ADR의 그 한 줄이다.

### Always Free A1 한도 절반으로 축소
4 OCPU/24GB → **2 OCPU/12GB**, 2026-06-15 발효, **2026-08-18부터 강제 집행**(공지 없음).
→ "남는 자원으로 별도 인스턴스에 Jenkins/Grafana" 안은 닫혔다.
→ 그리고 **인스턴스가 종료될 수 있는 시나리오가 실재한다.** IP가 ephemeral이므로 함께 잃는다.

---

## 10. IP 문제 (ephemeral 확정)

IP `161.33.36.118`이 **세 곳**에 박혀 있다:

1. `deploy/.env` → `PUBLIC_HOST`
2. `frontend/vercel.json` → rewrite 대상 (**git에 하드코딩**)
3. Vercel 환경변수 → `VITE_API_BASE_URL` · `VITE_WS_URL` (빌드 타임 주입)

2·3이 프론트라 **IP가 바뀌면 프론트 재배포가 따라온다.**

**제약:** `vercel.json`의 rewrite destination은 환경변수 보간이 안 된다. 완전한 단일화는 불가능하다.
**대안:** `deploy/set-public-ip.sh <새IP>` 하나가 세 곳을 처리한다 —
`.env` 수정, `vercel.json` 수정, 바꿔야 할 Vercel 환경변수 출력.

**왜 IP인가 (배경):** 서버용 DNS를 두지 않기로 결정했다(Let's Encrypt가 IP 인증서를 내주므로).
그런데 카카오·구글 OAuth 콘솔은 Redirect URI로 raw IP를 받지 않는다.
그래서 콜백 2개만 `yorr.site`로 받아 **Vercel rewrite가 백엔드 IP로 넘긴다.**
이 구조의 이점: 백엔드 IP가 바뀌어도 **제공자 콘솔은 손대지 않는다** — `vercel.json`만 고친다.

---

## 11. 제안한 작업 순서 (PR 5개)

| # | 내용 | 규모 | 의존 |
|---|---|---|---|
| 1 | **진짜 `/actuator/health`** (Redis PING + MySQL SELECT 1, 5초 캐시) | 2~3시간 | 없음. 호스트 안 건드림 |
| 2 | **배포 파이프라인 교체** — `converge.sh`·`status.sh`·`rollback.sh`·systemd, 옛 스크립트/러너 삭제, digest 고정, `stop_grace_period` | 반나절 | 1 |
| 3 | **IP 단일화 + `bootstrap.sh`** | 반나절 | — |
| 4 | **백업 오프사이트** | 반나절 | 목적지 결정 필요 |
| 5 | **마감 시각 영속화** (별도 ADR) | 1~2일 | 없음 — **1~4와 병렬 가능** |

**PR 2에는 게임 게이트 3줄을 남긴다.** PR 5 전까지는 그게 있어야 한다. PR 5에서 지운다.
(이 순서 실수를 한 번 했다 — converge를 먼저 넣으면서 게이트를 지우면 게임 중에도 그냥 끊는다.)

### 설치 순서 (중요)
지난번 자동화는 **한 번도 실행되지 않은 채 머지됐다**(`deploy.yml` 0회). 같은 방식이면 같은 결과가 난다.

```
1. converge.sh 를 호스트에 올린다   (타이머 없음)
2. 손으로 한 번 실행한다             ./converge.sh
3. 되는 걸 눈으로 본다
4. 옛 스크립트를 그때 지운다
5. 타이머를 그때 켠다
```
3번을 통과 못 하면 4·5를 하지 않는다.

---

## 12. 열린 결정 2개

1. **IP를 지금 reserved로 바꿀 것인가?**
   OCI에서 ephemeral → reserved 직접 전환은 안 되고 **주소가 한 번 바뀐다.**
   지금 계획해서 바꾸거나, 인스턴스를 잃을 때 강제로 바뀌거나 둘 중 하나다.
   (Always Free 포함 여부는 미확인)

2. **백업 목적지** — OCI Object Storage(10GB, 같은 클라우드) / Cloudflare R2(10GB, 진짜 분리) / 개인 PC(Tailscale)

---

## 13. ⚠️ 확인하지 **못한** 것

다음 세션이 이걸 확정된 것으로 다루면 안 된다.

1. **호스트의 실제 상태 전부.** 타이머가 켜져 있는지조차 모른다. §3의 두 가설이 여기 달려 있다
2. **`docker compose up -d`가 이 호스트에서 설명대로 동작하는지.** 이 환경에 docker 데몬이 없어 실행 검증을 못 했다.
   §6 설계 전체가 이 성질(선언적 수렴 + 새 image ID면 교체)에 기대므로 **전환 전에 호스트에서 한 번 확인해야 한다**
3. **적대적 교차 검증을 받지 못했다.** 반박 담당 서브에이전트를 띄웠으나 중간에 중단됐다.
   §5의 작동 메커니즘은 직접 확인했지만, duel·pingpong의 개별 예외와 작업량 추정은 독립 반박을 거치지 않았다
4. 컨테이너별 실제 RSS (측정 불가 — 범위 추정)
5. Kakao가 raw IP를 거부한다는 것은 사용자 경험 + 저장소 주석 기준. Google 쪽은 문서상 확정

### 첫 진단 명령 (호스트에서, 순서대로)
```bash
systemctl list-timers yorr-auto-deploy.timer --all --no-pager
journalctl -u yorr-auto-deploy --since -24h --no-pager | tail -60
git -C ~/yorr status --porcelain=v1 -b
cd ~/yorr/deploy && docker compose config --quiet && echo COMPOSE-OK
docker compose ps -a --format '{{.Service}}\t{{.State}}\t{{.Status}}\t{{.Image}}'
```

---

## 14. 관련 문서

- `backend/docs/adr/0006-github-actions-ghcr-arm64-single-host.md` — 현행 결정과 기각한 대안들
- `backend/docs/design/operations.md` 「배포 파이프라인」·「모니터링」
- `backend/DESIGN.md` 원칙 8 — 단일 인스턴스 전제
- 진단 문서(아티팩트): https://claude.ai/code/artifact/8bf4faf4-77f0-4c6d-9417-43aa7f7132d2
- 재설계 문서(아티팩트): https://claude.ai/code/artifact/158e5305-622d-41e6-8ff1-b6b62e66b137
