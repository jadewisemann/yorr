import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import { useAppStore } from '@/store'
import { TutorialGuide } from '@/yacht/components/TutorialGuide'
import {
  createTutorialClient,
  createTutorialSnapshot,
  tutorialSession,
} from '@/yacht/domain/tutorialGame'
import { GamePlay } from './GamePlay'

export function TutorialPage() {
  const navigate = useNavigate()
  const setConnectionStatus = useAppStore((state) => state.setConnectionStatus)
  const [client] = useState(createTutorialClient)
  const [snapshot] = useState(createTutorialSnapshot)

  useEffect(() => {
    client.connect()
    setConnectionStatus('connected')
    return () => setConnectionStatus('idle')
  }, [client, setConnectionStatus])

  const leave = () => {
    void navigate({ to: '/' })
  }

  return (
    <RealtimeClientProvider client={client}>
      <GamePlay
        guide={(progress) => <TutorialGuide {...progress} onClose={leave} />}
        onLeaveRequest={leave}
        roomId={tutorialSession.roomId}
        session={tutorialSession}
        snapshot={snapshot}
      />
    </RealtimeClientProvider>
  )
}
