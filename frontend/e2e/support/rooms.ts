import { type APIRequestContext, expect, type Page } from '@playwright/test'

export function uniqueNickname(prefix: string) {
  return `${prefix} ${Math.random().toString(36).slice(2, 6)}`.slice(0, 12)
}

export async function createRoom(page: Page, nickname: string) {
  await page.goto('/')
  await page.getByRole('button', { name: '요트 다이스 플레이' }).click()

  await page.getByRole('button', { name: /^방 만들기/ }).click()
  await page.getByRole('textbox', { name: '닉네임' }).fill(nickname)
  await page.getByRole('button', { name: '대기실 입장' }).click()

  await page.waitForURL(/\/rooms\/[^/]+\/lobby/)
  const roomCode = /\/rooms\/([^/]+)\/lobby/.exec(page.url())?.[1]
  if (!roomCode) throw new Error(`로비 URL 에서 방 코드를 읽지 못했습니다: ${page.url()}`)
  await expect(page.getByRole('heading', { name: '대기실' })).toBeVisible()
  return roomCode
}

export async function joinRoom(page: Page, roomCode: string, nickname: string) {
  await page.goto(`/join?code=${roomCode}`)
  await page.getByRole('textbox', { name: '닉네임' }).fill(nickname)
  await page.getByRole('button', { name: '대기실 입장' }).click()
  await expect(page.getByRole('heading', { name: '대기실' })).toBeVisible()
}

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
