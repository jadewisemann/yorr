import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  type RouterHistory,
  useRouterState,
} from '@tanstack/react-router'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { lazy, Suspense } from 'react'
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

/**
 * 화면 전환 껍데기. 경로가 바뀔 때만 새 껍데기를 만든다 — 검색 파라미터만 바뀌는 이동
 * (`/join?code=`)은 같은 화면이므로 전환을 걸지 않는다.
 *
 * <b>`Suspense`는 반드시 이 안쪽이다.</b> 바깥에 두면 지연 로드 화면으로 이동하는 순간
 * suspend가 트리 전체를 fallback으로 갈아치워 나가는 화면이 통째로 사라진다 —
 * `AnimatePresence`가 퇴장을 그릴 대상이 없어진다.
 *
 * `mode="wait"`인 이유는 연출 취향이 아니다. 두 화면이 겹치면 대기실과 게임의 WebGL
 * 컨텍스트·rapier 월드가 잠깐 동시에 살아난다. 먼저 완전히 내보내고 다음을 올린다.
 */
function ScreenTransition() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const reduceMotion = useReducedMotion()

  if (reduceMotion) {
    return (
      <Suspense fallback={<ScreenFallback />}>
        <Outlet />
      </Suspense>
    )
  }

  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        animate="visible"
        exit="exit"
        initial="hidden"
        key={pathname}
        variants={pageVariants}
      >
        <Suspense fallback={<ScreenFallback />}>
          <Outlet />
        </Suspense>
      </motion.div>
    </AnimatePresence>
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
