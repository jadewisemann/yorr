import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router'
import { ComponentCatalogPage } from '../features/catalog/ComponentCatalogPage'
import { EntryPage } from '../features/entry/EntryPage'

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => <main>페이지를 찾을 수 없습니다.</main>,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: EntryPage,
})

const componentCatalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/__dev/components',
  component: ComponentCatalogPage,
})

const routeTree = rootRoute.addChildren([indexRoute, componentCatalogRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
