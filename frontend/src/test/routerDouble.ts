import { vi } from 'vitest'

/**
 * 화면 검사가 공유하는 이동 대역.
 *
 * 화면 하나만 떼어 보는 검사는 라우터를 세우지 않는다. 대신 "어디로 보내려
 * 했는가"만 보면 되므로 `useNavigate`를 이 spy로 바꿔 끼우고, 방 이탈을 막는
 * `useBlocker`는 늘 열린 상태로 둔다 — 가로채기 자체는 `RoomExitGuard` 검사가
 * 진짜 라우터로 따로 본다. 검사마다 상태가
 * 남지 않도록 각 파일의 `beforeEach`에서 `navigateSpy.mockReset()`을 부른다.
 *
 * 쓰는 쪽은 `vi.mock`이 호이스팅되는 것을 감안해 동적 import로 끼운다:
 *
 * ```ts
 * vi.mock('@tanstack/react-router', async () =>
 *   (await import('@/test/routerDouble')).routerWithNavigateSpy(),
 * )
 * ```
 */
export const navigateSpy = vi.fn()

export async function routerWithNavigateSpy() {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')
  return { ...actual, useBlocker: () => ({ status: 'idle' }), useNavigate: () => navigateSpy }
}
