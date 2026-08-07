import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router'
import { lazy, Suspense, useEffect } from 'react'
import { isGameKey, isPartyGameKey } from '@/games'
import { EntryPage } from '@/landing/screens/EntryPage'
import { QuickMatchOverlay } from '@/room/components/QuickMatchOverlay'
import { getRoomCodeError, normalizeRoomCode } from '@/room/domain/roomCode'
import { useMediaQuery } from '@/shared/useMediaQuery'
import { NotFoundPage } from './NotFoundPage'
import { ScreenFallback } from './ScreenFallback'

const importAuthCallbackPage = () => import('@/auth/screens/AuthCallbackPage')
const importGamePage = () => import('@/room/screens/GamePage')
const importInvalidInvitePage = () => import('@/room/screens/InvalidInvitePage')
const importLobbyPage = () => import('@/room/screens/LobbyPage')
const importNicknamePage = () => import('@/room/screens/NicknamePage')
const importPartyDashboardPage = () => import('@/room/screens/PartyDashboardPage')
const importPartyOnBigScreenPage = () => import('@/room/screens/PartyOnBigScreenPage')
const importPingPongModePage = () => import('@/pingpong/screens/PingPongModePage')

const AuthCallbackPage = lazy(() =>
  importAuthCallbackPage().then((mod) => ({ default: mod.AuthCallbackPage })),
)
const GamePage = lazy(() => importGamePage().then((mod) => ({ default: mod.GamePage })))
const InvalidInvitePage = lazy(() =>
  importInvalidInvitePage().then((mod) => ({ default: mod.InvalidInvitePage })),
)
const LobbyPage = lazy(() => importLobbyPage().then((mod) => ({ default: mod.LobbyPage })))
const NicknamePage = lazy(() => importNicknamePage().then((mod) => ({ default: mod.NicknamePage })))
const PartyDashboardPage = lazy(() =>
  importPartyDashboardPage().then((mod) => ({ default: mod.PartyDashboardPage })),
)
const PartyOnBigScreenPage = lazy(() =>
  importPartyOnBigScreenPage().then((mod) => ({ default: mod.PartyOnBigScreenPage })),
)
const PingPongModePage = lazy(() =>
  importPingPongModePage().then((mod) => ({ default: mod.PingPongModePage })),
)

function useScreenPrefetch() {
  useEffect(() => {
    const prefetch = () => {
      void importNicknamePage()
      void importLobbyPage()
      void importGamePage()
      void importInvalidInvitePage()
      void importAuthCallbackPage()
      void importPingPongModePage()
    }
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(prefetch, { timeout: 3000 })
      return () => cancelIdleCallback(id)
    }
    const id = setTimeout(prefetch, 2000)
    return () => clearTimeout(id)
  }, [])
}

function ScreenTransition() {
  useScreenPrefetch()

  return (
    <>
      <Suspense fallback={<ScreenFallback />}>
        <Outlet />
      </Suspense>
      <QuickMatchOverlay />
    </>
  )
}

const rootRoute = createRootRoute({
  component: ScreenTransition,
  notFoundComponent: NotFoundPage,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: (search: Record<string, unknown>) => ({
    ...(isGameKey(search.game) ? { game: search.game } : {}),
  }),
  component: () => {
    const { game } = indexRoute.useSearch()
    return <EntryPage gameKey={game} />
  },
})

const devCatalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/__dev/components',
  component: lazyRouteComponent(() => import('@/app/dev/DevCatalog'), 'DevCatalog'),
})

const controllerLabRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/__dev/controller',
  component: lazyRouteComponent(() => import('@/app/dev/ControllerLab'), 'ControllerLab'),
})

const motionLabRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/__dev/motion',
  component: lazyRouteComponent(() => import('@/app/dev/MotionLab'), 'MotionLab'),
})

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

const tutorialRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tutorial',
  component: lazyRouteComponent(() => import('@/yacht/screens/TutorialPage'), 'TutorialPage'),
})

const leverageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/leverage',
  component: lazyRouteComponent(() => import('@/yacht/screens/LeveragePage'), 'LeveragePage'),
})

const pingPongRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pingpong',
  component: PingPongModePage,
})

const joinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/join',
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === 'string' ? normalizeRoomCode(search.code) : undefined,
    game: isGameKey(search.game) ? search.game : undefined,
    ...(search.party === '1' ? { party: true as const } : {}),
    ...(search.mode === 'quick' ? { mode: 'quick' as const } : {}),
  }),
  component: () => {
    const { code, game, mode, party } = joinRoute.useSearch()
    if (code !== undefined && getRoomCodeError(code)) {
      return <InvalidInvitePage initialCode={code} />
    }
    return <NicknamePage gameKey={game} mode={mode} party={party} roomCode={code} />
  },
})

const partyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/party',
  validateSearch: (search: Record<string, unknown>) => ({
    game: isPartyGameKey(search.game) ? search.game : ('yacht' as const),
  }),
  component: () => {
    const { game } = partyRoute.useSearch()
    const wide = useMediaQuery('(min-width: 760px)')
    return wide ? <PartyDashboardPage gameKey={game} /> : <PartyOnBigScreenPage gameKey={game} />
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
  tutorialRoute,
  leverageRoute,
  pingPongRoute,
  authCallbackRoute,
  joinRoute,
  partyRoute,
  lobbyRoute,
  gameRoute,
  devCatalogRoute,
  controllerLabRoute,
  motionLabRoute,
])

export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    defaultViewTransition: true,
    ...(history ? { history } : {}),
  })
}

export const router = createAppRouter()

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
