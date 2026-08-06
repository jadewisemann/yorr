/**
 * 진동 한 줄 — 게임을 모르는 기기 출력이라 도메인이 아니라 shared 에 둔다.
 *
 * <b>진동은 언제나 보조 신호다.</b> iOS Safari에는 Vibration API 자체가 없어서 아이폰에서는
 * 아무 일도 일어나지 않는다(폴리필도 없다 — 대체할 원본 API가 없다). 진동이 있어야만
 * 알 수 있는 정보를 여기에 실으면 그 화면은 아이폰에서 깨진다. 소리·글씨가 먼저 말하고,
 * 진동은 그 위에 얹는 것까지만 한다.
 *
 * 탭이 숨어 있을 때 울리지 않는 이유: 게임은 서버 상태로 계속 흐르므로, 다른 앱을 보는
 * 동안에도 이벤트는 도착한다. 보이지도 않는 화면 때문에 주머니 속 폰이 떨면 고장으로 읽힌다.
 */
export function vibrate(pattern: VibratePattern) {
  if (document.hidden || typeof navigator.vibrate !== 'function') return
  navigator.vibrate(pattern)
}

/**
 * 승패는 게임을 가리지 않는다 — 탁구에서 이긴 손과 결투에서 이긴 손이 다르게 떨 이유가
 * 없어서 두 결과 화면이 같은 값을 쓴다.
 *
 * 승리는 올라가는 세 번, 패배는 한 번 길게 내려앉는다. 결과 화면은 이미 글씨로 승패를
 * 말하므로 여기서 길이를 다투지 않는다 — 손은 "끝났다"만 알면 된다.
 */
export const WIN_VIBRATION = [40, 60, 40, 60, 120]
export const LOSE_VIBRATION = 320
