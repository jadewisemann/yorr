export const loadPhysicsDiceWorld = () => import('./World')

export function prefetchPhysicsDiceWorld() {
  void loadPhysicsDiceWorld().catch(() => undefined)
}
