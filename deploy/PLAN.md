# 배포 재설계 구현 계획 — Release 단위 pull-based CD

> **상태: 계획. 아직 구현하지 않았다. 코드 변경 0줄.**
> 이 문서는 무엇을 어떤 순서로 만들지에 대한 정본이다. 현재 시스템이 **어떻게
> 동작하는가**의 정본은 [`backend/docs/design/operations.md`](../backend/docs/design/operations.md)이고,
> 결정의 배경은 [ADR-0006](../backend/docs/adr/0006-github-actions-ghcr-arm64-single-host.md)이다.
>
> 작성 2026-08-22 · 기준 커밋 `5e20ed0` · 앞선 진단 문서 `deploy/HANDOVER.md`를 대체하며, 그 문서는 이 커밋에서 삭제했다.

---

## 0. 한 문장

**배포 단위는 Docker 이미지 하나가 아니라 "git revision + compose/설정 + image
digest"가 결합된 하나의 Release다.**

지금 구조가 이 원칙을 어기는 지점이 곧 고칠 목록이다.

---

## 1. 유지하는 판단

앞선 진단에서 나왔고 이 계획도 그대로 따른다.

1. GitHub Actions는 **CI와 이미지 발행까지만** 담당한다.
2. OCI 호스트가 GHCR에서 당기는 **pull-based CD**를 유지한다.
3. 운영 서버의 **셀프호스티드 러너를 제거한다.**
4. Docker Compose의 **선언적 수렴**을 활용한다 — 변경 감지를 직접 구현하지 않는다.
5. `docker compose up --wait` + **진짜 health check**를 배포 게이트로 쓴다.
6. 실패하면 **롤백 후 자동 배포를 정지(HALT)** 한다.
7. 게임 마감 시각을 Redis에 영속화해 **프로세스 재시작 가능성**을 확보한다.
8. Prometheus·Grafana·Jenkins·Kubernetes 같은 **별도 control plane은 도입하지 않는다.**

---

## 2. 확정된 사실 (재확인 불필요)

| 사실 | 확인 방법 |
|---|---|
| `backend.yml` 실행 전부 success, main 파이프라인 2분 52초 (arm64 build-push 26초) | GitHub API |
| **`deploy.yml` 실행 횟수 0회** — 셀프호스티드 러너 경로가 한 번도 안 돌았다 | GitHub API |
| GHCR 패키지 **public** — 익명 pull 가능, `docker login` 불필요 | 익명 토큰으로 manifest 조회 |
| 저장소 **public**, 호스트 클론 remote가 HTTPS | 미인증 API 200 · `git remote -v` |
| ~~`image` job의 `needs`가 **`[verify]`뿐**이다~~ → **PR 2에서 `[verify, compose]`로 고쳤다** | 파일 |
| `metadata-action` 기본 label에 `org.opencontainers.image.revision` 포함 | 파일 |
| 인프라 태그 미고정: `redis:7.4-alpine` · `mysql:8.0` (caddy만 `2.11.4-alpine`) | `compose.yaml:150,184,215` |
| compose에 리소스 제한 **0건** (`mem_limit`·`cpus`·`cpu_shares`) | `compose.yaml` |
| ~~`/actuator/health`가 **상수** `{status:'UP'}`~~ → **PR 1에서 readiness로 교체했다** | `monitoring/readiness.ts` |
| 이미지에 **제대로 된 `HEALTHCHECK`가 이미 있다** (`SERVER_PORT` 존중) | `backend/Dockerfile:92` |
| 마감 시각이 **프로세스 인메모리 Map**에만 있다. 값 자체는 이미 절대 epoch ms | `roundTimerService.ts:104,147` |
| 재시작 후 재접속 스냅샷이 **반드시 실패**한다 (`DEADLINE_NOT_FOUND`) | `gameReconnectSnapshotService.ts:72-75` |
| 세 게임 상태 저장소가 **전부 Redis 구현** | `RedisYachtDiceStateStore` 외 2개 |
| 공인 IP `161.33.36.118`이 **ephemeral** — 인스턴스를 잃으면 함께 잃는다 | OCI 콘솔 |
| Always Free A1 한도 **4 OCPU/24GB → 2 OCPU/12GB** (2026-08-18부터 집행) | OCI 공지 |
| RAM 12GB 중 0.95~1.6GB 사용. **CPU 2코어가 유일한 실제 제약** | 실측 |
| 호스트 계정은 **`opc`**, OS는 Oracle Linux Server 9.8 — 추적 파일의 `User=ubuntu`는 이 호스트에 맞지 않는다 | SSH 접속(2026-08-23) |
| 22번 포트가 열려 있고 공인 IP `161.33.36.118`이 맞다 | 같은 접속 |
| `opc`가 **docker 그룹에 있다**(`opc adm systemd-journal docker`) | 같은 접속 |
| **`yorr-auto-deploy` 타이머가 설치된 적이 없다** — `0 timers listed` · journal `No entries` · `/etc/systemd/system/`에 유닛 없음 | 같은 접속 |
| 호스트 체크아웃이 **깨끗하다**(`## main...origin/main`, 수정된 추적 파일 없음) | 같은 접속 |
| **셀프호스티드 러너가 없다**(`actions.runner*` 유닛 0개) — §11의 제거 항목이 이미 무효다 | 같은 접속 |
| **D1 불일치가 실재한다**: 체크아웃 `9808236`(08-20)인데 이미지는 `:main`(그보다 새 코드). 9커밋 뒤처짐 | 같은 접속 |
| 스택 5개가 39시간 가동 중이고 backend·mysql·redis가 `(healthy)` | 같은 접속 |
| 뒤처진 9커밋의 `compose.yaml` 실제 변화는 **backend `environment:` 4줄 추가뿐** — mysql·redis·caddy 정의는 그대로라 **첫 배포에 MySQL은 재시작하지 않는다** | 같은 접속 |

### 배제된 가설 (다시 파지 말 것)

