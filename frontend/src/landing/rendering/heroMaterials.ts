import * as THREE from 'three'

/** 히어로 장면의 배색. 장면과 소품이 같은 값을 봐야 한 화면으로 읽힌다. */
export const IVORY = 0xf4f1e8
export const INK = 0x0b0b0c
export const ACCENT = 0xe53935
export const SLATE = 0x24252a

export function matte(color: number, options: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0, roughness: 0.55, ...options })
}
