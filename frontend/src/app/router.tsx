import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router'
import { normalizeRoomCode } from '@/roomCode'
import { EntryPage } from '@/screens/EntryPage'
import { GamePage } from '@/screens/GamePage'
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

const joinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/join',
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === 'string' ? normalizeRoomCode(search.code) : undefined,
  }),
  component: () => {
    const { code } = joinRoute.useSearch()
    return <NicknamePage roomCode={code} />
  },
})

const lobbyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rooms/$roomId/lobby',
  component: LobbyPage,
})

const gameRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rooms/$roomId/game',
  component: GamePage,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  joinRoute,
  lobbyRoute,
  gameRoute,
  devCatalogRoute,
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
