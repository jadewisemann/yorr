import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router'
import { getRoomCodeError, normalizeRoomCode } from '@/roomCode'
import { EntryPage } from '@/screens/EntryPage'
import { GamePage } from '@/screens/GamePage'
import { InvalidInvitePage } from '@/screens/InvalidInvitePage'
import { LobbyPage } from '@/screens/LobbyPage'
import { NicknamePage } from '@/screens/NicknamePage'
import { DevCatalog } from './DevCatalog'

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => <main>페이지를 찾을 수 없습니다.</main>,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: EntryPage,
})

const devCatalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/__dev/components',
  component: DevCatalog,
})

// 배포에서 실기기로 센서를 튜닝하는 페이지라 DevCatalog와 달리 DEV 게이트를 두지 않는다.
const motionLabRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/__dev/motion',
  component: lazyRouteComponent(() => import('./MotionLab'), 'MotionLab'),
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
