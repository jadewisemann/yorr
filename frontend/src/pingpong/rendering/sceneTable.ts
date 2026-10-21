import * as THREE from 'three'
import {
  NET_H,
  NET_OVERHANG,
  TABLE_H,
  TABLE_LEN,
  TABLE_THICK,
  TABLE_W,
} from '@/pingpong/domain/court'

export interface TableDeps {
  readonly scene: THREE.Scene
  readonly keepG: <T extends THREE.BufferGeometry>(g: T) => T
  readonly keepM: <T extends THREE.Material>(m: T) => T
  readonly texTable: THREE.Texture
  readonly texNet: THREE.Texture
  readonly legMat: THREE.MeshStandardMaterial
}

/**
 * 탁구대·다리·네트 — 장면에서 가장 응집된 덩어리라 `createScene`에서 뺐다.
 *
 * 왜 분리했나: 이 블록은 좌표 상수(TABLE_*)만 읽고 애니메이션·입력과 무관하다.
 * `createScene`에 두면 "무엇이 매 프레임 움직이고 무엇이 한 번 만들어지는가"가
 * 섞여, 60줄짜리 정적 배치를 프레임 루프와 함께 읽게 된다.
 */
export function buildTable({ scene, keepG, keepM, texTable, texNet, legMat }: TableDeps): void {
  const topSide = keepM(new THREE.MeshStandardMaterial({ color: 0x0d3f66, roughness: 0.6 }))
  const topFace = keepM(
    new THREE.MeshStandardMaterial({ map: texTable, roughness: 0.34, metalness: 0.04 }),
  )
  const tableTop = new THREE.Mesh(keepG(new THREE.BoxGeometry(TABLE_W, TABLE_THICK, TABLE_LEN)), [
    topSide,
    topSide,
    topFace,
    topSide,
    topSide,
  ])
  tableTop.position.y = TABLE_H - TABLE_THICK / 2
  scene.add(tableTop)

  const legGeo = keepG(new THREE.BoxGeometry(0.06, TABLE_H - TABLE_THICK, 0.06))
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, legMat)
      leg.position.set(
        sx * (TABLE_W / 2 - 0.13),
        (TABLE_H - TABLE_THICK) / 2,
        sz * (TABLE_LEN / 2 - 0.2),
      )
      scene.add(leg)
    }
  }
  const beamGeo = keepG(new THREE.BoxGeometry(TABLE_W - 0.3, 0.04, 0.04))
  for (const sz of [-1, 1]) {
    const beam = new THREE.Mesh(beamGeo, legMat)
    beam.position.set(0, 0.36, sz * (TABLE_LEN / 2 - 0.2))
    scene.add(beam)
  }

  const netW = TABLE_W + NET_OVERHANG * 2
  const net = new THREE.Mesh(
    keepG(new THREE.PlaneGeometry(netW, NET_H)),
    keepM(
      new THREE.MeshBasicMaterial({
        map: texNet,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
  )
  net.position.set(0, TABLE_H + NET_H / 2, 0)
  scene.add(net)
  const postGeo = keepG(new THREE.CylinderGeometry(0.012, 0.012, NET_H + 0.03, 10))
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, legMat)
    post.position.set((sx * netW) / 2, TABLE_H + (NET_H + 0.03) / 2, 0)
    scene.add(post)
  }
}