SSH agent·credential helper 부재 · GHCR PAT 만료 · 이미지 부재나 노후 · `sed -i .env`의
git 오염 · `compose exec -T`의 TTY 실패 · 게이지 프로브가 `set -e`로 스크립트를 죽임.
전부 근거를 갖고 배제했다.

---

## 3. 확정 버그 2개 (현행 코드)

### 버그 A — `config_changed`가 구조적으로 항상 false

`auto-deploy.sh:27`이 `deploy/`로 `cd`한 뒤 `:106`이 `git diff --quiet … -- deploy/`를
부른다. git pathspec은 **cwd 기준**이라 실제 검사 대상은 `deploy/deploy/`이고, 매치가
없으면 git은 경고 없이 exit 0을 낸다.

대부분의 커밋에서 가려지는 이유: `metadata-action`이 커밋마다 다른 OCI 라벨
(`revision`·`created`)을 박아 image ID가 매번 바뀌므로 `image_changed=true`가 **우연히**
성립한다.

새 controller는 변경 감지를 하지 않으므로 이 코드는 **고치지 않고 삭제된다.**

### 버그 B — 실패한 배포가 "완료"로 보고된다

`deploy.sh:73-85`의 검증은 `up -d backend` → `sleep 15` → `docker compose ps`다.
`up -d`는 컨테이너 *시작*만 확인하고 exit 0을 내며, `ps`·`logs`·`config|grep`은 무슨
일이 있어도 exit 0이다. 따라서 `main.ts`의 exit 1을 파이프라인이 **한 번도 보지 않는다.**

2차 피해가 더 크다: crash 루프 컨테이너는 이미 새 image ID를 가지므로 다음 회차에
`image_changed=false`가 되어 **자동 배포가 재시도조차 하지 않고 조용해진다.**

**손 배포에서 더 위험하다.** 관리자가 `deploy.sh -y --tag sha-xxxxxxx`로 긴급 롤백한
뒤 초록색 출력을 보고 SSH를 끊는다. 긴급 상황에서 가장 나쁜 실패 모드다.

수정은 `--wait`이며 PR 3에 들어간다. 다만 `--wait`가 의미를 가지려면 health가 먼저
진짜여야 하므로 **PR 1이 선행한다.**

---

## 4. 아직 확인하지 못한 것

이것들을 확정된 것으로 다루면 안 된다.

1. **호스트의 실제 상태 전부.** 타이머가 켜져 있는지조차 모른다.
2. **`docker compose up -d --wait`가 이 호스트에서 설명대로 동작하는지.** 계획 전체가
   이 성질(선언적 수렴 + 새 digest면 교체)에 기댄다.
3. **`imagetools inspect`가 revision label을 어떤 모양으로 내는지.** 발견 로직 전체가
   이 한 명령에 달려 있다. multi-arch manifest면 플랫폼 맵이 나온다.
4. 컨테이너별 실제 RSS (범위 추정만 있다).

### 첫 진단 명령 (호스트에서, 순서대로)

```bash
systemctl list-timers yorr-auto-deploy.timer --all --no-pager
journalctl -u yorr-auto-deploy --since -24h --no-pager | tail -60
git -C ~/yorr status --porcelain=v1 -b
cd ~/yorr/deploy && docker compose config --quiet && echo COMPOSE-OK
docker compose ps -a --format '{{.Service}}\t{{.State}}\t{{.Status}}\t{{.Image}}'
docker buildx imagetools inspect ghcr.io/jadewisemann/yorr-backend:main --raw | head -40
```

### 진단 결과 (2026-08-23) — **두 가설 다 아니다**

`auto-deploy.sh --install`이 **한 번도 실행되지 않았다.** 타이머도 유닛도 없고 journal도
비어 있다. 그러므로 자동 배포는 "실패하고 있었다"가 아니라 **애초에 존재한 적이 없다.**

이것은 `deploy.yml` 0회 실행과 **같은 실패다**: 설치 단계가 문서에만 있고 아무도 하지
않았다. D8이 그 함정을 지적하면서 정작 같은 문서의 `--install` 안내가 그 함정에 빠져
있었다. 새 controller의 `bootstrap.sh`가 그것을 되풀이하지 않게 하는 것이 관건이고,
cutover 절차(PR 4)가 "손으로 한 번 → test release → 롤백 테스트 → 그다음 타이머"를
강제하는 이유도 그것이다.

부수 효과로 **cutover가 단순해진다**: 되돌릴 것도 지울 것도 없다. 8번 단계(옛 타이머
disable)는 무효이고, 체크아웃이 깨끗하므로 `git pull --ff-only`에 정리 작업이 필요 없다.
새 controller는 교체가 아니라 순수 추가다.

아래 두 가설은 **기각·무효**로 남긴다 — 같은 증상을 다시 만났을 때 이미 배제한 경로를
다시 파지 않기 위해서다.

가설 두 개(둘 다 성립하지 않았다):

- ~~**가설 1 — `git pull --ff-only`가 영구 실패하고 있다.**~~ **기각.** `deploy/systemd/`의 두
  유닛이 **git 추적 파일**인데 현행 문서가 "호스트 계정에 맞춰 고쳐라"라고
  지시했으므로, 그대로 따랐다면 pull이 막힌다. 세 배포 경로가 그 한 줄을 공유하므로
  **동시에 죽는다.** 위 세 번째 명령이 확인한다.
  → **기각됐다.** 체크아웃이 깨끗하다(`## main...origin/main`). 계정이 `opc`라 "고쳐야
  한다"는 압력은 실재했지만, 애초에 유닛을 심지 않았으므로 고칠 일도 없었다.
  (이 지시는 2026-08-22에 `operations.md`에서 `--install` 안내로 교체했다.)
- ~~**가설 2 — 게임 게이트가 열리지 않는다.**~~ **무효.** 타이머가 돈 적이 없으므로
  게이트가 판단할 기회 자체가 없었다. ADR-0006이 스스로 "상시 동접 50명,
  방 10~20개"라고 적었다. `yorr_rooms_active == 0`이 성립하지 않으면
  `YORR_DEPLOY_MAX_DEFER`(기본 6시간)가 실질 배포 주기가 되고, 체감은 정확히
  "배포가 안 된다"가 된다. 위 두 번째 명령의 journal에 `게임 N개 진행 중`만 쌓여
  있는지로 확인한다.

