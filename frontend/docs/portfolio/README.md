# 정유진 — YORR 프론트엔드 포트폴리오

> **6인 팀에서 프론트엔드를 단독 담당**하여, 휴대폰을 흔들고 휘두르며 즐기는 실시간
> 멀티플레이 웹 게임 플랫폼의 클라이언트 전체를 출시 품질로 구현했습니다.
>
> [서비스](https://yorr.site) · [GitHub @jadewisemann](https://github.com/jadewisemann) ·
> 근거: 이 저장소의 git 히스토리 (`git log --all --author='jadewisemann' --no-merges`)

## 프로필

| 항목 | 내용 |
|---|---|
| 이름 | 정유진 ([@jadewisemann](https://github.com/jadewisemann)) |
| 프로젝트 | YORR(요르) — 모바일 브라우저 실시간 멀티플레이 게임 플랫폼 (SSAFY 6인 팀 프로젝트) |
| 역할 | **프론트엔드 단독 담당** + develop 통합 머지 담당 (나머지 5인은 백엔드·인프라) |
| 기간 | 2026-07-29 ~ 08-10 (이 미러 저장소에서 확인 가능한 활동) |
| 핵심 스택 | React 19 · TypeScript(strict) · Vite · Zustand · TanStack Router · Three.js · Rapier(WASM) · WebSocket · WebRTC · Tailwind CSS 4 · Vitest · Playwright · MSW · (교차) Java/Spring |

## 숫자로 보는 기여

| 지표 | 값 |
|---|---|
| 본인 저작 커밋 | **50개** (feat 18 · fix 17 · refactor 7 · test 3 · docs 2 · 기타 3) — 전체 원장: [fact-sheet.md](./fact-sheet.md) |
| develop 통합 머지 | **74회** — MR 검토 후 병합을 도맡은 사실상의 통합 담당 |
| 코드 규모 | frontend **+54,700 / −11,100 라인** (lockfile·에셋 제외) |
| 백엔드 교차 수정 | 6건, **+1,488 라인** (Java/Spring — 판정·스케줄러·세션 복구) |
| 테스트 | 단위 테스트 **100파일 823개** · E2E **17스펙 × 4 프로젝트** · 커버리지 래칫 st96/br91/fn96/ln98 |
| 문서 | 코드베이스 위키 17페이지 설계·작성 |

## 이 제품이 어려웠던 이유

1. **입력이 특이하다** — 마우스가 아니라 휴대폰 모션 센서(흔들기·스윙·휘두르기)가 1급
   입력. iOS/Android의 센서·오디오 정책 편차를 흡수하면서, 센서가 없어도 탭으로 완주돼야 한다.
2. **실시간 멀티플레이 + 모바일 브라우저** — 서버가 상태의 최종 권위자인데, 모바일
   브라우저는 백그라운드 전환·잠금·터널에서 수시로 끊긴다. 재접속 복구가 곧 품질이다.
3. **3D 물리 연출과 공정성의 충돌** — 주사위는 진짜 물리로 구르되, 멈춘 면은 서버가
   정한 값과 일치해야 한다.
4. **입력 수단 간 공정성** — 폰을 휘두르는 사람과 키보드를 누르는 사람이 같은 게임에서
   만난다. 물리적 동작 시간과 네트워크 지연을 보상해야 밸런스가 성립한다.

## 대표 작업

### 1. 3D 주사위 — 결정론적 예측 시뮬 + 서버 권위 리맵 ⭐ 대표작

서버가 정한 주사위 값과 "진짜 물리" 연출을 동시에 만족시키는 파이프라인을 설계·구현.

- 던지는 순간 Rapier 월드를 복제해 **480Hz로 끝까지 미리 굴리고**, 화면은 그 궤적을
  재생만 한다 — 두 번째 시뮬을 만들지 않는 것이 결정론의 핵심.
- 큐브 대칭 회전(90°/180° 쿼터니언 오프셋)을 렌더링에만 곱해 **물리는 자연스럽게 멈추고
  화면에는 서버 값이 위를 향하게** 했다.
- 슬로모션 낙하 문제를 **물리 닮음(dynamic similarity)** 으로 해결 — 중력만 올리면 비행
  중 회전이 반토막 나는 것을 실측으로 증명하고, `GRAVITY_SCALE` 노브 하나에서 전 상수를
  재유도.
- 관통(겹침)은 60→480Hz + soft CCD로 관통 깊이 0.284 → 0.073. QA 반복 제보되던 주사위
  버그(겹침·미정착·순서 역전·슬로모션)가 소멸했다.

→ 상세: [dice-physics.md](./dice-physics.md) · 약 +5,200라인 (물리 단위 테스트 포함)

### 2. 실시간 아키텍처와 세션 복구 — FE/BE를 관통하는 설계

- 세션 상태를 저장하지 않고 **순수 함수로 파생하는 FSM** — 두 소스가 어긋나며 생기는
  유령 세션을 구조적으로 차단.
- 재접속은 `sessionToken` + 서버 측 정체성 복원으로 — 서버의 `RoomSessionRegistry` /
  `HeartbeatMonitor`(Java)까지 **직접 구현**해 끝단 간 복구를 완성.
- 스냅샷 병합 불변식을 WS/REST 양쪽에 대칭 적용해 "REST 응답이 game.over를 덮어 결과
  화면이 영영 안 뜨는" 실측 레이스를 제거.
- 결과: 새로고침·브라우저 재시작·네트워크 단절 모두에서 점수판 손실 없이 복귀.
  E2E 10스펙으로 잠금.

→ 상세: [realtime-and-recovery.md](./realtime-and-recovery.md)

### 3. 모바일 웹 엔지니어링 — 센서 입력과 iOS 정책 우회

- DeviceMotion **제스처 인식기를 직접 구축** — 기기별 노이즈 캘리브레이션, 히스테리시스
  상태기계, 실기기 튜닝 도구(`/__dev/motion`, 센서 스트림 녹화/재생)까지.
- iOS Safari의 가속도 **부호 규약이 Chrome과 반대**임을 규명하고 판정을 절댓값 기반으로
  재정의 — "아이폰에서 던지기가 안 되던" 버그의 근본 수정.
- iOS 오디오 정책(volume 대입 무시·요소별 제스처 이력·play() 파이프라인 재구축 지연)을
  실측으로 규명하고 Web Audio 경유로 우회.
- 입력 공정성: 스윙 vs 키보드의 물리 동작 시간 차이를 **전송 지연으로 보상** — 신고값을
  키우는 방식은 서버 clamp에 깎여 회선 빠른 쪽에서 페널티가 사라진다는 것까지 설계에 반영.

→ 상세: [mobile-web-engineering.md](./mobile-web-engineering.md)

### 4. 크로스 스택 디버깅 — 프론트 증상에서 서버 원인까지

- **"완벽한 스윙이 네트에 걸린다"** → 서버가 도착 시각으로 판정해 업링크 지연이 통째로
  페널티가 됨을 수치로 증명(판정창 0.12 pos ÷ 1.0 pos/s = 120ms), 클라 변경 0줄로 서버
  판정 시각을 `clientTs` 되감기로 교체.
- **"공이 얼어붙고 방이 멈춘다"** → 재현 대신 코드 경로 분석으로 스케줄러의 등록 순서
  레이스를 특정, delay 0이 필연인 도메인 조건(TOO_LATE는 정의상 마감 40ms 전 발생)까지
  역추적해 수정.
- **데모 직전 배포 회귀** → 3건 중 2건 원인 특정, 1건 미확정 상태에서 **원인 확정 대기
  대신 롤백**을 판단하고 복구 경로(git revert 동작 원리 포함)까지 커밋에 문서화.

→ 상세: [cross-stack-debugging.md](./cross-stack-debugging.md)

### 5. 테스트 인프라 — 2단 E2E와 커버리지 래칫

- 프로덕션 빌드에서 MSW가 컴파일 아웃되는 제약을 **mock 백엔드 2벌**(MSW+Fake client /
  Playwright `routeWebSocket` 페이크 서버)로 풀고, 손으로 유지하는 계약 미러로 **와이어
  계약이 바뀌면 테스트가 먼저 깨지게** 설계.
- 커버리지는 "전체 소스 분모 + 래칫 하한" — 유일한 비결정 파일을 동일 테스트 2회 실행
  비교로 실측 특정해 제외하고 근거를 문서화.
- flake를 재시도로 덮지 않고 근본 원인(jsdom의 WAAPI 부재, CI 30배 부하 배율)을 측정해
  제거 — CI 랜덤 실패 0.

→ 상세: [testing-infrastructure.md](./testing-infrastructure.md) · 하네스 구축 +11,474라인/102파일

### 6. 아키텍처 리드 — 구조 재편·디자인 시스템·문서 체계

- **236파일 도메인 우선 구조 재편**을 하루 만에 무사고로 완료하고 의존 방향을 CI(dpdm)로
  강제 — 이후 게임 2종(탁구·석양)이 폴더 추가만으로 안착해 구조의 유효성을 증명.
- Tailwind v4 **토큰 2계층 디자인 시스템** — tailwind-merge 충돌 그룹 등록 조건, 레시피의
  레이어 순서까지 규명하고, 규칙마다 정량 근거(게임 화면 DOM의 31%가 중복 class 측정 등)를
  남김.
- 문서를 **인덱스형 LLM/에이전트 위키**로 설계 — "표에 없는 문서는 없는 것과 같다",
  문서와 코드가 충돌하면 코드가 이긴다는 SSOT 운용.

→ 상세: [architecture-and-design-system.md](./architecture-and-design-system.md)

## 만든 제품 기능

파티 모드(큰 화면 + QR 폰 컨트롤러, 방장 승계) · 빠른 대전(대기열 매칭) · 폰 컨트롤러
모드 3종 · 아케이드 캐러셀 랜딩(구축 후 스스로 단순화한 이력 포함) · 튜토리얼/레버리지
로컬 모드(실제 게임 화면이 1인 가짜 서버 위에서 도는 구조) · 이모지 리액션 · 주간 랭킹
티커 · WebRTC 음성 채팅 UI · Popover 배치 엔진.

→ 상세: [product-features.md](./product-features.md)

## 문서 안내

| 문서 | 내용 |
|---|---|
| [overview.md](./overview.md) | 프로젝트·역할·기여 규모 상세 |
| [dice-physics.md](./dice-physics.md) | 대표작 1순위 — 3D 주사위 물리 |
| [realtime-and-recovery.md](./realtime-and-recovery.md) | 실시간 아키텍처·세션 복구 |
| [mobile-web-engineering.md](./mobile-web-engineering.md) | 센서 입력·iOS 편차·입력 공정성 |
| [cross-stack-debugging.md](./cross-stack-debugging.md) | 크로스 스택 디버깅 3제 |
| [testing-infrastructure.md](./testing-infrastructure.md) | 테스트 인프라 |
| [architecture-and-design-system.md](./architecture-and-design-system.md) | 구조 재편·디자인 시스템·문서 체계 |
| [product-features.md](./product-features.md) | 제품 기능 전체 |
| [fact-sheet.md](./fact-sheet.md) | 본인 저작 커밋 50개 전체 원장 |
| [index.md](./index.md) | LLM 주입용 인덱스 (이력서·면접 답변 생성용 메타 문서) |

기술 디테일의 근거는 각 문서가 가리키는 [코드베이스 위키(llmwiki)](../llmwiki/index.md)와
커밋 해시(`git show <hash>`)로 검증할 수 있습니다. 일부 커밋은 AI 페어 프로그래밍으로
작성됐고 커밋 트레일러에 명시되어 있습니다 — 대형 설계·리팩터링·물리 작업은 전부 직접
저작입니다.
