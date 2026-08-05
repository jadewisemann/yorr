/**
 * 폰이 방에 붙는 동안의 타이밍. (S15P11A406-205)
 *
 * 여기 모아 두는 이유는 <b>실기기에서 함께 튜닝하는 값들</b>이기 때문이다. 재연결 간격과
 * 단계 전환 시간은 화면 두 곳(`app/RealtimeSync` · `room/components/ControllerConnectSequence`)에
 * 흩어져 있었는데, 하나만 만지면 "끊겼다가 붙는 데 걸리는 체감 시간"이 어긋난다 —
 * 재연결이 1초인데 단계 표시가 0.2초면 붙기도 전에 붙었다고 하는 화면이 된다.
 *
 * 게임별 값(야추 스윙 쿨다운 등)은 여기 두지 않는다. 이 파일은 연결 시퀀스만 맡는다.
 */

/** 끊긴 뒤 다시 붙어 보기까지. 짧으면 지하철 터널에서 시도만 태우고 끝난다. */
export const RECONNECT_DELAY_MS = 1_000

/** 이 횟수만큼 연속으로 재연결에 실패하면 세션을 포기한다(FSM: any → idle). */
export const MAX_RECONNECT_ATTEMPTS = 10

/**
 * '연결 중'을 최소한 이만큼은 보여준다. 로컬·LTE에서는 연결이 100ms 안에 끝나 단계가
 * 통째로 깜빡이고 지나간다 — 무슨 일이 있었는지 못 본 사람에게는 화면이 그냥 튄 것이다.
 */
export const CONNECTING_MIN_MS = 600

/** '연결됨'을 보여주고 사용법으로 넘어가기까지. 진동과 같은 순간에 시작한다. */
export const CONNECTED_HOLD_MS = 900

/**
 * 연결됐을 때의 진동 길이(ms). 폰은 주머니에 있거나 QR을 찍느라 아래를 보고 있어서
 * 화면 변화만으로는 놓친다. iOS Safari는 `navigator.vibrate`가 없어 조용히 건너뛴다.
 *
 * ponytail: 사운드 피드백은 넣지 않았다 — 앱에 일회성 효과음 재생기가 없어서(있는 건
 * 배경음악 `shared/audio/soundtrack`뿐) 이 한 곳을 위해 WebAudio 층을 새로 깔아야 한다.
 * 효과음이 다른 곳에도 필요해지면 그때 만들고 여기서 같이 울린다.
 */
export const CONNECTED_VIBRATE_MS = 40
