# REST API — 프론트가 실제로 호출하는 엔드포인트

> 기준: `src/room/api/roomApi.ts` · `quickMatchApi.ts` · `src/auth/api/authApi.ts` ·
> `src/shared/api/rankingApi.ts` · `src/pingpong/pingPongAiResultApi.ts`.
> base `/api/v1`(`VITE_API_BASE_URL`로 재정의). 인증 호출은 `Authorization: Bearer` +
> `X-User-Id`. 이 문서는 프론트 관찰 기준이다 — 백엔드 스냅샷을 두면 어긋난다.

## 방·게임

| 메서드 | 경로 | 용도 |
|---|---|---|
| `POST` | `/rooms?game_code=` | 방 생성(`room_id` 없이, host) 또는 참가(`room_id` 포함, participant). 로그인 시 `session_token` 동봉 — 없으면 서버가 게스트 발급 |
| `POST` | `/rooms?game_code=&party=true` | 파티 대시보드 방 생성 — 닉네임 없음, 세션이 플레이어 명단에 오르지 않음 |
| `GET` | `/games/{gameId}` | 스냅샷 백필(1회) — 진행 상태 SSOT는 WS, `preserveRealtimeGame`이 phase를 되돌리지 않는다 |
| `POST` | `/rooms/{roomCode}/games` | 게임 시작 (host) |
| `POST` | `/rooms/{roomCode}/lobby` | 재대결 — 대기실 복귀 (host). 화면 전환은 `state.sync`가 담당 |
| `POST` | `/rooms/{roomCode}/bots` · `DELETE .../bots/{botId}` | 봇 추가/제거 (야추만) |
| `POST` | `/games/{gameId}/score-candidates` | 카테고리별 점수 후보 조회 |
| `DELETE` | `/rooms/{roomCode}/players/me` | 방 나가기 — 실패해도 로컬 정리 |

응답 변환 불변식: `roomId = roomCode = room_id`, 모르는 phase는 스냅샷 전체 거부,
`membershipRole`은 서버 값이 아니라 어느 호출을 했는지로 프론트가 붙이는 라벨
(host 판단은 항상 `snapshot.hostId`).

## 빠른 대전

`POST /quick-matches?game_code=` (대기열 진입, 멱등) · `GET /quick-matches` (1초 폴링 —
`MATCHED` 후에도 `PLAYING`까지 계속: 이 요청이 소켓 확인·게임 시작을 진행시킨다) ·
`DELETE /quick-matches` (WAITING에서만 실효). 전부 회원 인증 필수.

## 인증·프로필

| 메서드 | 경로 | 용도 |
|---|---|---|
| `GET` | `/auth/kakao/authorize` · `/auth/google/authorize` | 로그인 시작 — **전체 페이지 이동** |
| `POST` | `/auth/session` | 콜백 code → 세션 교환 |
| `GET` | `/auth/me` | 세션 검증 (401만 사망으로 판정) |
| `DELETE` | `/auth/session` | 로그아웃 |
| `PATCH` | `/users/me` | 닉네임 변경 |

## 기타

- `GET /rankings/weekly` · `GET /rankings/weekly/me` — 주간 랭킹(60초 폴링 + visibility
  게이트), "내 순위"는 204/401/403 전부 null
- `POST /games/ping-pong/ai-results` — AI 탁구 결과 저장(1회, 실패 무시)
- `GET /voice/ice` — TURN/STUN 설정 (절대 경로 필수·무캐시 — [voice.md](./voice.md))

오류 처리: `ApiError{status, message, code}` → `toUserError` 표
(`SESSION_EXPIRED`만 세션 삭제). 실서버의 text/plain 코드 문자열도 표준 코드로 매핑.
WebSocket 이벤트는 [realtime.md](./realtime.md).
