import { expect, test } from '@playwright/test'
import { MEMBER } from '../support/contract'
import { mockRestApi } from '../support/restMock'

/**
 * 카카오 로그인 왕복. 실제 카카오 동의 화면은 열지 않는다 — /auth/kakao/authorize를
 * 서버가 돌려주는 결과(코드 또는 취소 사유)로 바로 리다이렉트해 그 이후만 검증한다.
 */

test('카카오 로그인에 성공하면 계정 정보가 남고, 로그아웃하면 다시 로그인 버튼으로 돌아간다', async ({
  page,
}) => {
  await mockRestApi(page)

  await page.goto('/')
  await page.getByRole('button', { name: '로그인' }).click()
  await page.getByRole('button', { name: '카카오로 계속하기' }).click()

  await expect(page).toHaveURL(/\/$/)
  // 성공 인사는 띄우지 않는다 — 헤더 아바타가 로그인 상태를 이미 말한다
  // (AuthCallbackPage 주석). 그래서 여기서 보는 것은 계정 버튼 하나다.
  await expect(page.getByRole('button', { name: MEMBER.nickname })).toBeVisible()

  await page.getByRole('button', { name: MEMBER.nickname }).click()
  await page.getByRole('button', { name: '로그아웃' }).click()

  await expect(page.getByRole('status')).toHaveText('로그아웃했어요.')
  await expect(page.getByRole('button', { name: '로그인' })).toBeVisible()
})

test('로그인을 취소하면 계정 상태를 바꾸지 않고 안내만 띄운다', async ({ page }) => {
  await mockRestApi(page, { kakaoLoginOutcome: 'canceled' })

  await page.goto('/')
  await page.getByRole('button', { name: '로그인' }).click()
  await page.getByRole('button', { name: '카카오로 계속하기' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('status')).toHaveText('로그인을 취소했어요.')
  await expect(page.getByRole('button', { name: '로그인' })).toBeVisible()
})

test('일회용 코드 교환이 실패하면 다시 시도하라는 안내를 띄운다', async ({ page }) => {
  await mockRestApi(page, {
    authExchangeFailure: { status: 401, body: 'invalid_login_code' },
  })

  await page.goto('/')
  await page.getByRole('button', { name: '로그인' }).click()
  await page.getByRole('button', { name: '카카오로 계속하기' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('status')).toHaveText(
    '로그인을 마무리하지 못했어요. 다시 시도해 주세요.',
  )
  await expect(page.getByRole('button', { name: '로그인' })).toBeVisible()
})
