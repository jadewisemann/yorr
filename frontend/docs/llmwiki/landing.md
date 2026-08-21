# 랜딩 — 히어로 캐러셀·모드 선택·랭킹 티커

> SSOT: [`../../src/landing/screens/EntryPage.tsx`](../../src/landing/screens/EntryPage.tsx),
> [`../../src/landing/components/`](../../src/landing/components/), [`../../src/games.ts`](../../src/games.ts)

## 구조

`EntryPage` 하나가 760px 기준 두 레이아웃(narrow/wide)을 가진다. 구성:
`RankingTicker`(최상단) → 헤더(사운드·계정) → `LandingHeroCarousel`(+`LandingHeroCard`) →
`LandingProgress`(01/05 카운터 + tablist) → 코드 참가 칩/팝오버 → `ActiveRoomBanner`(복귀).

- 게임 카탈로그는 `src/games.ts`가 SSOT — 순서가 곧 01–05 인덱스이고, `live: true`
  (야추·탁구·석양)가 앞에 선다. 첫 칸들이 전부 잠긴 카드면 "할 게 없는 서비스"로 읽힌다.
- `?game=`은 마운트 시점의 **초기값으로만** 읽고, 선택 변경은 `replace` +
  `viewTransition: false`로 URL에 남긴다 — 히스토리에 쌓으면 뒤로가기가 랜딩 안에서
  게임을 하나씩 되짚느라 직전 화면으로 못 나가고, 전체 화면 전환 연출이 캐러셀 슬라이드와
  반대 방향으로 겹쳐 보였다.
- CTA는 카드당 **플레이 하나** — 파티/AI/연습 진입은 플레이를 누르면 서는
  `PlayModeDialog`(방 만들기 추천 + 온라인 대전·AI 대전·파티 모드·튜토리얼 얇은 목록)로
  옮겼다. 카드에 버튼이 여럿 서면 게임마다 클러스터 폭이 달라져 캐러셀이 흔들려 보였다.

## 캐러셀 (`LandingHeroCarousel`)

- MotionValue + 명령형 `animate`. 슬라이드 출발 위치는 `useLayoutEffect`에서 새 내용과
  같은 프레임에 써야 한다 — 한 프레임 늦으면 새 카드가 보였다가 옆으로 튕긴다.
- **드래그와 CTA의 충돌은 8px 임계값으로 가른다.** `closest('button')`이면 드래그를 아예
  안 시작하는 예전 규칙은 카드 폭을 채운 CTA 위에서 스와이프를 죽였다(엄지가 가장 먼저
  닿는 자리). pointerdown에서 캡처하면 호환 마우스 이벤트가 재타깃돼 버튼 click이 아예
  발화하지 않으므로, 임계값을 넘긴 뒤에만 캡처하고 승격된 드래그의 trailing click은
  capture에서 삼킨다(`event.detail === 0` 키보드 클릭은 통과).
- 화살표 키는 `document`에서 듣는다(섹션이 포커스를 받지 않으므로). 키보드·스크린리더의
  진입점은 캐러셀이 아니라 `LandingProgress`의 `role="tablist"`다. 순환(circular) 이동.
- 가운데 카드만 `HeroCanvas`를 렌더 — **WebGL 컨텍스트는 항상 1개**다.

## 히어로 3D (`HeroCanvas` · `heroScene`)

- `prefers-reduced-motion`·`saveData`·WebGL 불가면 three.js 자체를 받지 않는다 — 정지
  프레임 한 장을 위해 521KB를 내려받을 이유가 없다.
- 다이얼로그가 열려 `<main>`에 `inert`가 걸리면 그 속성을 신호로 렌더 루프를 세운다 —
  inert는 입력만 막고 렌더링은 멈추지 않는다.
- **매트한 실물 톤** — 20mm 망원 화각, MeshStandard(metalness 0) + ACES 톤매핑,
  라운드 엣지 주사위, 3점 조명(따뜻한 키 + 차가운 필 + 실루엣용 림), PCFSoft 그림자.
  광택·환경맵·금속은 쓰지 않는다 — "3D 렌더" 티가 나면 디자인 의도에서 벗어난다는
  원칙은 그대로고, 초기의 Lambert 단색(콘크리트 블록처럼 읽혔다)에서 재질감만 올렸다.
  주사위 한 개는 레드 바디다(야추의 "킵 = 레드" 문법, 같은 텍스처에 color 틴트만 곱한다).

## 랭킹 티커 (`RankingTicker`)

- narrow는 증권 시세표처럼 CSS keyframes로 흐른다(아래에서 3D가 rapier 스텝을 돌리므로
  끝없는 것에 JS 프레임을 쓰지 않는다) · wide는 흐르지 않고 상위 몇 명 + 드롭다운(motion).
- 실패하면 아무것도 그리지 않는다 — 랭킹은 부가 정보다. 게스트에게는 "내 순위"를 묻지
  않는다. 안 보이는 탭에서는 폴링하지 않는다(1분 주기 + visibility 게이트).

## 코드 참가

- 실제 방 코드는 4~12자라 레퍼런스의 4칸 분할 입력 대신 한 칸 mono 필드.
- input에 `maxLength`를 두지 않는다 — 브라우저가 정규화 전 원문을 잘라 초대 URL 붙여넣기가
  `https://yorr`(12자)로 잘려 엉뚱한 코드가 통과한다. 정규화(`sanitizeRoomCodeInput`)가
  URL에서 `?code=`를 추출한다.

## 진입 핸들러 → 목적지

| 동작 | 목적지 |
|---|---|
| 방 만들기 | `/join?game=<key>` (탁구만 `/party?game=pingpong`) |
| 온라인 대전(빠른 대전) | `/join?game=<key>&mode=quick` (비로그인은 로그인 유도) |
| 파티 모드 | `/party?game=<key>` (`isPartyGameKey` — gameCode 있는 게임만) |
| 튜토리얼 | `/tutorial` (야추만) |
| AI와 대전 | `/pingpong` (탁구만) |
| 코드 참가 | `/join?code=<정규화>` |

다이얼로그는 전부 `<main>` **밖**에 그린다 — `useDialogBackground`가 main에 `inert`를
걸어 안에 두면 자기 자신이 잠긴다.
