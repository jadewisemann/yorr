import { useNavigate } from '@tanstack/react-router'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import { TutorialGuide } from '@/yacht/components/TutorialGuide'
import { tutorialSession } from '@/yacht/domain/tutorialGame'
import { useTutorialRoom } from '@/yacht/model/useTutorialRoom'
import { GamePlay } from './GamePlay'

export function TutorialPage() {
  const navigate = useNavigate()
  const { client, snapshot } = useTutorialRoom()

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
