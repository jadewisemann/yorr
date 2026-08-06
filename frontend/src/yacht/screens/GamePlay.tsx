import type { ReactNode } from 'react'
import { useVoice } from '@/realtime/voice/VoiceContext'
import type { RoomSnapshot } from '@/realtime/wsEvents'
import { isPartyRoom } from '@/room/partyControllerStorage'
import { AudioPopover } from '@/shared/components/AudioPopover'
import { ToastHost, useToast } from '@/shared/components/ToastHost'
import { useWideLayout } from '@/shared/useWideLayout'
import { type ActiveRoomSession, useAppStore } from '@/store'
import { GameHelpModal } from '@/yacht/components/GameHelpModal'
import { GamePlayActions } from '@/yacht/components/GamePlay/GamePlayActions'
import { GamePlayBoard } from '@/yacht/components/GamePlay/GamePlayBoard'
import { QuickCategoryStrip } from '@/yacht/components/GamePlay/QuickCategoryStrip'
import { ZeroScoreModal } from '@/yacht/components/GamePlay/ZeroScoreModal'
import { ScoreSheet } from '@/yacht/components/ScoreSheet'
import { TurnStrip } from '@/yacht/components/TurnStrip'
import { applyLeverage } from '@/yacht/domain/leverage'
import {
  type CategoryScores,
  calculateScoreCandidates,
  YACHT_CATEGORIES,
  type YachtCategory,
} from '@/yacht/domain/scoring'
import { isRecorded } from '@/yacht/domain/yachtCategoryView'
import { canOfferMotion } from '@/yacht/input/motionTypes'
import { scoreLeaderLabel, scoreRecordTitle, scoreSheetHint } from '@/yacht/model/gamePlayLabels'
import { toMatrixPlayers, toTurnStripPlayers } from '@/yacht/model/gamePlayModel'
import { useCountdown } from '@/yacht/model/useCountdown'
import {
  useGamePlayChrome,
  useMyTurnAlert,
  useRoundStartNotice,
  useShortcuts,
  vibrateForMyTurn,
} from '@/yacht/model/useGamePlayChrome'
import { useGamePlayRoll } from '@/yacht/model/useGamePlayRoll'
import { useGamePlaySubmission } from '@/yacht/model/useGamePlaySubmission'
import { GameControllerPad } from './GameController'
import { GameDiceTray } from './GameDiceTray'
import { GamePlayHeader } from './GamePlayHeader'

/** 이 폭부터 점수표를 시트 대신 좌측 상시 패널로 승격한다(와이어프레임 1c). */
interface GamePlayProps {
  roomId: string
  session: ActiveRoomSession
  snapshot: RoomSnapshot
  /** 헤더의 '나가기'가 눌리면 부모(GamePage)가 확인 모달을 연다. */
  onLeaveRequest: () => void
  /**
   * 연습 모드의 안내 띠. 트레이 **밖**, 주사위와 CTA 사이에 흐름대로 들어간다 —
   * 트레이 위에 얹으면 배우는 내내 주사위나 킵 레일을 가린다(S15P11A406-143).
   *
   * 진행 상태를 인자로 받는다. 안내가 따로 세면 화면과 어긋나므로 굴림·킵·기록의
   * 유일한 출처인 여기서 그대로 넘긴다.
   */
  guide?: (progress: TurnProgress) => ReactNode
  /**
   * 레버리지 모드(S15P11A406-208)가 이번 턴에 2배를 건 족보. 일반 모드는 넘기지 않는다 —
   * 넘기지 않으면 이 화면은 종전과 완전히 같다.
   *
   * 점수를 확정하는 것은 여기가 아니다(서버·로컬 서버 몫). 이 값은 미리보기 숫자와
   * 하이라이트에만 쓴다.
   */
  leverageCategory?: YachtCategory | null
  /**
   * 컨트롤러 화면을 강제로 켠다. 평소에는 아래 `controller`가 스스로 판단하므로 넘기지 않는다 —
   * 개발용 화면(`/__dev/controller`)이 데스크톱에서도 이 화면을 열어 보려고 쓴다(자동 판단은
   * 좁은 폭을 요구한다).
   */
  forceController?: boolean
}

