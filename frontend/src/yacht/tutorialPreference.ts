const TUTORIAL_HIDDEN_COOKIE = 'yorr.tutorial-hidden'
const TUTORIAL_HIDDEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

export function isTutorialHidden(): boolean {
  return readCookie(TUTORIAL_HIDDEN_COOKIE) === '1'
}

export function hideTutorial(): void {
  try {
    // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API는 Safari가 지원하지 않는다 — 모바일 사파리가 주 타깃이라 document.cookie를 쓴다
    document.cookie = `${TUTORIAL_HIDDEN_COOKIE}=1; max-age=${TUTORIAL_HIDDEN_MAX_AGE_SECONDS}; path=/; samesite=lax`
  } catch {}
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