---

## 5. 목표 구조

```text
                  GitHub
                     │ push main
                     ▼
              GitHub Actions
          ┌──────────┴──────────┐
       verify              compose check
          └──────────┬──────────┘
                     ▼
              build / publish          ← 둘 다 통과해야 발행된다
                     ▼
                    GHCR
              main → digest B
              revision label = B
                     ▲
                     │ HTTPS pull (익명, 자격증명 없음)
                     │
                OCI Ampere A1
                     │ systemd timer
                     ▼
              yorr-converge            ← checkout 바깥, 안정적
                     │
        ┌────────────┼─────────────┐
     discover    checkout B     digest B
        └────────────┼─────────────┘
                     ▼
            deploy/apply.sh (checkout 안)
                     ▼
             compose up --wait
                ┌────┴────┐
              healthy   failure
                │          ▼
          last-good     rollback → revision A + digest A
            갱신             ▼
                            HALT (원인 기록)
```

신뢰 방향은 단방향이다. GitHub에는 OCI SSH 키도 API 자격증명도 운영 셸 권한도
없고, OCI에는 외부 CI가 명령을 실행하는 상주 agent가 없다. GHCR 패키지가 public이라
**OCI가 GitHub 자격증명을 하나도 들고 있지 않다.**

---

## 6. 설계 결정

### D1. `origin/main`은 배포 가능한 버전이 아니다

main CI가 약 3분이므로 다음 상태가 실제로 존재한다.

```
t0  commit B가 main에 머지된다
t1  호스트가 git fetch → origin/main = B
    그런데 CI는 아직 B 이미지를 빌드 중
    GHCR :main = commit A 이미지
t2  호스트가 compose up
    결과: config = B, image = A
```

`compose.yaml`이나 환경변수 계약이 같은 커밋에서 바뀌었다면 **서로 다른 버전의 코드와
설정을 결합한 배포**가 된다. 따라서 호스트는 "GitHub main이 어디인가"가 아니라
"CI를 통과해 실제로 publish된 최신 이미지의 revision은 무엇인가"를 기준으로 배포한다.

### D2. GHCR publish가 Release Ready 신호다

별도의 manifest DB도 deployment server도 만들지 않는다. 이미지가 이미
`org.opencontainers.image.revision`을 들고 있으므로, **GHCR에 성공적으로 발행된
이미지 자체를 release marker로 쓴다.**

### D3. `:main`은 발견용, 실행은 digest로 고정

```
발견:  ghcr.io/jadewisemann/yorr-backend:main
실행:  ghcr.io/jadewisemann/yorr-backend@sha256:ABC123
```

`main`이 나중에 다른 이미지를 가리켜도 현재 배포가 변하지 않고, 같은 release를
재현할 수 있으며, 롤백이 정확해진다.

### D4. CI의 release gate를 고친다

현재 `image.needs = [verify]`이므로 이론적으로 `verify` 성공 + `compose` 실패 +
`image` 발행이 가능하다. GHCR publish를 Release Ready 신호로 쓰기로 한 이상 이것은
허용하면 안 된다. `image.needs = [verify, compose]`로 바꾼다.

### D5. 롤백 대상은 이미지가 아니라 Release 전체다

이전 제안은 backend 이미지만 기억했다가 되돌렸다. 그 시점에는 이미 `git reset --hard`가
끝나 있으므로 결과가 "이미지는 A, 설정은 B"가 된다. D1이 지적한 것과 **같은 종류의
불일치**다.

마지막으로 성공한 release를 명시적으로 저장하고, 실패하면 git revision과 image
digest를 **함께** 되돌린다.

### D6. preflight를 두 부류로 나눈다 ⚠️

"현재 backend가 healthy한가"를 배포 전제로 두면, **backend가 깨져서 그것을 고친
릴리스를 올리려는 순간 자동화가 배포를 거부한다.** 가장 급할 때 멈추는 설계다.

| preflight 대상 | 실패 시 |
|---|---|
| MySQL · Redis · 디스크 여유 · `compose config` | 배포 중단. infrastructure 장애로 알린다 |
| **backend 자체** | **배포를 진행한다.** 새 릴리스가 그것을 고칠 수 있다 |

backend가 이미 깨진 상태로 배포했다면 롤백 대상도 깨져 있다. 그 경우의 "롤백 후에도
unhealthy"는 CRITICAL로 올리지 않고 `PRE_EXISTING_FAILURE`로 기록한다. 오탐이 쌓이면
CRITICAL이 의미를 잃는다.

### D7. digest 고정이 서비스 목록 제한을 대체한다 ⚠️

인프라 이미지를 자동으로 올리지 않겠다는 목표를 "converge는 backend만 건드린다"로
달성하면, `compose.yaml`의 redis·caddy 설정 변경이 릴리스에 들어와도 적용되지 않는다.
git은 B, 실행 중 스택 설정은 A가 되어 **D1의 불일치가 스택 내부에서 재발한다.**

**모든 이미지를 digest로 고정하면 서비스 목록을 제한할 필요가 없다.** digest가 고정된
스택에 `up -d --wait`를 걸어도 MySQL이 몰래 올라가지 않는다. 인프라 업그레이드는
"digest를 바꾸는 PR"이 되고, 그 PR이 곧 하나의 release다. "명시적 PR + 리뷰"라는 원래
요구가 그대로 충족되면서 원자성도 지켜진다.

받아들여야 하는 부작용 하나: digest PR을 머지하면 MySQL이 재시작한다. 그것이 머지한
사람의 의도이므로 맞다.

### D8. controller를 안팎으로 나눈다 ⚠️

배포 스크립트가 자기 자신을 `git reset`하는 self-modifying deployment는 피해야 한다.
그렇다고 controller 전체를 checkout 바깥에 두면 **controller 업데이트가 수동 단계가
된다.** `deploy.yml`이 0회 실행된 이유가 정확히 그것이다 — 설치 단계가 문서에만 있고
아무도 하지 않았다.

