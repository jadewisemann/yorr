import { useEffect, useLayoutEffect, useRef } from 'react'
import type { GameKey, HeroScene } from '@/landing/rendering/heroScene'

interface HeroCanvasProps {
  game: GameKey
}

function shouldSkipHero() {
  if (typeof window.matchMedia === 'function') {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true
  }
  const connection = (navigator as { connection?: { saveData?: boolean } }).connection
  return connection?.saveData === true
}

function supportsWebGL() {
  if (typeof WebGLRenderingContext === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

export function HeroCanvas({ game }: HeroCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<HeroScene | null>(null)
  const latestGameRef = useRef(game)
  const pausedRef = useRef(false)

  useLayoutEffect(() => {
    latestGameRef.current = game
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container || shouldSkipHero() || !supportsWebGL()) return

    let disposed = false
    let created: HeroScene | null = null

    void import('@/landing/rendering/heroScene')
      .then(({ HeroScene: Scene }) => {
        if (disposed) return
        created = new Scene({ container, game: latestGameRef.current })
        created.setPaused(pausedRef.current)
        sceneRef.current = created
      })
      .catch(() => {})

    return () => {
      disposed = true
      created?.destroy()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => {
    const background = containerRef.current?.closest('main')
    if (!background) return

    const sync = () => {
      pausedRef.current = background.hasAttribute('inert')
      sceneRef.current?.setPaused(pausedRef.current)
    }

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(background, { attributeFilter: ['inert'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    sceneRef.current?.setGame(game)
  }, [game])

  return (
    <div aria-hidden="true" ref={containerRef} className="pointer-events-none absolute inset-0" />
  )
}
