import { expect, type Page } from '@playwright/test'
import type { DiceSet } from './contract'
import { GUEST, HOST, player, playingSnapshot, ROOM_CODE, roundDeadline } from './contract'
import type { FakeGameServer } from './fakeGameServer'

/**
 * 여러 스펙이 공유하는 화면 조작. 셀렉터는 전부 역할(role) 기준이라
 * 760px(랜딩·대기실)·1024px(게임)에서 마크업이 갈려도 같은 코드로 통한다.
 */

/** 게임 화면이 점수시트를 우측 상시 패널로 승격하는 폭(GamePlay의 WIDE_LAYOUT). */
const WIDE_GAME_LAYOUT_PX = 1024

export function isWideLayout(page: Page) {
  return (page.viewportSize()?.width ?? 0) >= WIDE_GAME_LAYOUT_PX
}

export const lobbyUrl = new RegExp(`/rooms/${ROOM_CODE}/lobby$`)
export const gameUrl = new RegExp(`/rooms/${ROOM_CODE}/game$`)

/**
 * 주사위 트레이를 3D 물리 대신 2D 대체 화면으로 고정한다.
 *
 * PhysicsDiceScene은 prefers-reduced-motion으로 두 구현이 갈린다. 2D 쪽은 굴림 결과가
 * 다음 프레임에 확정되고 주사위마다 접근성 이름(`5 주사위 KEEP`)이 붙으므로,
 * 물리 시뮬레이션이 멈추는 시점에 의존하지 않는 결정적인 검증이 가능하다.
 * (파일 단위 test.use({ reducedMotion })는 Playwright 1.61에서 적용되지 않아 직접 호출한다.)
 */
export async function useSimpleDiceRenderer(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
}

/**
 * 헤더의 "내 턴" 표시.
 *
 * 문구를 그대로 찾지 않는 이유: 320px(지원 하한 기기)에서는 이 칸에 56px밖에 남지 않아
 * 「내 턴이에요」가 통째로 들어가지 않는다 — 그 폭에서만 「내 턴」으로 갈리고, 두 벌을 놓고
 * CSS가 하나를 감춘다(GamePlayHeader 주석 참고). 문구를 못 박아 두면 같은 스펙이 mobile-320
 * 프로젝트에서만 실패한다.
 */
export function myTurnLabel(page: Page) {
  return page
    .locator('header')
    .getByText(/^내 턴/)
    .filter({ visible: true })
}

/** 헤더의 "OO의 턴" 표시. 320px에서는 닉네임만 남는다({@link myTurnLabel}과 같은 이유). */
export function activeTurnLabel(page: Page, nickname: string) {
  return page
    .locator('header')
    .getByText(new RegExp(`^${nickname}(의 턴)?$`))
    .filter({ visible: true })
}

/** 랜딩 → 모드 선택 → 방 만들기 → 닉네임 → 대기실. 닉네임을 비우면 제안 닉네임으로 입장한다. */
export async function createRoomAsHost(page: Page, nickname?: string) {
  await page.goto('/')
  await page.getByRole('button', { name: '요트 다이스 플레이' }).click()

  // 플레이는 곧바로 방을 만들지 않는다 — 친구와 할지(방 만들기) 모르는 사람과 할지(온라인
  // 대전)부터 고르는 모드 모달이 선다(EntryPage.handlePlay). 두 버튼 모두 설명 줄을 품어
  // 접근성 이름이 "방 만들기 초대 링크를 …"이므로 앞머리로만 맞춘다.
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

/** 초대 링크 → 닉네임 → 대기실(참가자). */
export async function joinRoomAsGuest(page: Page, nickname = GUEST.nickname, code = ROOM_CODE) {
  await page.goto(`/join?code=${code}`)
  await page.getByRole('textbox', { name: '닉네임' }).fill(nickname)
  await page.getByRole('button', { name: '대기실 입장' }).click()
  await expect(page).toHaveURL(lobbyUrl)
  await expect(page.getByRole('heading', { name: '대기실' })).toBeVisible()
  return { nickname }
}

/** 호스트가 게임을 시작하고, 서버가 첫 라운드를 알린 직후까지. */
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

  // 서버도 이 순간부터 "진행 중인 방"으로 답해야 한다 — 재접속 때 room.joined가 실어 보내는
  // 스냅샷이 대기 상태로 남아 있으면 재연결만으로 화면이 대기실로 되돌아간다.
  server.setSnapshot(playingSnapshot({ players, activePlayerId, turnOrder }))
  server.send('game.yacht_dice.round.start', {
    roundNumber: 1,
    deadline: roundDeadline(),
    activePlayerId,
    turnOrder,
  })
}

/** 굴리기 → 서버가 확정한 눈으로 dice.broadcast → 굴림 연출 종료까지 기다린다. */
export async function rollDice(page: Page, server: FakeGameServer, dice: DiceSet) {
  await page.getByRole('button', { name: /^굴리기/ }).click()
  await server.answerRoll(dice)
  // 굴림이 끝나면 트레이의 주사위가 KEEP 토글 가능한 확정값으로 바뀐다.
  await expect(page.getByRole('button', { name: `${dice[0]} 주사위 KEEP` }).first()).toBeVisible()
}

/**
 * 족보 기록. 좁은 화면은 기록 패널을 먼저 열어야 점수표 행이 보인다 —
 * 열고 나면 행 셀렉터는 넓은 화면과 완전히 같다.
 */
export async function recordCategory(page: Page, label: string, score: number) {
  if (!isWideLayout(page)) {
    const openSheet = page.getByRole('button', { name: '전체 시트' })
    if (await openSheet.isVisible()) await openSheet.click()
  }
  await page.getByRole('button', { name: `${label} ${score}`, exact: true }).click()
}