```
/usr/local/lib/yorr-deploy/converge   ← 바깥. lock · discovery · state · HALT · 롤백 오케스트레이션
/var/lib/yorr-deploy/                 ← 상태
/opt/yorr/                            ← git checkout
/opt/yorr/deploy/apply.sh             ← 안. 실제 compose 실행
```

`converge`가 `git reset` 후 **`exec`으로** `apply.sh`를 부른다. 실행 중인 스크립트가
자기 밑에서 교체되는 문제는 사라지고, 릴리스 B의 배포 로직이 릴리스 B를 배포한다
(이쪽이 의미상 옳다). 롤백도 A로 reset한 뒤 A의 `apply.sh`를 부른다.

바깥 controller는 거의 바뀌지 않으므로 수동 bootstrap 빈도가 실질적으로 0이 된다.

### D9. HALT는 원인을 기록한다

빈 파일 대신 상태를 적는다.

```
HALTED_AT=2026-08-22T07:20:00Z
FAILED_REVISION=f2ac198...
FAILED_IMAGE=sha256:ABC...
ROLLBACK_REVISION=187bafc...
REASON=backend did not become healthy within 150s
```

HALT하지 않고 롤백만 하면 다음 회차가 같은 깨진 이미지를 다시 올려 **5분마다 게임을
죽이는 플랩**이 된다.

`rm HALTED`를 운영 인터페이스로 삼지 않는다. 내부적으로 파일을 쓰더라도 운영자가 쓰는
것은 명령이다.

### D10. 상태 파일은 셋뿐이다

```
/var/lib/yorr-deploy/
├── last-good     REVISION= / IMAGE=
├── halted        위 D9의 메타데이터
└── lock          flock 대상
```

"현재 무엇이 돌고 있는가"는 `docker inspect` + `git rev-parse`로 유도할 수 있으므로
별도 `current` 파일을 두지 않는다. 파생 가능한 상태를 이중으로 들면 어긋난다.

### D11. converge는 single writer다

systemd timer와 손 실행이 겹칠 수 있다. 스크립트 시작에 `flock`을 걸고, 이미 실행
중이면 즉시 종료한다.

---

## 7. converge 알고리즘

```
flock (실패하면 즉시 종료)

HALTED 있으면:
    종료. 하트비트를 보내지 않는다 — 멈춘 자동화는 죽은 자동화이고
    데드맨이 그것을 알려야 한다.

preflight:
    MySQL · Redis · 디스크 · compose config  → 실패하면 배포 없이 알리고 종료
    backend health                            → 실패해도 진행 (D6). 플래그만 기록

GHCR :main 메타데이터 조회
    candidate_digest   = digest(:main)
    candidate_revision = image의 org.opencontainers.image.revision

candidate == 현재 실행 중이면:
    하트비트, 종료

git fetch origin main                       ← verify보다 먼저 (아니면 항상 실패)
candidate_revision이 git에 있는지 확인

last-good 저장 (현재 revision + 현재 digest)

git reset --hard candidate_revision
compose config 검증
exec deploy/apply.sh candidate_digest       ← up -d --wait --wait-timeout 150

성공:
    last-good을 원자적으로 갱신 (tmp + rename)
    하트비트, 종료

실패 → 롤백:
    git reset --hard last-good.REVISION
    exec deploy/apply.sh last-good.IMAGE
    HALTED에 실패 메타데이터 기록

    롤백 healthy       → "배포 실패 / 롤백 성공" 알림
    롤백 unhealthy     → preflight의 backend 플래그를 본다
                          원래 깨져 있었으면 PRE_EXISTING_FAILURE
                          아니면 CRITICAL
    exit 1
```

이 구조에는 image ID diff 로직도, config diff 로직도, 셀프호스티드 러너도,
GitHub SSH 배포도 필요하지 않다.

---

## 8. 작업 순서

| PR | 내용 | 규모 | 의존 | 상태 |
|---|---|---|---|---|
| 1 | **Health semantics** | 2~3시간 | 없음 | ✅ 구현했다 |
| 2 | **CI Release Gate** | 1시간 | 없음 | ✅ 구현했다 |
| 3 | **Pull CD v2 (controller)** | 1~2일 | 1, 2 | ✅ 구현했다(호스트 미검증) |
| 4 | **Cutover** (호스트 작업) | 반나절 | 3 | ⛔ 호스트 접근이 필요하다 |
| 5 | **인프라 digest 고정 + 리소스 예산** | 반나절 | 4 | ⛔ 실측이 선행한다 |
| 6 | **마감 시각 영속화** | 1~2일 | 없음. 1~5와 병렬 가능 | ✅ 구현했다 |
| 7 | **게임 게이트 제거** | 2시간 | 4, 6 | ⛔ PR 4의 검증이 선행한다 |

### PR 1 — Health semantics ✅

`/actuator/health`를 readiness 의미로 구현한다. 단순히 HTTP 200인지가 아니라
**이 인스턴스가 실제 요청을 처리할 준비가 되었는가**를 뜻해야 한다.

- Redis `PING` · MySQL `SELECT 1` · 프로세스 자체
- 5초 캐시 (컨테이너 HEALTHCHECK가 반복 호출한다)
- 응답 형식은 기존 계약 유지 (`{"status":"UP"}` / 실패 시 503)
- 호스트를 건드리지 않는다

한 번의 변경이 세 곳을 동시에 업그레이드한다: 컨테이너 `HEALTHCHECK`,
배포 게이트(`--wait`), 외부 uptime 체크.

**구현 결과** — `backend/src/monitoring/readiness.ts`가 판정기이고
`http/routes/health.ts`가 그것을 라우트로 노출한다. 계획에 없었지만 구현하면서
필요해진 것 셋:

- **확인 하나에 2초 상한.** ioredis는 오프라인 큐가 기본값이라 Redis가 죽어 있으면
  `ping()`이 거부되지 않고 매달린다. 상한이 없으면 컨테이너 `HEALTHCHECK`가 자기
  타임아웃(5초)으로 잘려 판정 자체가 사라진다.
