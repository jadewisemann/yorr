import RAPIER from '@dimforge/rapier3d-compat'
import { expect, it } from 'vitest'
import { PHYSICS_DICE_CONFIG } from './config'

/**
 * 중력·재질 값을 조정할 때(S15P11A406-94의 낙하 속도 상향 등) 주사위가 여전히 바닥에
 * 안착하는지 지키는 회귀 테스트. 값을 여기 복제하면 config를 바꿔도 통과해버리므로 config에서 읽는다.
 */
it('Rapier 강체가 현재 중력과 재질 설정에서 바닥에 안착한다', async () => {
  const { angularDamping, friction, gravity, linearDamping, restitution, simulationHz } =
    PHYSICS_DICE_CONFIG.defaults
  await RAPIER.init()
  const world = new RAPIER.World({ x: 0, y: -gravity, z: 0 })
  world.timestep = 1 / simulationHz
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(4, 0.1, 2).setTranslation(0, -0.1, 0).setFriction(0.8),
  )
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 3, 0)
      .setLinearDamping(linearDamping)
      .setAngularDamping(angularDamping),
  )
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.43, 0.43, 0.43).setRestitution(restitution).setFriction(friction),
    body,
  )
  body.setAngvel({ x: 8, y: 5, z: -7 }, true)

  for (let frame = 0; frame < 600; frame += 1) world.step()

  expect(body.translation().y).toBeGreaterThan(0.35)
  expect(body.translation().y).toBeLessThan(0.6)
  expect(Math.hypot(body.linvel().x, body.linvel().y, body.linvel().z)).toBeLessThan(0.05)
  world.free()
})
