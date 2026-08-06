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

/**
 * 연습 모드(S15P11A406-143). 실전이 아니라 게임을 이해하기 위한 화면이지만, 보여주는 것은
 * 진짜 플레이 화면 그대로다 — 연습용 화면을 따로 그리면 여기서 익힌 조작이 실전에서 한 번 더
 * 낯설어진다. 서버 자리에만 tutorialGame의 1인 가짜 서버가 들어간다.
 *
 * 방도 상대도 마감도 없다. 아무 때나 나갈 수 있고, 나갔다 들어오면 새 판이다.
 */
export function TutorialPage() {
  const navigate = useNavigate()
  const setConnectionStatus = useAppStore((state) => state.setConnectionStatus)
  // 클라이언트와 스냅샷은 이 화면의 수명과 같다. 렌더마다 새로 만들면 굴릴 때마다 판이 초기화된다.
  const [client] = useState(createTutorialClient)
  const [snapshot] = useState(createTutorialSnapshot)

  /*
   * GamePlay는 연결 상태를 스토어에서 읽어 조작을 잠근다(재연결 중 오조작 방지). 연습에는
   * 연결이랄 게 없으므로 들어올 때 연결됨으로 두고, 나갈 때 되돌린다 — 남겨 두면 실전 화면이
   * 끊긴 소켓을 연결됨으로 착각한다.
   */
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