- **동시 호출 합류.** 캐시는 반복 호출을 흡수하지만 창이 만료된 순간 도착한 요청
  여럿은 나란히 왕복을 낸다. 이 엔드포인트는 프록시를 통해 공개된다.
- **판정기 미배선 = 항상 503.** prometheus 라우트와 같은 규약이며, 이 방향이면
  누락이 조용한 초록이 아니라 배포 거절로 드러난다.

실패한 확인의 이름은 **본문에 싣지 않고** 로그에만 남긴다(공개 표면이다). 로그는
판정이 바뀔 때만 한 줄 나간다 — 죽어 있는 동안 30초마다 같은 줄을 쌓으면 정작 전이
시점을 찾기 어려워진다.

### PR 2 — CI Release Gate ✅

- `backend.yml`의 `image.needs`를 `[verify, compose]`로 (`:145`)
- `sha-<커밋>` immutable 태그 유지
- `org.opencontainers.image.revision` label이 실제로 붙는지 워크플로에서 확인
- "GHCR publish = Release Ready"라는 계약을 워크플로 주석과 operations.md에 명시

**구현 결과** — 라벨 확인은 `metadata-action` 직후이고 `build-push`보다 앞선다
(라벨이 없으면 발행 자체를 하지 않는다). 두 단계로 본다: 40자리 hex SHA 모양인지,
그리고 `github.sha`와 같은지. 라벨이 통째로 사라진 경우와 값이 어긋난 경우는 원인이
다르므로 메시지를 나눴다.

⚠️ **처음에는 이벤트별로 기대값을 나눴다가 PR에서 빨간불을 냈다.** "PR 실행에서
`metadata-action`은 head 커밋을 적는다"고 짐작했는데 실제로는 **이벤트와 무관하게
`github.sha`를 적는다**(PR에서 그 값은 머지 커밋이다). 실측으로 확인했다:
PR #46에서 라벨은 `81ec734`, 그 값이 곧 `refs/pull/46/merge`였다. 기대값 분기를
없애는 것이 맞았다.

### PR 3 — Pull CD v2 ✅ (호스트 미검증)

새 controller를 **추가만** 한다. 기존 경로는 아직 지우지 않는다.

- `deploy/converge` — 바깥 controller (D8)
- `deploy/apply.sh` — 안쪽 실행부
- `deploy/status.sh` · `deploy/rollback.sh` · `deploy/bootstrap.sh`
- `deploy/systemd/yorr-converge.{service,timer}`
- GHCR release discovery (digest + revision label)
- `flock` · `last-good` · release 전체 롤백 · HALT 메타데이터 · preflight · `--wait`

**게임 게이트 3줄은 이 PR에 남긴다.** PR 6 전까지는 그것이 있어야 한다.
(converge를 먼저 넣으면서 게이트를 지우면 게임 중에도 그냥 끊는다.)

`bootstrap.sh`는 idempotent해야 하고, systemd 유닛의 호스트별 값을 **git 추적 파일이
아닌 곳**(`/etc/default/yorr-deploy`)에서 읽어야 한다. 현행 문서의 "유닛 파일을 손으로
고쳐라"가 `git pull`을 깨뜨린 원인일 가능성이 크다(§4).

#### 구현 결과

`deploy/tests/converge.test.sh`가 **§9의 표를 그대로 돌린다** — git은 진짜 저장소를
만들고 docker만 대역으로 바꿔 `up --wait` 실패·인프라 장애·게임 진행·잠금 경합을 실제로
주입한다(61개 단정). `backend.yml`의 `compose` 잡이 그것을 CI에서 돌리고, `image` 잡이
그 잡을 기다리므로 **배포 로직이 깨진 커밋의 이미지는 발행되지 않는다.** 지난번 자동화가
한 번도 실행되지 않은 채 머지된 것에 대한 대비다.

계획과 다르게 구현한 것 셋:

1. **`apply.sh`를 `exec`이 아니라 자식 프로세스로 부른다.** D8은 `exec`을 적었지만,
   `exec`이면 이 프로세스가 대체되어 **롤백·HALT를 할 주체가 사라진다** — 같은 문서 §7이
   그 둘을 controller의 책임으로 두었으므로 두 서술이 충돌한다. `exec`의 원래 목적(실행
   중 스크립트가 자기 밑에서 교체되는 것을 막기)은 이미 "controller가 체크아웃 바깥에
   있다"로 달성되어 있어 잃는 것이 없다.
2. **revision 라벨을 `imagetools inspect`가 아니라 받아 놓은 로컬 이미지에서 읽는다.**
   §4의 미확인 항목 3(라벨 출력 모양)에 발견 로직 전체를 걸지 않기 위해서다. digest
   해석만 `imagetools`로 하고(pull 없이 끝난다 — 같은 릴리스면 왕복 하나다), 그 digest를
   받은 뒤 라벨은 `docker image inspect`로 읽는다. 어차피 배포하려면 이미지가 로컬에
   있어야 하므로 왕복이 늘지 않는다. `buildx`가 없는 호스트를 위한 폴백도 있다.
3. **무변화 판정을 digest만으로 하지 않는다.** 처음에는 `running_digest == candidate_digest`
   하나로 no-op을 결정했다. 그런데 릴리스를 "revision + 설정 + digest"로 정의한 것이
   D1·D5이므로, **이미지가 같고 체크아웃만 뒤처진 상태는 수렴 대상**이다. 그 상태가 가정이
   아니었다: 2026-08-23 실측에서 호스트가 정확히 그랬다(체크아웃 9커밋 뒤처짐, 이미지는
   최신). digest만 봤다면 controller가 "할 일 없다"로 넘어가 **고치려고 만든 문제를 그대로
   남긴다.** 지금은 digest가 같을 때 이미지의 revision 라벨과 체크아웃 HEAD를 대조한다
   (라벨은 이미 로컬에 있는 이미지에서 읽으므로 왕복이 늘지 않는다).
   `converge.test.sh`의 1b가 그 상태를 재현한다.
