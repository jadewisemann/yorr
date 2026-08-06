import { useCallback, useEffect, useRef, useState } from 'react'
import { readSoundMuted, saveSoundMuted } from '@/shared/audio/soundPreference'
import { setSoundtrackMuted } from '@/shared/audio/soundtrack'
import type { DiceIndex } from '@/yacht/domain/dice'
import type { YachtCategory } from '@/yacht/domain/scoring'
import { MAX_ROLLS, type YachtGameAction } from '@/yacht/domain/yachtGame'

interface UseGamePlayChromeOptions {
  /** 현재 턴의 주인. 바뀌면 열어 둔 시트와 확인 모달을 접는다. */
  activePlayerId: string | undefined
  phase: 'choosing' | string
  rollCount: number
  submitted: boolean
  /** 주사위 굴림 효과음 음소거 — `useGamePlayRoll`이 소유하므로 콜백으로 받는다. */
  setRollMuted: (muted: boolean) => void
  /** 넓은 폭에서는 점수시트가 항상 보이므로 자동으로 열지 않는다. */
  wide: boolean
}

/**
 * 게임 화면의 크롬 상태 — 점수 시트, 0점 확인, 내 차례 콜아웃, 소리·오디오·도움말.
 *
 * 시트와 확인 모달은 턴·굴림에 얽혀 있어서 함께 둔다. 나머지 토글은 서로 독립이지만
 * 「이 화면이 들고 있는 UI 상태」라는 한 덩이라 같은 훅이 소유한다 — 화면은 값만 받아 그린다.
 */
export function useGamePlayChrome({
  activePlayerId,
  phase,
  rollCount,
  setRollMuted,
  submitted,
  wide,
}: UseGamePlayChromeOptions) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [zeroConfirm, setZeroConfirm] = useState<YachtCategory | null>(null)
  /** 내 차례 시작 콜아웃 — 토스트보다 눈에 띄는 족보 이펙트와 같은 연출. 값은 리마운트 키다. */
  const [turnCallout, setTurnCallout] = useState<number | null>(null)
  const [soundMuted, setSoundMuted] = useState(readSoundMuted)
  const [audioOpen, setAudioOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  /** 오디오 말풍선이 붙을 자리 — 헤더의 소리 버튼이다. */
  const audioButtonRef = useRef<HTMLButtonElement>(null)

  const activePlayerRef = useRef(activePlayerId)
  useEffect(() => {
    if (activePlayerRef.current === activePlayerId) return
    activePlayerRef.current = activePlayerId
    setZeroConfirm(null)
    // 남의 턴을 구경하며 열어둔 점수시트가 턴이 넘어간 뒤에도 남아있으면 안 된다(QA FND-5).
    setSheetOpen(false)
  }, [activePlayerId])

  // 마지막 굴림이 끝나면 족보 시트를 자동으로 연다(1d 인터랙션 명세).
  useEffect(() => {
    if (wide || submitted) return
    if (phase === 'choosing' && rollCount >= MAX_ROLLS) setSheetOpen(true)
  }, [phase, rollCount, submitted, wide])

  const closeSheet = useCallback(() => setSheetOpen(false), [])

  const toggleSound = () => {
    const muted = !soundMuted
    setSoundMuted(muted)
    saveSoundMuted(muted)
    setRollMuted(muted)
    setSoundtrackMuted(muted)
  }

  return {
    audioButtonRef,
    audioOpen,
    closeSheet,
    helpOpen,
    setAudioOpen,
    setHelpOpen,
    setSheetOpen,
    setTurnCallout,
    setZeroConfirm,
    sheetOpen,
    soundMuted,
    toggleSound,
    turnCallout,
    zeroConfirm,
  }
}

/** 웹 전용 단축키. 리스너를 매 렌더 다시 붙이지 않도록 최신 핸들러만 ref로 넘긴다. */
export function useShortcuts(
  enabled: boolean,
  handlers: {
    dispatch: (action: YachtGameAction) => void
    onRoll: () => void
  },
) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      // 버튼·입력처럼 Space·Enter가 고유 동작인 요소에 포커스가 있으면 단축키를 양보한다.
      // 여기서 preventDefault하면 그 요소의 활성화 자체가 막힌다.
      if (
        event.target instanceof Element &&
        event.target.closest(
          'a[href],button,input,select,textarea,[contenteditable],[role="button"]',
        )
      ) {
        return
      }
      if (event.code === 'Space') {
        event.preventDefault()
        handlersRef.current.onRoll()
        return
      }
      const slot = Number(event.key)
      if (Number.isInteger(slot) && slot >= 1 && slot <= 5) {
        handlersRef.current.dispatch({ type: 'holdToggled', index: (slot - 1) as DiceIndex })
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}

/**
 * 내 차례가 시작되는 순간 한 번 알린다(QA 7번). 턴이 넘어가면 다시 무장된다.
 * 렌더마다 발화하지 않도록 직전 값과 비교한다 — 상태가 아니라 "전이"가 트리거다.
 */
export function useMyTurnAlert({ isMyTurn, onAlert }: { isMyTurn: boolean; onAlert: () => void }) {
  const wasMyTurnRef = useRef(false)
  const onAlertRef = useRef(onAlert)
  onAlertRef.current = onAlert

  useEffect(() => {
    if (isMyTurn && !wasMyTurnRef.current) onAlertRef.current()
    wasMyTurnRef.current = isMyTurn
  }, [isMyTurn])
}

/**
 * 라운드가 바뀌는 순간 한 번 알린다(QA FND-7). 관전자에게도 전환 신호를 주되,
 * 턴마다 띄우면 피로하므로 라운드 시작으로 한정한다.
 */
export function useRoundStartNotice({
  onNotice,
  roundNumber,
}: {
  onNotice: () => void
  roundNumber: number
}) {
  const previousRoundRef = useRef<number | null>(null)
  const onNoticeRef = useRef(onNotice)
  onNoticeRef.current = onNotice

  useEffect(() => {
    const previous = previousRoundRef.current
    previousRoundRef.current = roundNumber
    // 첫 렌더(중간 입장·재접속 포함)는 "전환"이 아니다 — 라운드가 실제로 바뀔 때만 알린다.
    if (previous === null || previous === roundNumber) return
    onNoticeRef.current()
  }, [roundNumber])
}

/** 짧은 두 번 진동. 미지원(iOS Safari 등)이면 조용히 넘어간다 — 토스트가 이미 알린다. */
export function vibrateForMyTurn() {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate([90, 60, 90])
  } catch {
    // 사용자 제스처 없이 호출하면 던지는 브라우저가 있다. 알림 실패가 게임을 막아선 안 된다.
  }
}
