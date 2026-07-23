import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router'
<<<<<<< HEAD
import { EntryPage } from '../features/entry/EntryPage'
=======
import { EntryPage } from '@/screens/EntryPage'
import { DevCatalog } from './DevCatalog'
>>>>>>> 96e7252d9d23d7d509ed4819e8180e49c884c7c8

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => <main>페이지를 찾을 수 없습니다.</main>,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: EntryPage,
})

<<<<<<< HEAD
const routeTree = rootRoute.addChildren([indexRoute])
=======
const devCatalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/__dev/components',
  component: DevCatalog,
})

const routeTree = rootRoute.addChildren([indexRoute, devCatalogRoute])
>>>>>>> 96e7252d9d23d7d509ed4819e8180e49c884c7c8

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