4. **실행 중 digest를 `.Config.Image`가 아니라 RepoDigests로 구한다.** cutover 직전의
   컨테이너는 태그(`:main`)로 만들어져 있어 `.Config.Image`에서 digest를 얻을 수 없다.
   컨테이너 → 로컬 이미지 ID → 그 이미지의 RepoDigests로 가면 태그로 만들었든 digest로
   만들었든 같은 답이 나온다.

`apply.sh`는 digest 고정을 **`.env`에 적는다**(셸 환경변수가 아니다). 환경변수로만 주면
그 실행에만 걸리고, 다음에 누군가 손으로 `docker compose up -d`를 하면 compose 기본값인
`:main`으로 조용히 돌아간다 — 그때 증상은 "롤백했는데 잠시 뒤 다시 올라갔다"라서 원인을
찾기 어렵다. `.env`는 git이 추적하지 않으므로 이 쓰기가 `git pull`을 막지 않는다.

`up -d --wait`에 **서비스 목록을 주지 않는다**(D7). `backend`만 건드리면 같은 릴리스에
들어온 redis·caddy 설정 변경이 적용되지 않아 "git은 B, 실행 중 스택은 A"가 된다. 인프라
이미지가 몰래 올라가지 않는 것은 compose가 로컬에 있는 이미지를 다시 당기지 않기
때문이며, PR 5의 digest 고정이 그것을 계약으로 만든다.

상태 파일은 D10의 셋에 **`deferred-since` 하나가 더 있다.** 게임 게이트의 MAX_DEFER
상한을 세는 파일이며 게이트와 함께 PR 7에서 사라진다.

**게이트 쪽에서도 D6의 함정을 한 번 더 막아야 했다.** 게이지 조회는 컨테이너 안의 HTTP
왕복이라 crash 루프에서는 반드시 실패하고, 실패는 계약상 `unknown`(= 0이 아니다)이므로
미룸이 된다. 즉 backend가 깨져 있으면 **그것을 고치는 릴리스가 MAX_DEFER(기본 6시간)만큼
막힌다** — preflight에서 backend를 제외한 것과 정확히 같은 실패 모드가 게이트로 되살아나는
셈이다. 그래서 backend가 healthy가 아니면 게이트를 묻지 않는다(깨진 backend에는 끊을 게임도
없다). `deploy/tests/converge.test.sh`의 11b가 그것을 고정한다.

### PR 4 — Cutover (호스트 작업)

**롤백을 실제로 한 번 성공시켜 보기 전에는 기존 경로를 삭제하지 않는다.**

```
1. 새 controller를 호스트에 올린다        (타이머 없이)
2. 손으로 한 번 실행한다                   동일 release no-op 확인
3. test release를 배포한다
4. health 확인
5. rollback을 강제로 테스트한다
6. HALT / resume 테스트
7. 타이머 enable
8. 기존 auto-deploy 타이머 disable
9. 셀프호스티드 러너 disable + 등록 해제
10. 안정 확인 후 옛 스크립트·워크플로 삭제
```

삭제 대상: `deploy/auto-deploy.sh` · `deploy/deploy.sh` ·
`deploy/systemd/yorr-auto-deploy.*` · `.github/workflows/deploy.yml`.

3번을 통과하지 못하면 4번 이후를 하지 않는다. 지난번 자동화는 **한 번도 실행되지 않은
채 머지됐다**(`deploy.yml` 0회). 같은 방식이면 같은 결과가 난다.

### PR 5 — 인프라 digest 고정 + 리소스 예산

- `mysql` · `redis` · `caddy`를 digest로 고정 (D7)
- 서비스별 `mem_limit` · `cpus` — 단, **숫자를 임의로 먼저 박지 않는다.** 실제 peak
  RSS·CPU를 측정한 뒤 정한다
- 목표: 잘못된 backend 하나가 MySQL·SSH·systemd까지 굶기지 않게 한다
- `deploy/.env` 권한 검토 (600)

### PR 6 — 마감 시각 영속화 ✅

배포 아키텍처가 아니라 **애플리케이션 정합성** 문제이므로 분리한다.

```
현재:  게임 상태 → Redis,  라운드 마감 → 프로세스 메모리
개선:  게임 상태 → Redis,  라운드 마감 → Redis,  타이머 발화 → 단일 backend 프로세스
```

부팅 시퀀스:

```
boot → 활성 게임 로드 → 마감 로드
         ├─ 미래           → 타이머 재무장
         ├─ 이미 지남      → 즉시 전이
         └─ 유효하지 않음  → 해당 방 fail-closed
```

- **원칙 8(단일 인스턴스)을 바꾸지 않는다.** 프로세스 밖으로 나가는 것은 "마감 시각"
  이라는 *데이터*이고, "누가 타이머를 발화하는가"라는 *책임*은 그대로 이 프로세스에
  있다. 분산 락도 pub/sub도 필요 없다.
- 재무장은 반드시 **fail-closed**다. 방마다 try/catch, 실패한 방만 `rooms.close()`.
  반쯤 살아 있는 방을 남기면 상태는 살아 있는데 턴이 안 넘어가고 JOIN도
  `game_started`로 막히는 최악의 상태가 된다 — 이것이 지금 `StaleRoomCleaner`가
  막고 있는 실패 모드다.
- **세 게임을 모두 검증한다**: Yacht · Duel · PingPong. 각자 마감이 있다.
- 함께 사라지는 것: 재접속 스냅샷의 `DEADLINE_NOT_FOUND`
  (`gameReconnectSnapshotService.ts:72-75`), `StaleRoomCleaner`
  (`room/staleRoomCleaner.ts` — 주석이 스스로 삭제를 예약해 두었다).

#### 구현 결과

