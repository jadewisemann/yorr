import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import { useAppStore } from '@/store'
import {
  createTutorialClient,
  createTutorialSnapshot,
  tutorialSession,
} from '@/yacht/domain/tutorialGame'
import { GamePlay } from '@/yacht/screens/GamePlay'

export function ControllerLab() {
  const navigate = useNavigate()
  const setConnectionStatus = useAppStore((state) => state.setConnectionStatus)
  const [client] = useState(createTutorialClient)
  const [snapshot] = useState(createTutorialSnapshot)

  useEffect(() => {
    client.connect()
    setConnectionStatus('connected')
    return () => setConnectionStatus('idle')
  }, [client, setConnectionStatus])

  if (!import.meta.env.DEV) {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-content">
        개발 환경에서만 사용할 수 있습니다.
      </main>
    )
  }

  return (
    <RealtimeClientProvider client={client}>
      <GamePlay
        forceController
        onLeaveRequest={() => void navigate({ to: '/__dev/components' })}
        roomId={tutorialSession.roomId}
        session={tutorialSession}
        snapshot={snapshot}
      />
    </RealtimeClientProvider>
  )
}
