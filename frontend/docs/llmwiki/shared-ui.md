# 공용 레이어 — 프리미티브 UI·훅·REST 클라이언트

> SSOT: [`../../src/shared/`](../../src/shared/)

## 컴포넌트 인벤토리 (`shared/components/`)

| 컴포넌트 | 요점 |
|---|---|
| `Button` | variant 4종(primary/secondary/ghost/danger) × size 4종(+cta), 정적 map, `loading`→`aria-busy`. `ComponentProps<'button'>`이라 ref가 통과 — 팝오버 앵커에 필요 |
| `Popover` | 앵커 기준 배치 엔진 — 아래 상세 |
| `BottomSheet` | 76% 높이, 드래그 해제(80px), 수동 포커스 트랩. variants와 드래그가 같은 transform을 다투므로 여기서 이어 붙인다. `pb-[max(1.5rem, env(safe-area-inset-bottom))]` — iOS 홈 인디케이터 |
| `Modal` | `dialog`/`alertdialog`. alertdialog는 스크림 클릭으로 닫히지 않는다 — 확인은 명시적 버튼으로만 |
| `TextField` | label·help·error를 `aria-describedby`/`aria-invalid`/`role="alert"`로 배선 |
| `Alert` | 블록 알림. tone 3종(neutral/danger/positive) 정적 map. **`role`을 톤이 정한다** — danger→`alert`, positive→`status`, neutral은 비움(처음부터 화면에 있는 설명문이라 live region이 아니다). 호출부가 `role`을 넘기면 덮인다. 알약 배지는 여기 넣지 않는다 |
| `Badge` | 알약 배지(낱말 한정). tone 3종(neutral/warning/brand). **크기는 호출부 몫** — 실측상 패딩 5종·글자 2종으로 자리마다 달라, 사다리를 강제하면 겉모습이 한꺼번에 바뀐다. 반복되던 것은 크기가 아니라 색 세 줄이었다(warning 두 곳은 바이트까지 동일) |
| `Panel` | 상자 표면. surface 3종(surface/raised/sunken) + `as`로 시맨틱 태그 선택(div/section/article/ul) — 실측 13곳 중 `<div>`는 둘뿐이라 태그를 고정하면 시맨틱을 뺏는다. 패딩 기본값 없음(p-1~p-6 열다섯 값). 속성 타입이 `HTMLAttributes<HTMLElement>`인 것은 `ref`가 태그마다 달라서다 |
| `Tooltip` | 탭 토글형 toggletip. focus가 연 툴팁을 직후 click 토글이 닫는 문제를 `passiveOpenRef`로 구분. 히트 영역은 `::before`로 44px 확장 |
| `ToastHost` | 한 번에 하나, 2.5초, `aria-live="polite"` |
| `ConnectionBanner` | live region 컨테이너를 **항상** 렌더 — 영역과 내용이 같은 프레임에 오면 스크린리더가 놓친다. `closed`는 assertive |
| `LoadingOverlay` | 닫을 수 없는 상태 전용 — Modal은 닫기 버튼을 전제해 쓸 수 없다 |
| `AudioPopover` | 마스터 음소거 + 음악/효과 슬라이더 + 마이크 행. 음성 불가면 행 자체를 뺀다 — 실패하는 버튼은 사용자가 자기 잘못이라 생각한다 |
| `Icon` | 20×20 · `currentColor` · `aria-hidden` 고정 10종. 이모지·글리프는 currentColor·폭·크기 통제가 안 돼 SVG로 통일 |

### Popover 배치 엔진

`placeByAnchor(anchor, width)`: 앵커 중심에 정렬하되 뷰포트 안으로 클램프(마진 12px),
**아래가 좁고 위가 더 넓을 때만** 뒤집는다(헤더 버튼은 위가 좁으므로 뒤집지 않는 게 낫다),
꼬리(`tailLeft`)는 패널이 눌려도 앵커를 가리키도록 인셋 클램프. `useLayoutEffect`에서
페인트 전에 측정(늦으면 첫 프레임이 엉뚱한 곳), `transformOrigin`을 꼬리 위치로 —
팝오버는 트리거 쪽에서 자라야 위치 관계가 읽힌다. 스크롤은 패널이 아니라 내용 래퍼에 —
패널에 걸면 꼬리가 잘린다. 반드시 `<main>` 밖에 렌더(inert 자기 잠금).

## 훅·유틸

- `useDialogBackground(open)` — body 스크롤 잠금 + `<main>` inert. **열린 개수를 센다** —
  시트 위에 모달이 겹칠 때 먼저 닫히는 쪽이 배경을 되살리면 안 된다. `aria-modal`만으로
  안 되는 이유: 스크린리더 브라우즈 모드가 뒤 화면으로 넘어가고 배경이 터치 스크롤된다.
- `useMediaQuery` — **레이아웃 구조가 갈릴 때만.** 스타일 차이는 Tailwind variant로.
- `rovingFocus` — 랜딩 tablist와 야추 리액션 픽커가 같은 패턴을 쓰는데 의존 방향상 야추가
  랜딩을 import할 수 없어 shared로 왔다.
- `useSwing` — [motion-input.md](./motion-input.md).
- `audio/` — iOS 볼륨 우회(`elementVolume`), BGM(`soundtrack`), 효과음, 음소거 영속화,
  첫 제스처 언락. 상세는 [voice.md](./voice.md)의 iOS 절.

## REST 클라이언트 (`shared/api/`)

- `client.ts`: `API_BASE_URL = VITE_API_BASE_URL ?? '/api/v1'` — 상대경로면 dev 프록시가
  받는다. 전체 페이지 이동(소셜 로그인)에도 같은 값을 써야 두 환경이 안 갈라진다.
  `ApiError(status, message, code, payload)`. 실서버가 text/plain으로 주는 코드 문자열
  (`room_full` 등)도 표준 코드로 매핑한다.
- `userError.ts`: 코드 → `{message, canChangeRoom, clearsSession}` 표. `SESSION_EXPIRED`만
  세션을 지운다.
- `useAsyncTask` / `useAsyncQuery`: 실행마다 이전 요청 abort, 언마운트 가드.
  `queryKey === null` = "묻지 않는다". `execute()`는 실패·abort 시 `undefined`를 돌려주므로
  호출부는 반드시 결과를 확인한다.
- `rankingApi` / `useRankingApi`: 주간 랭킹 60초 폴링 + visibility 게이트(안 보이는 탭은
  묻지 않는다). "내 순위"는 204/401/403을 전부 `null`로 접는다 — 곁가지 정보라 화면이 할
  일이 같다. 폴링 주기를 주입 가능하게 둔 것은 fake timer + MSW 실타이머 혼합이 스위트를
  불안정하게 만든 실측 flake 때문이다.
