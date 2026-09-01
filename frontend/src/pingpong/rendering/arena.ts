import * as THREE from 'three'
import {
  NET_H,
  NET_OVERHANG,
  TABLE_H,
  TABLE_LEN,
  TABLE_THICK,
  TABLE_W,
} from '@/pingpong/domain/court'
import { BELLY, CHEEK, EYE, FUR, type MatBag, NOSE } from './materials'
import { floorTexture, netTexture, tableTopTexture, wallTexture } from './textures'

/**
 * 만든 것을 그때그때 등록해 두는 가방. `createScene`이 넘기고, `dispose()`가 이
 * 목록만 보고 놓아 준다.
 */
export interface ResourceKeeper {
  geo<T extends THREE.BufferGeometry>(g: T): T
  mat<T extends THREE.Material>(m: T): T
  tex<T extends THREE.Texture>(t: T): T
}

/**
 * 판이 시작되기 전에 이미 놓여 있는 것들 — 조명·바닥·벽·탁구대·네트. 프레임마다
 * 움직이는 것(공·라켓·마스코트·카메라)과 나누어 두면, 장면 조립과 프레임 갱신이
 * 한 함수 안에서 섞이지 않는다.
 */
export function buildArena(scene: THREE.Scene, keep: ResourceKeeper): MatBag {
  const texTable = keep.tex(tableTopTexture())
  const texNet = keep.tex(netTexture())
  const texFloor = keep.tex(floorTexture())
  texFloor.wrapS = texFloor.wrapT = THREE.RepeatWrapping
  texFloor.repeat.set(3, 3)

  const mats: MatBag = {
    rubber: (color) =>
      keep.mat(new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.02 })),
    accent: (color) => keep.mat(new THREE.MeshStandardMaterial({ color, roughness: 0.6 })),
    wood: keep.mat(new THREE.MeshStandardMaterial({ color: 0xb98a55, roughness: 0.68 })),
    fur: keep.mat(new THREE.MeshStandardMaterial({ color: FUR, roughness: 0.78 })),
    belly: keep.mat(new THREE.MeshStandardMaterial({ color: BELLY, roughness: 0.82 })),
    nose: keep.mat(new THREE.MeshStandardMaterial({ color: NOSE, roughness: 0.5 })),
    cheek: keep.mat(new THREE.MeshStandardMaterial({ color: CHEEK, roughness: 0.85 })),
    eye: keep.mat(new THREE.MeshStandardMaterial({ color: EYE, roughness: 0.35 })),
    glint: keep.mat(new THREE.MeshStandardMaterial({ color: 0xfdfdf6, roughness: 0.4 })),
    geo: keep.geo,
  }

  scene.add(new THREE.HemisphereLight(0xa8c8ff, 0x0d141f, 0.62))
  const key = new THREE.DirectionalLight(0xffffff, 1.85)
  key.position.set(1.1, 3.4, 1.5)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x6ea8ff, 0.42)
  rim.position.set(-1.6, 1.4, -2.4)
  scene.add(rim)

  const floor = new THREE.Mesh(
    keep.geo(new THREE.PlaneGeometry(26, 26)),
    keep.mat(new THREE.MeshStandardMaterial({ map: texFloor, roughness: 0.94 })),
  )
  floor.rotation.x = -Math.PI / 2
  scene.add(floor)

  const texWall = keep.tex(wallTexture())
  const wallGeo = keep.geo(new THREE.PlaneGeometry(18, 7))
  const wallMat = keep.mat(new THREE.MeshBasicMaterial({ map: texWall, fog: true }))
  for (const sz of [-1, 1] as const) {
    const wall = new THREE.Mesh(wallGeo, wallMat)
    wall.position.set(0, 3.5, sz * 7)
    if (sz > 0) wall.rotation.y = Math.PI // 안쪽을 보게
    scene.add(wall)
  }

  const topSide = keep.mat(new THREE.MeshStandardMaterial({ color: 0x0d3f66, roughness: 0.6 }))
  const topFace = keep.mat(
    new THREE.MeshStandardMaterial({ map: texTable, roughness: 0.34, metalness: 0.04 }),
  )
  const tableTop = new THREE.Mesh(
    keep.geo(new THREE.BoxGeometry(TABLE_W, TABLE_THICK, TABLE_LEN)),
    [topSide, topSide, topFace, topSide, topSide, topSide],
  )
  tableTop.position.y = TABLE_H - TABLE_THICK / 2
  scene.add(tableTop)

  const legMat = keep.mat(
    new THREE.MeshStandardMaterial({ color: 0x161c27, roughness: 0.7, metalness: 0.25 }),
  )
  const legGeo = keep.geo(new THREE.BoxGeometry(0.06, TABLE_H - TABLE_THICK, 0.06))
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, legMat)
      leg.position.set(
        sx * (TABLE_W / 2 - 0.13),
        (TABLE_H - TABLE_THICK) / 2,
        sz * (TABLE_LEN / 2 - 0.2),
      )
      scene.add(leg)
    }
  const beamGeo = keep.geo(new THREE.BoxGeometry(TABLE_W - 0.3, 0.04, 0.04))
  for (const sz of [-1, 1]) {
    const beam = new THREE.Mesh(beamGeo, legMat)
    beam.position.set(0, 0.36, sz * (TABLE_LEN / 2 - 0.2))
    scene.add(beam)
  }

  const netW = TABLE_W + NET_OVERHANG * 2
  const net = new THREE.Mesh(
    keep.geo(new THREE.PlaneGeometry(netW, NET_H)),
    keep.mat(
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
  const postGeo = keep.geo(new THREE.CylinderGeometry(0.012, 0.012, NET_H + 0.03, 10))
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, legMat)
    post.position.set((sx * netW) / 2, TABLE_H + (NET_H + 0.03) / 2, 0)
    scene.add(post)
  }

  return mats
}
