import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  type RouterHistory,
  useRouterState,
} from '@tanstack/react-router'
import { motion, useReducedMotion } from 'motion/react'
import { lazy, Suspense, useEffect } from 'react'
import { pageVariants } from '@/motion'
import { getRoomCodeError, normalizeRoomCode } from '@/roomCode'
import { EntryPage } from '@/screens/EntryPage'
import { NotFoundPage } from '@/screens/NotFoundPage'
import { ScreenFallback } from './ScreenFallback'

/**
 * 랜딩과 404만 초기 청크에 남긴다.
 *
 * 링크·QR로 처음 들어온 사람이 랜딩 한 장을 보려고 GamePlay·주사위 트레이·점수시트까지
 * 전부 내려받고 있었다 — 첫 화면이 늦게 뜨는 가장 큰 원인이다. 방 안 화면들은 실제로
 * 그리로 갈 때 받는다. 로딩 표시는 아래 rootRoute의 Suspense 하나가 담당한다.
 */
const importAuthCallbackPage = () => import('@/screens/AuthCallbackPage')
const importGamePage = () => import('@/screens/GamePage')
const importInvalidInvitePage = () => import('@/screens/InvalidInvitePage')
const importLobbyPage = () => import('@/screens/LobbyPage')
const importNicknamePage = () => import('@/screens/NicknamePage')

const AuthCallbackPage = lazy(() =>
  importAuthCallbackPage().then((mod) => ({ default: mod.AuthCallbackPage })),
)
const GamePage = lazy(() => importGamePage().then((mod) => ({ default: mod.GamePage })))
const InvalidInvitePage = lazy(() =>
  importInvalidInvitePage().then((mod) => ({ default: mod.InvalidInvitePage })),
)
const LobbyPage = lazy(() => importLobbyPage().then((mod) => ({ default: mod.LobbyPage })))
const NicknamePage = lazy(() => importNicknamePage().then((mod) => ({ default: mod.NicknamePage })))

/**
 * 첫 화면이 그려진 뒤 남는 시간에 나머지 화면 청크를 미리 받아둔다.
 *
 * 코드 분리는 첫 로드를 지키려고 한 것이지, 이동할 때마다 로딩 표시를 보라는 뜻이 아니다.
 * 받아두지 않으면 화면을 옮길 때마다 `ScreenFallback`(전면 스피너)이 한두 프레임 스쳐
 * 전환이 깜빡인다. idle 콜백이라 초기 로드와 경쟁하지 않는다.
 */
function useScreenPrefetch() {
  useEffect(() => {
    const prefetch = () => {
      void importNicknamePage()
      void importLobbyPage()
      void importGamePage()
      void importInvalidInvitePage()
      void importAuthCallbackPage()
    }
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(prefetch, { timeout: 3000 })
      return () => cancelIdleCallback(id)
    }
    const id = setTimeout(prefetch, 2000)
    return () => clearTimeout(id)
  }, [])
}

/**
 * 화면 전환 껍데기. 경로가 바뀔 때만 새 껍데기를 만든다 — 검색 파라미터만 바뀌는 이동
 * (`/join?code=`)은 같은 화면이므로 전환을 걸지 않는다.
 *
 * <b>`AnimatePresence`를 쓰지 않는다 — 이게 깜빡임의 원인이었다.</b> 퇴장 애니메이션을
 * 그리려면 나가는 화면을 한동안 붙잡아 둬야 하는데, 그 사이 라우터 상태는 이미 바뀌어 있다.
 * 붙잡힌 트리 안의 `<Outlet/>`은 컨텍스트를 다시 읽어 <b>새 화면</b>을 그린다 — 결국 새
 * 화면이 한 번 사라졌다가 다시 나타난다. 지연 로드 화면이면 그 순간 suspend까지 겹쳐
 * 전면 스피너가 한 프레임 스친다.
 *
 * 그래서 퇴장은 그리지 않는다. 옛 화면은 한 커밋에 사라지고 새 화면이 오른쪽에서 밀려
 * 들어온다 — 앱의 push와 같은 방향이고 중간에 빈 프레임이 없다. 두 화면이 겹치지 않으니
 * 대기실과 게임의 WebGL 컨텍스트가 동시에 사는 일도 없다.
 */
function ScreenTransition() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const reduceMotion = useReducedMotion()
  useScreenPrefetch()

  const screen = (
    <Suspense fallback={<ScreenFallback />}>
      <Outlet />
    </Suspense>
  )

  if (reduceMotion) return screen

  return (
    <motion.div animate="visible" initial="hidden" key={pathname} variants={pageVariants}>
      {screen}
    </motion.div>
  )
}

const rootRoute = createRootRoute({
  component: ScreenTransition,
  notFoundComponent: NotFoundPage,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: EntryPage,
})

const devCatalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/__dev/components',
  component: lazyRouteComponent(() => import('./DevCatalog'), 'DevCatalog'),
})

// 배포에서 실기기로 센서를 튜닝하는 페이지라 DevCatalog와 달리 DEV 게이트를 두지 않는다.
const motionLabRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/__dev/motion',
  component: lazyRouteComponent(() => import('./MotionLab'), 'MotionLab'),
})

/** 카카오 로그인 콜백. 서버가 일회용 code(또는 실패 사유 error)를 붙여 여기로 돌려보낸다. */
const authCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/callback',
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === 'string' ? search.code : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  component: () => {
    const { code, error } = authCallbackRoute.useSearch()
    return <AuthCallbackPage code={code} error={error} />
  },
})

const joinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/join',
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === 'string' ? normalizeRoomCode(search.code) : undefined,
  }),
  component: () => {
    const { code } = joinRoute.useSearch()
    if (code !== undefined && getRoomCodeError(code)) {
      return <InvalidInvitePage initialCode={code} />
    }
    return <NicknamePage roomCode={code} />
  },
})

const lobbyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rooms/$roomId/lobby',
  component: () => {
    const { roomId } = lobbyRoute.useParams()
    return <LobbyPage roomId={roomId} />
  },
})

const gameRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rooms/$roomId/game',
  component: () => {
    const { roomId } = gameRoute.useParams()
    return <GamePage roomId={roomId} />
  },
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  authCallbackRoute,
  joinRoute,
  lobbyRoute,
  gameRoute,
  devCatalogRoute,
  motionLabRoute,
])

export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    ...(history ? { history } : {}),
  })
}

export const router = createAppRouter()

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
