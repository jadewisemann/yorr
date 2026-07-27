import RAPIER from '@dimforge/rapier3d-compat'
import { expect, it } from 'vitest'

it('Rapier 강체가 원본 중력과 재질 설정에서 바닥에 안착한다', async () => {
  await RAPIER.init()
  const world = new RAPIER.World({ x: 0, y: -18, z: 0 })
  world.timestep = 1 / 60
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(4, 0.1, 2).setTranslation(0, -0.1, 0).setFriction(0.8),
  )
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 3, 0)
      .setLinearDamping(0.16)
      .setAngularDamping(0.2),
  )
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.43, 0.43, 0.43).setRestitution(0.34).setFriction(0.74),
    body,
  )
  body.setAngvel({ x: 8, y: 5, z: -7 }, true)

  for (let frame = 0; frame < 600; frame += 1) world.step()

  expect(body.translation().y).toBeGreaterThan(0.35)
  expect(body.translation().y).toBeLessThan(0.6)
  expect(Math.hypot(body.linvel().x, body.linvel().y, body.linvel().z)).toBeLessThan(0.05)
  world.free()
})
