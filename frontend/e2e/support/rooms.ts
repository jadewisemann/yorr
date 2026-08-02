import { type APIRequestContext, expect, type Page } from '@playwright/test'

/**
 * real 모드 격리 원칙: 각 테스트는 자기 방을 새로 만들고 그 방 코드로만 상호작용한다.
 * 서버에 방 삭제 API 가 없으므로 방은 일회용으로 취급한다.
 */

/**
 * 닉네임 규칙(문자·숫자·공백, 12자 이하) 안에서 테스트 간 충돌을 피한다.
 * prefix 는 ASCII 만 — 프론트는 한글을 허용하지만 서버는 400 invalid_nickname 으로
 * 거부한다 (계약 불일치, .dev.md 측정 기록 참고).
 */
export function uniqueNickname(prefix: string) {
  return `${prefix} ${Math.random().toString(36).slice(2, 6)}`.slice(0, 12)
}

/** 랜딩 → 방 만들기 → 닉네임 입력 → 로비 진입. 로비 URL 의 방 코드를 돌려준다. */
export async function createRoom(page: Page, nickname: string) {
  await page.goto('/')
  await page.getByRole('button', { name: '요트 다이스 플레이' }).click()
  await page.getByRole('textbox', { name: '닉네임' }).fill(nickname)
  await page.getByRole('button', { name: '대기실 입장' }).click()

  await page.waitForURL(/\/rooms\/[^/]+\/lobby/)
  const roomCode = /\/rooms\/([^/]+)\/lobby/.exec(page.url())?.[1]
  if (!roomCode) throw new Error(`로비 URL 에서 방 코드를 읽지 못했습니다: ${page.url()}`)
  await expect(page.getByRole('heading', { name: '대기실' })).toBeVisible()
  return roomCode
}

/** 초대 링크 → 닉네임 입력 → 로비 진입. */
export async function joinRoom(page: Page, roomCode: string, nickname: string) {
  await page.goto(`/join?code=${roomCode}`)
  await page.getByRole('textbox', { name: '닉네임' }).fill(nickname)
  await page.getByRole('button', { name: '대기실 입장' }).click()
  await expect(page.getByRole('heading', { name: '대기실' })).toBeVisible()
}

/** UI 를 거치지 않고 참가자를 채울 때(정원 초과 등) 쓰는 REST 직행 헬퍼. preview proxy 를 탄다. */
export async function enterRoomViaApi(
  request: APIRequestContext,
  body: { nickname: string; room_id?: string },
) {
  const response = await request.post('/api/v1/rooms', { data: body })
  if (!response.ok()) {
    throw new Error(`방 참가 API 실패 (${response.status()}): ${await response.text()}`)
  }
  return (await response.json()) as { id: string; nickname: string; token: string; room_id: string }
}