`game/round/deadlineStore.ts`가 포트, `game/yacht/redisRoundDeadlineStore.ts`가 운영
어댑터, `game/startupResume.ts`가 부팅 재무장이다. `StaleRoomCleaner`는 삭제했다.
검증은 `__tests__/serverWiring.test.ts`가 **실제로 재시작해서** 한다: 첫 서버를 닫고
같은 Redis를 물려받은 두 번째 서버를 세워 `listen()`을 부른 뒤, 방이 살아 있고 마감이
같은 값이며 재접속 스냅샷이 그 값을 싣는지 본다. 세 게임을 모두 그렇게 본다.

계획에 없었지만 구현하면서 드러난 것 넷:

1. **결투·탁구는 고칠 것이 없었다.** 두 게임은 마감(`nextActionAt`)이 처음부터 상태
   안의 절대 epoch ms이고 그 상태가 Redis에 있다. 즉 마감이 프로세스 인메모리였던 것은
   **야추뿐**이었다. 두 게임에 필요한 것은 부팅 때 예약을 다시 거는 것뿐이다.
2. **`resume`과 `rehydrate`를 갈라야 했다.** `resume`(모두 접속이 끊겨 멈춰 둔 시계를
   다시 켠다)은 새 25초를 주는 것이 맞고, `rehydrate`(프로세스만 죽었다)는 원래 마감을
   되살리는 것이 맞다. 하나로 합치면 한쪽이 반드시 틀린다 — 저장된 마감을 pause 복귀에
   쓰면 돌아온 사람의 턴이 그 자리에서 만료된다.
3. **되살리는 경로에서는 오프라인 판정을 하지 않는다.** 부팅 시점에는 아직 아무 소켓도
   붙지 않아 레지스트리가 전원을 오프라인으로 답한다. 그 판정을 태우면 재무장이 곧 턴
   스킵이 되고, 두 턴이면 `MAX_OFFLINE_TURNS`에 걸려 **재시작만으로 사람이 방에서
   쫓겨난다** — 없애려던 문제를 형태만 바꿔 되살리는 셈이다.
4. **좌석 레지스트리도 프로세스 메모리였다.** 이것이 가장 중요한 발견이다. 마감을
   되살려도 재접속 판정이 레지스트리만 보므로, 재시작 뒤 첫 `room.join`이 자기 방인데도
   새 참가로 보여 `GAME_ALREADY_STARTED`로 거절됐다. **되살린 판에 아무도 돌아올 수
   없으면 재무장은 무의미하다.** 그래서 진행 중인 방의 join은 방 명단(Redis)도 근거로
   보고, 명단에 자리가 있으면 재접속 경로로 흐른다(최초 참가 경로는 `resume`을 불러
   되살린 마감을 새 25초로 덮는다).

**`DEADLINE_NOT_FOUND`는 남겼다** — 계획은 함께 사라진다고 적었지만 원인이 둘이었다.
재시작 쪽은 사라졌고, **pause 상태의 방에 재접속하는 경로**는 그대로 살아 있다(재접속
분기가 `resume`을 부르지 않는다 — reconnect.md 「알려진 틈」). 그쪽을 고치려면 "멈춰
있을 때만 재개"라는 판정이 필요하고, 그것 없이 재접속마다 `resume`을 부르면 진행 중인
턴의 시계가 매번 새로 시작되어 **재접속으로 자기 제한 시간을 늘릴 수 있다.** 살아 있는
오류 경로를 지우는 것이 문서를 계획에 맞추는 것보다 나쁘므로 남기고 범위를 좁혔다.

상태 파일 D10의 셋에 더해 마감 키가 하나 생긴다:
`room:{code}:game:YACHT_DICE:deadline`. TTL은 독립으로 걸지 않고 쓸 때마다 방 키의
PTTL을 복사한다(라운드 상태 키와 같은 규약).

### PR 7 — 게임 게이트 제거

실제 프로세스 재시작 중에 게임이 복구되는 것을 검증한 뒤에만 한다.

- `yorr_rooms_active` 배포 의존성 삭제
- `YORR_DEPLOY_MAX_DEFER` 삭제
- game-aware deploy 로직 삭제

배포 시스템이 도메인 상태를 알 필요가 없어지는 것이 목표다. 최종적으로 controller는
"게임 중인가"를 묻지 않고 **"새 release가 있고 healthy하게 실행 가능한가"만** 판단한다.
게임 복구는 애플리케이션의 책임이다.

---

## 9. 통합 테스트 (PR 3~4)

shell unit test보다 **실제 failure injection**이 중요하다.

| 시나리오 | 기대 |
|---|---|
| 정상 배포 A → B, B healthy | B 유지, last-good = B |
| 깨진 backend A → B | A로 롤백, HALTED 기록 |
| 롤백까지 실패 | CRITICAL 알림 |
| CI/build race (git = B, GHCR = A) | **A 유지.** B 이미지 publish 이후에만 B 배포 |
| 실행 중 `main` 태그가 B로 이동 | 실행 중 컨테이너는 변하지 않음. 다음 수렴에서 명시적으로 B |
| 설정 호환성 (B compose + B image 실패) | **A compose + A image 둘 다** 복귀 |
| 타이머 중복 (converge 중 손 실행) | second writer 진입 금지 |
| 게임 중 backend restart (PR 6 이후) | WS 재접속 → 마감 복구 → 정상 다음 턴 |

---

## 10. 모니터링

별도 stack을 두지 않는다. 신호 4개, 전부 호스트 밖, 컨테이너 0개.

1. **외부 uptime** — 프로세스·호스트·TLS·DNS·방화벽을 한 번에 잡는다 (무료 SaaS, 5분)
2. **자동화 데드맨** — *아무것도 안 돌고 있음*. 실제로 일어난 실패다. 수렴 끝에 ping
3. **배포 상태 변화** — 실패 · 롤백 · HALT (Discord webhook)
4. **백업 데드맨** — 덤프 실패 · 오프사이트 복사 실패

운영 인터페이스는 둘이면 충분하다.

```bash
journalctl -u yorr-converge     # 무엇을 판단했는지
deploy/status.sh                # 지금 무엇이 돌고 있는지
```

`status.sh`는 추측하지 않고 controller의 실제 상태를 보여준다.

