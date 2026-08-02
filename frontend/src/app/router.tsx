import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
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
const AuthCallbackPage = lazy(() =>
  import('@/screens/AuthCallbackPage').then((mod) => ({ default: mod.AuthCallbackPage })),
)
const GamePage = lazy(() => import('@/screens/GamePage').then((mod) => ({ default: mod.GamePage })))
const InvalidInvitePage = lazy(() =>
  import('@/screens/InvalidInvitePage').then((mod) => ({ default: mod.InvalidInvitePage })),
)
const LobbyPage = lazy(() =>
  import('@/screens/LobbyPage').then((mod) => ({ default: mod.LobbyPage })),
)
const NicknamePage = lazy(() =>
  import('@/screens/NicknamePage').then((mod) => ({ default: mod.NicknamePage })),
)

const rootRoute = createRootRoute({
  component: () => (
    <Suspense fallback={<ScreenFallback />}>
      <Outlet />
    </Suspense>
  ),
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
