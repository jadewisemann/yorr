import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router'
import { EntryPage } from '@/screens/EntryPage'
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

const routeTree = rootRoute.addChildren([indexRoute, devCatalogRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
