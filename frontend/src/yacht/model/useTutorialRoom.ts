import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { createTutorialClient, createTutorialSnapshot } from '@/yacht/domain/tutorialGame'

/**
 * 연습 방 한 판을 세운다 — 대역 클라이언트를 붙이고 연결 상태를 `connected`로 올린다.
 * 튜토리얼 화면과 개발용 컨트롤러 실험실이 같은 판에서 출발한다.
 */
export function useTutorialRoom() {
  const setConnectionStatus = useAppStore((state) => state.setConnectionStatus)
  const [client] = useState(createTutorialClient)
  const [snapshot] = useState(createTutorialSnapshot)

  useEffect(() => {
    client.connect()
    setConnectionStatus('connected')
    return () => setConnectionStatus('idle')
  }, [client, setConnectionStatus])

  return { client, snapshot }
}
