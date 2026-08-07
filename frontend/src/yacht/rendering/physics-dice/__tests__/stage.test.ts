import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSizedContainer, FakeWebGLRenderer } from '@/test/threeStubs'
import { createStage } from '@/yacht/rendering/physics-dice/stage'

vi.mock('three', async (importOriginal) => {
  const { threeWithFakeRenderer } = await import('@/test/threeStubs')
  return threeWithFakeRenderer(importOriginal)
})

afterEach(() => {
  FakeWebGLRenderer.reset()
  document.body.replaceChildren()
})

describe('createStage', () => {
  it('컨테이너를 채우는 캔버스를 붙인다 — 무대는 컨테이너 밖에 아무것도 만들지 않는다', () => {
    const { container } = createSizedContainer(800, 600)

    const stage = createStage(container)

    expect(container.children).toHaveLength(1)
    expect(container.firstElementChild).toBe(stage.renderer.domElement)
    expect(stage.renderer.domElement.className).toContain('touch-manipulation')
    expect(stage.renderer.domElement.className).toContain('h-full')
    expect(stage.renderer.domElement.className).toContain('w-full')
  })

  it('화면 아래쪽이 월드 +z인 위에서 내려다보는 직교 카메라를 만든다', () => {
    const { container } = createSizedContainer(800, 600)

    const { camera } = createStage(container)
    camera.updateMatrixWorld(true)

    expect(camera.position.y).toBeGreaterThan(0)
    expect(new THREE.Vector3(0, 0, 1).project(camera).y).toBeLessThan(0)
    expect(new THREE.Vector3(0, 0, -1).project(camera).y).toBeGreaterThan(0)
    expect(new THREE.Vector3(1, 0, 0).project(camera).x).toBeGreaterThan(0)
    expect(new THREE.Vector3(1, 3, 0).project(camera).x).toBeCloseTo(
      new THREE.Vector3(1, 0, 0).project(camera).x,
      6,
    )
  })

  it('그림자를 드리우는 조명은 key light 하나뿐이고 그림자 프러스텀이 판을 덮는다', () => {
    const { container } = createSizedContainer(800, 600)

    const { ambient, keyLight, scene } = createStage(container)

    expect(scene.children).toContain(ambient)
    expect(scene.children).toContain(keyLight)
    expect(ambient.castShadow).toBe(false)
    const shadowCamera = keyLight.shadow.camera
    expect(shadowCamera.left).toBeLessThanOrEqual(-6)
    expect(shadowCamera.right).toBeGreaterThanOrEqual(6)
    expect(shadowCamera.top).toBeGreaterThanOrEqual(5)
    expect(shadowCamera.bottom).toBeLessThanOrEqual(-5)
  })

  it('알파·톤매핑을 켠 렌더러를 요청한다 — 배경 위에 겹쳐 그리는 무대다', () => {
    const { container } = createSizedContainer(800, 600)

    createStage(container)
    const renderer = FakeWebGLRenderer.last

    expect(renderer?.parameters.alpha).toBe(true)
    expect(renderer?.parameters.antialias).toBe(true)
    expect(renderer?.outputColorSpace).toBe(THREE.SRGBColorSpace)
    expect(renderer?.toneMapping).toBe(THREE.ACESFilmicToneMapping)
  })
})
