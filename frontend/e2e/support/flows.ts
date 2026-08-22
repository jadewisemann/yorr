import { expect, type Page } from '@playwright/test'
import type { DiceSet } from './contract'
import { GUEST, HOST, player, playingSnapshot, ROOM_CODE, roundDeadline } from './contract'
import type { FakeGameServer } from './fakeGameServer'

const WIDE_GAME_LAYOUT_PX = 1024

export function isWideLayout(page: Page) {
  return (page.viewportSize()?.width ?? 0) >= WIDE_GAME_LAYOUT_PX
}

export const lobbyUrl = new RegExp(`/rooms/${ROOM_CODE}/lobby$`)
export const gameUrl = new RegExp(`/rooms/${ROOM_CODE}/game$`)

export async function useSimpleDiceRenderer(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
}

export function myTurnLabel(page: Page) {
  return page
    .locator('header')
    .getByText(/^내 턴/)
    .filter({ visible: true })
}

export function activeTurnLabel(page: Page, nickname: string) {
  return page
    .locator('header')
    .getByText(new RegExp(`^${nickname}(의 턴)?$`))
    .filter({ visible: true })
}

export async function createRoomAsHost(page: Page, nickname?: string) {
  await page.goto('/')
  await page.getByRole('button', { name: '요트 다이스 플레이' }).click()

  await page.getByRole('button', { name: /^방 만들기/ }).click()

  const field = page.getByRole('textbox', { name: '닉네임' })
  await expect(field).toBeVisible()
  const suggestion = (await field.getAttribute('placeholder')) ?? ''
  if (nickname !== undefined) await field.fill(nickname)

  await page.getByRole('button', { name: '대기실 입장' }).click()
  await expect(page).toHaveURL(lobbyUrl)
  await expect(page.getByRole('heading', { name: '대기실' })).toBeVisible()

  return { nickname: nickname ?? suggestion }
}

export async function joinRoomAsGuest(page: Page, nickname = GUEST.nickname, code = ROOM_CODE) {
  await page.goto(`/join?code=${code}`)
  await page.getByRole('textbox', { name: '닉네임' }).fill(nickname)
  await page.getByRole('button', { name: '대기실 입장' }).click()
  await expect(page).toHaveURL(lobbyUrl)
  await expect(page.getByRole('heading', { name: '대기실' })).toBeVisible()
  return { nickname }
}

export async function startHostedGame(
  page: Page,
  server: FakeGameServer,
  options: { turnOrder?: string[]; activePlayerId?: string } = {},
) {
  await page.getByRole('button', { name: '게임 시작', exact: true }).click()
  await expect(page).toHaveURL(gameUrl)

  const players = server.currentSnapshot()?.players ?? [player(HOST), player(GUEST)]
  const activePlayerId = options.activePlayerId ?? HOST.id
  const turnOrder = options.turnOrder ?? players.map((entry) => entry.playerId)

  server.setSnapshot(playingSnapshot({ players, activePlayerId, turnOrder }))
  server.send('game.yacht_dice.round.start', {
    roundNumber: 1,
    deadline: roundDeadline(),
    activePlayerId,
    turnOrder,
  })
}

export async function rollDice(page: Page, server: FakeGameServer, dice: DiceSet) {
  await page.getByRole('button', { name: /^굴리기/ }).click()
  await server.answerRoll(dice)

  await expect(page.getByRole('button', { name: `${dice[0]} 주사위 KEEP` }).first()).toBeVisible()
}

export async function recordCategory(page: Page, label: string, score: number) {
  if (!isWideLayout(page)) {
    const openSheet = page.getByRole('button', { name: '전체 시트' })
    if (await openSheet.isVisible()) await openSheet.click()
  }
  await page.getByRole('button', { name: `${label} ${score}`, exact: true }).click()
}
