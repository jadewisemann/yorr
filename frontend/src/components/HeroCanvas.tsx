import { useEffect, useRef } from 'react'
import type { HeroGameKey, HeroScene } from '@/rendering/hero/heroScene'

interface HeroCanvasProps {
  game: HeroGameKey
}

/**
 * 3D를 아예 받지 않을 조건. 모션 감소 설정에서는 씬이 정지 프레임 한 장만 그리는데,
 * 그 한 장을 위해 three.js 521KB(gzip ~135KB)를 내려받을 이유가 없다.
 * 데이터 절약 모드도 같다 — 장식보다 방 코드 입력이 먼저 살아나야 한다.
 */
function shouldSkipHero() {
  if (typeof window.matchMedia === 'function') {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true
  }
  const connection = (navigator as { connection?: { saveData?: boolean } }).connection
  return connection?.saveData === true
}

function supportsWebGL() {
  // jsdom처럼 WebGL 자체가 없는 환경에서는 getContext를 건드리지 않고 바로 포기한다.
  if (typeof WebGLRenderingContext === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

/**
 * 랜딩 히어로의 3D 레이어. 순수 장식이라 초기 번들에 three.js를 싣지 않고 지연 로드하고,
 * WebGL을 못 쓰는 환경에서는 배경 그라디언트만 남긴 채 조용히 비운다.
 */
export function HeroCanvas({ game }: HeroCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<HeroScene | null>(null)
  const latestGameRef = useRef(game)

  latestGameRef.current = game

  useEffect(() => {
    const container = containerRef.current
    if (!container || shouldSkipHero() || !supportsWebGL()) return

    let disposed = false
    let created: HeroScene | null = null

    void import('@/rendering/hero/heroScene')
      .then(({ HeroScene: Scene }) => {
        if (disposed) return
        created = new Scene({ container, game: latestGameRef.current })
        sceneRef.current = created
      })
      .catch(() => {
        // 히어로 3D는 정보를 전달하지 않는다. 실패해도 랜딩은 그대로 동작한다.
      })

    return () => {
      disposed = true
      created?.destroy()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => {
    sceneRef.current?.setGame(game)
  }, [game])

  return <div ref={containerRef} className="absolute inset-0" />
}
