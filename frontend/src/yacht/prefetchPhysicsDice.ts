export function prefetchPhysicsDice() {
  void import('./rendering/physics-dice/loadWorld').then(({ prefetchPhysicsDiceWorld }) =>
    prefetchPhysicsDiceWorld(),
  )
}