/** 안내가 다음 단계로 넘어갈 근거. GamePlay가 이미 들고 있는 값을 그대로 준다. */
export interface TurnProgress {
  /** 이번 턴에 주사위가 깔렸는지(첫 굴림 완료). */
  rolled: boolean
  /**
   * 지금 킵되어 있는 주사위의 눈. 개수가 아니라 값까지 주는 이유는 연습 모드가
   * "6 두 개를 킵하세요"처럼 무엇을 킵했는지까지 보고 다음으로 넘어가야 하기 때문이다.
   */
  keptValues: number[]
  /**
   * 주사위가 날아가는 중인지. rollCount는 굴림이 **시작될 때** 서버 값으로 올라가고 dice는
   * 애니메이션이 끝나야 바뀐다 — 그 사이에 안내가 "새 굴림 수 + 옛 주사위"를 읽으면
   * 아직 일어나지 않은 선택이 끝난 것처럼 보인다.
   */
  rolling: boolean
  /** 이번 턴 기록까지 끝났는지. */
  submitted: boolean
  /** 서버가 확정한 굴림 횟수. */
  rollCount: number
  /** 지금 주사위로 각 족보가 몇 점인지 — 족보 설명을 실제 눈과 함께 보여줄 때 쓴다. */
  candidates: CategoryScores
  /**
   * 모션 센서를 켤 수 있는 기기인지. 센서가 없는 기기(데스크톱 등)에서는 켤 것이 없으므로
   * 연습 모드가 흔들기 단계를 통째로 건너뛰는 근거가 된다.
   */
  motionNoticeVisible: boolean
  /**
   * 넓은 레이아웃인지. 점수표가 우측 상시 패널이냐 아래 기록 패널이냐가 갈리므로
   * 안내 문구도 갈라야 한다 — "오른쪽 점수표"와 "아래 기록 패널"은 다른 화면이다.
   */
  wide: boolean
}

