/**
 * 클립보드 복사. 실패하면 false — 호출부는 텍스트영역 폴백을 보여줘
 * 사용자가 길게 눌러 직접 복사할 수 있게 한다 (인앱 브라우저 등 권한 제약 대비).
 */
export async function copyTextToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
