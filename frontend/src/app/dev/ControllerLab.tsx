import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import { useAppStore } from '@/store'
import { GamePlay } from '@/yacht/screens/GamePlay'
import { createTutorialClient, createTutorialSnapshot, tutorialSession } from '@/yacht/tutorialGame'

/**
 * 파티 모드 컨트롤러를 <b>실제로 굴려 보는</b> 개발 화면(`/__dev/controller`).
 *
 * 정식 경로로 이 화면을 보려면 백엔드 · 대시보드 · 폰이 다 필요하다(대시보드가 방을 열고,
 * 그 QR로 들어온 폰만 컨트롤러가 된다). 그 셋을 세우지 않고도 손으로 만져 볼 수 있어야
 * 디자인을 고칠 수 있으므로, 연습 모드가 쓰는 <b>1인 가짜 서버</b>(`yacht/tutorialGame`)를
 * 그대로 꽂는다 — 굴리기·킵·기록·족보 연출이 전부 진짜로 돈다.
 *
 * 연습 안내(TutorialGuide)는 띄우지 않는다. 여기서 볼 것은 컨트롤러 레이아웃이고, 안내가
 * 화면을 덮으면 그것만 보인다.
 */
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
      {/* forceController: 자동 판단은 좁은 폭을 요구한다 — 데스크톱에서도 열리게 강제한다.
          실제 비율로 보려면 브라우저 기기 툴바로 폭을 390px로 줄이면 된다. */}
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
