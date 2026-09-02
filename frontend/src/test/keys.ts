import { act } from '@testing-library/react'

/**
 * 창 전체에 걸린 키 입력을 흉내낸다. 게임 훅들은 자기 화면이 아니라 `window`에
 * 키 처리를 걸어 두므로 검사도 같은 자리로 이벤트를 보내야 한다.
 */
export function pressKey(code: string, init: KeyboardEventInit = {}) {
  act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { code, ...init })))
}