export function GamePlay({
  forceController = false,
  guide,
  leverageCategory = null,
  onLeaveRequest,
  roomId,
  session,
  snapshot,
}: GamePlayProps) {
  const wide = useWideLayout()
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const { message: toastMessage, showToast } = useToast()
  // 통화 자체는 라우터 위 VoiceProvider가 들고 있다 — 대기실에서 켠 통화가 여기로 이어진다.
  const voice = useVoice()

  const game = snapshot.game
  const roundNumber = game?.roundNumber ?? 1
  const activePlayerId = game?.activePlayerId
  const isMyTurn = activePlayerId === session.you
  const activePlayer = snapshot.players.find((player) => player.playerId === activePlayerId)
  const remainingMs = useCountdown(game?.roundDeadline ?? null)
  const myBoard = game?.scores[session.you]
  const activeBoard = activePlayerId ? game?.scores[activePlayerId] : undefined

  // 파티 모드 대시보드는 플레이어가 아니다 — 이 화면은 게임을 비추기만 하므로 센서도
  // 조작 안내도 필요 없다(서버 턴 순서에 없어 isMyTurn도 영구히 false다).
  const canPlay = session.membershipRole !== 'dashboard'

  /*
   * 파티 모드 QR로 들어온 폰은 컨트롤러로 뜬다 — 트레이·점수표는 큰 화면이 맡는다.
   * 넓은 화면에서는 켜지 않는다: 그 폭으로 대시보드 옆에 선 노트북이라면 게임판을 보는 것이
   * 이상하지 않고, 손에 쥔 기기가 아니면 컨트롤러 은유 자체가 성립하지 않는다.
   */
  const controller = forceController || (!wide && canPlay && isPartyRoom(session.roomCode))

  const roll = useGamePlayRoll({
    canPlay,
    game,
    roomId,
    showToast,
    you: session.you,
  })
  const {
    canHold,
    canPick,
    canRoll,
    dispatch,
    keptCount,
    local,
    releaseAll,
    roll: handleRoll,
    rolling,
    submitted,
    submitting,
  } = roll

  const {
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
  } = useGamePlayChrome({
    activePlayerId,
    phase: local.phase,
    rollCount: local.rollCount,
    setRollMuted: roll.feedback.setMuted,
    submitted,
    wide,
  })
  const { submitCategory } = useGamePlaySubmission({
    activePlayerId,
    dice: local.dice,
    dispatch,
    myBoard,
    onSucceeded: closeSheet,
    roomId,
    roundNumber,
    showToast,
    you: session.you,
  })

  const usedCategories = YACHT_CATEGORIES.filter((category) =>
    isRecorded(activeBoard?.categories[category]),
  )
  // 레버리지 족보는 미리보기부터 2배로 보여야 한다 — 기록하고 나서야 2배인 걸 알면 고를 수 없다.
  const candidates: CategoryScores = local.dice
    ? applyLeverage(calculateScoreCandidates(local.dice, usedCategories), leverageCategory)
    : {}
  const rolled = local.dice !== null

  // 디자인의 한 장 점수시트 — 모든 플레이어를 열로 눕힌다. 내 열이 항상 첫 번째다.
  const sheetPlayers = toMatrixPlayers(snapshot.players, game?.scores, session.you)
  const leaderLabel = scoreLeaderLabel(sheetPlayers)

  // 점수표 행·퀵 칩 공용 원큐 기록. 0점만 잃는 선택이라 확인 모달을 거친다.
  const pickCategory = (category: YachtCategory) => {
    if (!canPick) return
    if ((candidates[category] ?? 0) === 0) {
      setZeroConfirm(category)
      return
    }
    submitCategory(category)
  }

  useMyTurnAlert({
    isMyTurn: isMyTurn && !submitted,
    onAlert: () => {
      // 하단 토스트는 시선 밖이라 놓치기 쉽다 — 족보 이펙트와 같은 대형 콜아웃으로 알린다.
      setTurnCallout(Date.now())
      vibrateForMyTurn()
    },
  })

  useRoundStartNotice({
    roundNumber,
    onNotice: () => {
      // 내 턴 시작은 useMyTurnAlert가 이미 알린다 — 여기선 관전 중일 때만 띄운다.
      if (isMyTurn || !activePlayer) return
      showToast(`라운드 ${roundNumber} 시작 — ${activePlayer.nickname}의 턴이에요`)
    },
  })

  useShortcuts(wide && isMyTurn, { onRoll: handleRoll, dispatch })

  // 상단 진행 표시 — 서버가 준 턴 순서 그대로다(명단 순서는 턴 순서가 아니다).
  const turnPlayers = toTurnStripPlayers(snapshot.players, game?.turnOrder, game?.scores)
  const turnStrip = (
    <TurnStrip
      activePlayerId={activePlayerId}
      players={turnPlayers}
      // 말하는 사람은 "누구 차례인가"를 보러 가는 자리에서 같이 읽힌다 — 별도 목록을 만들지 않는다.
      voice={voice}
      you={session.you}
    />
  )

  const diceScene = controller ? (
    // 컨트롤러는 "내 차례!" 콜아웃을 그리지 않는다(진동으로 이미 알린다) — turnCallout 상태는
    // 트레이 경로에서만 소비된다. 둘이 같이 뜨는 화면은 없다.
    <GameControllerPad activePlayer={activePlayer} isMyTurn={isMyTurn} roll={roll} />
  ) : (
    <GameDiceTray
      activePlayer={activePlayer}
      guided={guide !== undefined}
      isMyTurn={isMyTurn}
      onTurnCalloutDone={() => setTurnCallout(null)}
      roll={roll}
      roundNumber={roundNumber}
      turnCallout={turnCallout}
      wide={wide}
    />
  )

  const header = (
    <GamePlayHeader
      activePlayer={activePlayer}
      activePlayerId={activePlayerId}
      connectionStatus={connectionStatus}
      isMyTurn={isMyTurn}
      leaderLabel={leaderLabel}
      onHelp={() => setHelpOpen(true)}
      onLeave={onLeaveRequest}
      audioButtonRef={audioButtonRef}
      // 소리 버튼은 이제 토글이 아니라 오디오 말풍선을 연다 — 마이크·배경음·효과음이 한 자리다.
      onOpenAudio={() => setAudioOpen(true)}
      remainingMs={remainingMs}
      roundNumber={roundNumber}
      soundMuted={soundMuted}
      submitted={submitted}
      voice={voice}
      wide={wide}
    />
  )

  const zeroModal = (
    <ZeroScoreModal
      category={zeroConfirm}
      onCancel={() => setZeroConfirm(null)}
      onConfirm={() => {
        const category = zeroConfirm
        setZeroConfirm(null)
        if (category) submitCategory(category)
      }}
    />
  )

  // 디자인의 quick chips — 열린 족보를 고정 순서로 눕히고 탭 한 번에 기록한다.
  const openCategories = YACHT_CATEGORIES.filter(
    (category) => !isRecorded(activeBoard?.categories[category]),
  )

  const quickStrip = (
    <QuickCategoryStrip
      canPick={canPick}
      candidates={candidates}
      categories={openCategories}
      leverageCategory={leverageCategory}
      onPick={pickCategory}
      rolled={rolled}
    />
  )

  // 킵 레일을 통째로 비우는 보조 동작(디자인 Yacht Play 3D의 Release all).
  const canReleaseAll = keptCount > 0 && canHold

  // 기록은 점수표·칩 탭으로 끝나므로 CTA는 굴리기 하나다(디자인 하단 바).
  // 컨트롤러도 이 하단 바를 그대로 쓴다 — 바뀌는 것은 위쪽(트레이 → 컨트롤러 패드)뿐이다.
  const actions = (
    <GamePlayActions
      activePlayerName={activePlayer?.nickname}
      canReleaseAll={canReleaseAll}
      canRoll={canRoll}
      isMyTurn={isMyTurn}
      onReleaseAll={releaseAll}
      onRoll={handleRoll}
      rolling={rolling}
      submitted={submitted}
      submitting={submitting}
      wide={wide}
    />
  )

  const scoreSheet = (className: string, header?: ReactNode) => (
    <ScoreSheet
      activePlayerId={activePlayerId}
      candidates={candidates}
      canPick={canPick}
      className={className}
      // 넓은 화면에서만 이 표가 "족보를 보는 곳"이다. 좁은 화면에서는 접혀 있어서 연습 모드가
      // 손잡이(sheet-handle)를 가리키고, 기록은 퀵 칩 줄(sheet)로 안내한다.
      {...(wide ? { 'data-tutorial': 'sheet' } : {})}
      header={header}
      leverageCategory={leverageCategory}
      onPick={pickCategory}
      players={sheetPlayers}
      you={session.you}
    />
  )

  const activePlayerName = activePlayer?.nickname
  const sheetHint = scoreSheetHint(isMyTurn, rolled, activePlayerName)
  const recordTitle = scoreRecordTitle(isMyTurn, activePlayerName)

  return (
    <>
      {/*
        레이아웃이 바뀌어도 트리 한 벌만 쓴다. 넓이별로 다른 트리를 반환하면
        React가 위치가 같고 타입이 다른 노드를 갈아끼우면서 주사위 영역을 언마운트하고,
        그때마다 rapier 물리 월드와 WebGL 컨텍스트가 통째로 재생성된다.
      */}
      <GamePlayBoard
        actions={actions}
        connectionStatus={connectionStatus}
        diceScene={diceScene}
        guideOverlay={guide?.({
          rolled,
          keptValues: local.dice ? local.dice.filter((_value, index) => local.held[index]) : [],
          rolling,
          submitted,
          rollCount: local.rollCount,
          candidates,
          motionNoticeVisible: canOfferMotion(roll.motion.availability),
          wide,
        })}
        header={header}
        onSheetToggle={setSheetOpen}
        openCount={openCategories.length}
        players={snapshot.players}
        quickStrip={quickStrip}
        recordTitle={recordTitle}
        scoreSheet={scoreSheet}
        sheetHint={sheetHint}
        sheetOpen={sheetOpen}
        turnStrip={turnStrip}
        wide={wide}
      />

      <ToastHost message={toastMessage} />
      <AudioPopover
        anchorRef={audioButtonRef}
        microphone={
          voice.status === 'unsupported'
            ? undefined
            : {
                connectedPeers: voice.peers.length,
                denied: voice.status === 'denied',
                on: voice.status === 'on',
                onToggle: voice.toggle,
                requesting: voice.status === 'requesting',
              }
        }
        muted={soundMuted}
        onClose={() => setAudioOpen(false)}
        onToggleMute={toggleSound}
        open={audioOpen}
      />
      {zeroModal}
      <GameHelpModal onClose={() => setHelpOpen(false)} open={helpOpen} />
    </>
  )
}

/**
 * 마감 처리는 서버가 한다 — 남은 굴림이 있으면 대신 굴리고, 다 쓰면 남은 족보 중 하나를 기록한 뒤
 * 턴을 넘긴다(RoundTimeoutResolver). 클라이언트가 같은 일을 하면 두 경로가 경합하면서 어느 쪽도
 * 기록되지 않는 창이 생기므로 여기서는 아무것도 하지 않는다.
 */
