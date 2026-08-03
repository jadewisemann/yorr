const TUTORIAL_HIDDEN_COOKIE = 'yorr.tutorial-hidden'
/**
 * "다시 보지 않기"는 기기 단위 선택이다. 방 세션(40분)보다 훨씬 길어야 하므로
 * localStorage 대신 만료를 명시할 수 있는 쿠키에 1년으로 둔다.
 */
const TUTORIAL_HIDDEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

/**
 * 첫 진입 안내(툴팁 코치마크)를 이미 보고 닫았는지. 쿠키를 못 읽는 환경이면 보여주는 쪽으로 둔다.
 * 한 턴을 따라다니는 튜토리얼은 이제 도움말에서 직접 켜므로 이 쿠키와 무관하다(S15P11A406-143).
 */
export function isTutorialHidden(): boolean {
  return readCookie(TUTORIAL_HIDDEN_COOKIE) === '1'
}

export function hideTutorial(): void {
  try {
    // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API는 Safari가 지원하지 않는다 — 모바일 사파리가 주 타깃이라 document.cookie를 쓴다
    document.cookie = `${TUTORIAL_HIDDEN_COOKIE}=1; max-age=${TUTORIAL_HIDDEN_MAX_AGE_SECONDS}; path=/; samesite=lax`
  } catch {
    // 쿠키가 막힌 환경(임베디드 웹뷰 등)에서는 저장 실패가 게임을 막으면 안 된다.
  }
}

function readCookie(name: string): string | null {
  try {
    for (const pair of document.cookie.split(';')) {
      const [key, ...rest] = pair.split('=')
      if (key?.trim() === name) return rest.join('=').trim()
    }
    return null
  } catch {
    return null
  }
}
