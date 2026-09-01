import type * as THREE from 'three'

/** 마스코트 배색. 장면과 마스코트 양쪽이 참조한다. */
export const FUR = 0xf4ce5e // 버터
export const BELLY = 0xfbe7a8
export const NOSE = 0x6b4a2b
export const CHEEK = 0xf0a98c
export const EYE = 0x241c14

/**
 * 재료·지오메트리 가방. 생성물을 만든 자리에서 바로 등록해 두었다가 `dispose()`에서
 * 한 번에 놓아 준다 — 부품마다 정리 책임을 나눠 가지면 새 부품이 늘 때마다 누수가 난다.
 */
export interface MatBag {
  rubber(color: number): THREE.Material
  accent(color: number): THREE.Material
  wood: THREE.Material
  fur: THREE.Material
  belly: THREE.Material
  nose: THREE.Material
  cheek: THREE.Material
  eye: THREE.Material
  glint: THREE.Material
  geo<T extends THREE.BufferGeometry>(g: T): T
}