```
desired release : 187bafc / sha256:b7e...
running release : 187bafc / sha256:b7e...
last good       : 187bafc / sha256:b7e...
automation      : RUNNING
backend         : healthy
```

**Prometheus·Grafana를 넣지 않는 이유:** 노출 메트릭이 4계열(15일에 1.7 MiB)뿐이고,
게이지 2개의 유일한 소비자가 배포 게이트인데 PR 7에서 게이트가 없어지면 소비자가
사라진다. 이 규모에서 알고 싶은 것은 시계열이 아니라 이진 사건이다. 용량 때문이
아니다 — 12GB 중 10GB 이상이 비어 있다.

---

## 11. 보안 경계

### SSH는 break-glass 경로로만 유지한다

SSH를 없앨 필요는 없다. 다만 **CI/CD control plane으로 쓰지 않는다.**
허용 용도는 장애 조사 · 수동 롤백 · bootstrap · OS 유지보수뿐이다.

- 공개 키 전용, 비밀번호 로그인 off, root 로그인 off
- OCI ingress source 제한, brute-force 방어
- **GitHub Secrets에 SSH 키를 저장하지 않는다**

### 셀프호스티드 러너를 제거하는 이유는 리소스가 아니라 권한 경계다

```
GitHub workflow → self-hosted runner → docker socket → 사실상 host root
```

public 저장소에서 이 공격면을 유지할 이유가 없고, 실제 사용 횟수도 0회다.

### CI supply-chain hardening (PR 5 이후 별도 PR)

`actions/checkout@v4` 같은 mutable major 태그를 쓰고 있다. 운영 이미지를 만드는
워크플로의 third-party action을 commit SHA로 고정한다.

대상: `actions/checkout` · `actions/setup-node` · `docker/setup-qemu-action` ·
`docker/setup-buildx-action` · `docker/login-action` · `docker/metadata-action` ·
`docker/build-push-action`.

Dependabot이 SHA 업데이트 PR을 만들게 하면 관리 부담이 크지 않다. 이미지
attestation·서명 검증은 다음 단계로 남긴다. 현재 규모에서는
**immutable digest + 최소 권한 + SHA-pinned Actions**까지를 우선한다.

---

## 12. IP 문제 (별도 작업)

IP `161.33.36.118`이 ephemeral인데 세 곳에 박혀 있다.

1. `deploy/.env` → `PUBLIC_HOST`
2. `frontend/vercel.json` → rewrite 대상 (**git에 하드코딩**)
3. Vercel 환경변수 → `VITE_API_BASE_URL` · `VITE_WS_URL` (빌드 타임 주입)

2·3이 프론트라 IP가 바뀌면 프론트 재배포가 따라온다. `vercel.json`의 rewrite
destination은 환경변수 보간이 되지 않으므로 완전한 단일화는 불가능하다.
`deploy/set-public-ip.sh <새IP>` 하나가 세 곳을 처리하는 것이 현실적인 선에서의 대안이다.

**열린 결정:** IP를 지금 reserved로 바꿀 것인가. OCI에서 ephemeral → reserved 직접
전환은 되지 않고 주소가 한 번 바뀐다. 지금 계획해서 바꾸거나, 인스턴스를 잃을 때
강제로 바뀌거나 둘 중 하나다.

**열린 결정:** 백업 목적지 — OCI Object Storage(같은 클라우드) / Cloudflare R2(진짜
분리) / 개인 PC(Tailscale).

---

## 13. 도입하지 않는 것

Kubernetes · OKE · Argo CD · Jenkins · Nomad · Consul · 별도 deployment DB ·
별도 메시지 큐 · GitHub Actions에서 SSH로 미는 배포 · 운영 서버의 셀프호스티드 러너.

문제의 규모보다 control plane이 커진다. Docker Compose + systemd + GHCR이면 필요한
성질을 충분히 만들 수 있다.

---

## 14. 문서 갱신 규율

이 계획을 구현하는 동안 **문서가 아직 없는 것을 있다고 말하게 두지 않는다.**
`deploy.yml`이 0회 실행된 채 문서에는 정상 경로로 적혀 있던 것이 정확히 그 실패다.

- `operations.md`와 ADR-0006은 **현재 동작하는 것**만 기술한다. 새 구조는 PR 4의
  cutover가 끝난 뒤에 반영한다.
- 이 문서(`PLAN.md`)가 **예정**을 담는 유일한 자리다.
- PR 7까지 끝나면 이 문서를 삭제하고, 그 내용은 `operations.md`와 새 ADR로 옮긴다.

---

## 15. 관련 문서

- [`backend/docs/design/operations.md`](../backend/docs/design/operations.md)
  「배포 파이프라인」·「모니터링」 — **현재 동작하는 것**의 정본. 「알려진 결함」 절에
  버그 A·B가 있다
- [ADR-0006](../backend/docs/adr/0006-github-actions-ghcr-arm64-single-host.md) —
  현행 결정과 기각한 대안. 2026-08-22 갱신 메모 셋(러너 제거 · ARM 러너 근거 무효 ·
  Always Free 한도 축소)
- [`backend/DESIGN.md`](../backend/DESIGN.md) 원칙 8 — 단일 인스턴스 전제와
  "게임이 끊기는 것은 필연이 아니다"라는 구분
- [`backend/docs/design/rooms-and-sessions.md`](../backend/docs/design/rooms-and-sessions.md)
  「StaleRoomCleaner」 — PR 6이 삭제할 컴포넌트
- [`backend/docs/design/reconnect.md`](../backend/docs/design/reconnect.md) —
  `DEADLINE_NOT_FOUND`가 나는 경로

---

## 16. 설계 원칙 요약

- GitHub은 **build한다.**
- GHCR은 배포 가능한 **immutable release를 증명한다.**
- OCI는 desired release를 **pull하여 스스로 수렴한다.**
- Compose는 **컨테이너 상태를 수렴시킨다.**
- 애플리케이션은 프로세스 재시작에서 **게임 상태를 복구한다.**
- 롤백은 이미지가 아니라 **Release 전체를 되돌린다.**
