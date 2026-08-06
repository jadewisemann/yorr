import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router'
import { lazy, Suspense, useEffect } from 'react'
import { isGameKey, isPartyGameKey } from '@/games'
import { EntryPage } from '@/landing/screens/EntryPage'
import { QuickMatchOverlay } from '@/room/components/QuickMatchOverlay'
import { getRoomCodeError, normalizeRoomCode } from '@/room/roomCode'
import { useMediaQuery } from '@/shared/useMediaQuery'
import { NotFoundPage } from './NotFoundPage'
import { ScreenFallback } from './ScreenFallback'

/**
 * 랜딩과 404만 초기 청크에 남긴다.
 *
 * 링크·QR로 처음 들어온 사람이 랜딩 한 장을 보려고 GamePlay·주사위 트레이·점수시트까지
 * 전부 내려받고 있었다 — 첫 화면이 늦게 뜨는 가장 큰 원인이다. 방 안 화면들은 실제로
 * 그리로 갈 때 받는다. 로딩 표시는 아래 rootRoute의 Suspense 하나가 담당한다.
 */
const importAuthCallbackPage = () => import('@/auth/screens/AuthCallbackPage')
const importGamePage = () => import('@/room/screens/GamePage')
const importInvalidInvitePage = () => import('@/room/screens/InvalidInvitePage')
const importLobbyPage = () => import('@/room/screens/LobbyPage')
const importNicknamePage = () => import('@/room/screens/NicknamePage')
const importPartyDashboardPage = () => import('@/room/screens/PartyDashboardPage')
const importPartyOnBigScreenPage = () => import('@/room/screens/PartyOnBigScreenPage')
const importPingPongModePage = () => import('@/pingpong/screens/PingPongModePage')

const AuthCallbackPage = lazy(() =>
  importAuthCallbackPage().then((mod) => ({ default: mod.AuthCallbackPage })),
)
const GamePage = lazy(() => importGamePage().then((mod) => ({ default: mod.GamePage })))
const InvalidInvitePage = lazy(() =>
  importInvalidInvitePage().then((mod) => ({ default: mod.InvalidInvitePage })),
)
const LobbyPage = lazy(() => importLobbyPage().then((mod) => ({ default: mod.LobbyPage })))
const NicknamePage = lazy(() => importNicknamePage().then((mod) => ({ default: mod.NicknamePage })))
const PartyDashboardPage = lazy(() =>
  importPartyDashboardPage().then((mod) => ({ default: mod.PartyDashboardPage })),
)
const PartyOnBigScreenPage = lazy(() =>
  importPartyOnBigScreenPage().then((mod) => ({ default: mod.PartyOnBigScreenPage })),
)
const PingPongModePage = lazy(() =>
  importPingPongModePage().then((mod) => ({ default: mod.PingPongModePage })),
)

/**
 * 첫 화면이 그려진 뒤 남는 시간에 나머지 화면 청크를 미리 받아둔다.
 *
 * 코드 분리는 첫 로드를 지키려고 한 것이지, 이동할 때마다 로딩 표시를 보라는 뜻이 아니다.
 * 받아두지 않으면 화면을 옮길 때마다 `ScreenFallback`(전면 스피너)이 한두 프레임 스쳐
 * 전환이 깜빡인다. idle 콜백이라 초기 로드와 경쟁하지 않는다.
 */
function useScreenPrefetch() {
  useEffect(() => {
    const prefetch = () => {
      void importNicknamePage()
      void importLobbyPage()
      void importGamePage()
      void importInvalidInvitePage()
      void importAuthCallbackPage()
      void importPingPongModePage()
    }
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(prefetch, { timeout: 3000 })
      return () => cancelIdleCallback(id)
    }
    const id = setTimeout(prefetch, 2000)
    return () => clearTimeout(id)
  }, [])
}

/**
 * 화면 전환은 <b>브라우저의 View Transitions</b>가 그린다(아래 createAppRouter의
 * `defaultViewTransition`, 연출은 styles/global.css).
 * <p>
 * JS로 두 화면을 겹치는 방법은 이 라우터에서 성립하지 않는다. 나가는 화면을 붙잡아 두면
 * 그 안의 `<Outlet/>`이 이미 바뀐 라우터 상태를 다시 읽어 <b>새 화면</b>을 그리고, 지연
 * 로드 화면이면 그 순간 suspend까지 겹쳐 전면 스피너가 스친다 — 이게 깜빡임의 정체였다.
 * <p>
 * View Transitions는 브라우저가 옛 화면을 <b>비트맵으로 스냅샷</b>해 두고 그 위에 새
 * 화면을 올린다. 스냅샷이라 다시 렌더되지 않으니 stale Outlet 문제가 없고, WebGL
 * 컨텍스트나 rapier 월드가 두 벌 살아나지도 않는다. 미지원 브라우저는 전환 없이 즉시
 * 교체된다 — 깜빡이던 종전 동작보다 낫다.
 */
function ScreenTransition() {
  useScreenPrefetch()

  return (
    <>
      <Suspense fallback={<ScreenFallback />}>
        <Outlet />
      </Suspense>
      {/* 화면 <b>밖</b>에 한 번만 세운다 — 매칭 대기는 닉네임 화면에서 시작해 대기실까지
          이어지므로, 어느 화면에 매달면 이동하는 순간 polling이 끊긴다.
          대기 중이 아니면 아무것도 그리지 않는다. */}
      <QuickMatchOverlay />
    </>
  )
}

const rootRoute = createRootRoute({
  component: ScreenTransition,
  notFoundComponent: NotFoundPage,
})

/**
 * 랜딩. `?game=`이 캐러셀에서 보던 칸을 들고 있어, 게임을 고르고 다른 화면에 갔다가
 * 브라우저 뒤로가기로 돌아오면 그 게임에 그대로 선다 — 예전에는 선택이 화면 안 state에만
 * 있어 무조건 첫 게임으로 리셋됐다.
 * <p>
 * 키를 <b>조건부로</b> 넣는다(`/join`의 party·mode와 같은 이유). 항상 있는 키로 두면 타입상
 * 필수가 되어 `navigate({ to: '/' })`로 랜딩에 복귀하는 화면 일곱 곳이 전부 이 값을 넘겨야 한다.
 */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: (search: Record<string, unknown>) => ({
    ...(isGameKey(search.game) ? { game: search.game } : {}),
  }),
  component: () => {
    const { game } = indexRoute.useSearch()
    return <EntryPage gameKey={game} />
  },
})

const devCatalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/__dev/components',
  component: lazyRouteComponent(() => import('@/app/dev/DevCatalog'), 'DevCatalog'),
})

/** 파티 모드 컨트롤러를 가짜 서버로 굴려 보는 화면. 카탈로그와 같은 DEV 게이트를 쓴다. */
const controllerLabRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/__dev/controller',
  component: lazyRouteComponent(() => import('@/app/dev/ControllerLab'), 'ControllerLab'),
})

// 배포에서 실기기로 센서를 튜닝하는 페이지라 DevCatalog와 달리 DEV 게이트를 두지 않는다.
const motionLabRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/__dev/motion',
  component: lazyRouteComponent(() => import('@/app/dev/MotionLab'), 'MotionLab'),
})

/** 카카오 로그인 콜백. 서버가 일회용 code(또는 실패 사유 error)를 붙여 여기로 돌려보낸다. */
const authCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/callback',
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === 'string' ? search.code : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  component: () => {
    const { code, error } = authCallbackRoute.useSearch()
    return <AuthCallbackPage code={code} error={error} />
  },
})

/**
 * 연습 모드. 실제 플레이 화면을 서버 없이 돌리므로 방 id도 세션도 필요 없다 —
 * 게임 라우트와 달리 아무 조건 없이 바로 들어온다.
 */
const tutorialRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tutorial',
  component: lazyRouteComponent(() => import('@/yacht/screens/TutorialPage'), 'TutorialPage'),
})

/**
 * 레버리지 다이스(S15P11A406-208). 연습 모드와 같은 로컬 판이라 방도 세션도 없이 바로 들어온다.
 * 변형 룰 모드는 이 자리에 한 줄씩 늘어난다 — 랜딩 진입점은 온라인 지원 후에 붙인다.
 */
const leverageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/leverage',
  component: lazyRouteComponent(() => import('@/yacht/screens/LeveragePage'), 'LeveragePage'),
})

const pingPongRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pingpong',
  component: PingPongModePage,
})

const joinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/join',
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === 'string' ? normalizeRoomCode(search.code) : undefined,
    game: isGameKey(search.game) ? search.game : undefined,
    // 파티 모드 대시보드가 띄운 QR에만 붙는다 — 이 링크로 들어온 폰은 컨트롤러가 된다.
    // 키를 조건부로 <b>넣지 않는</b> 이유: `party: false`로 두면 타입이 필수 키가 되어
    // `/join`으로 navigate하는 화면들(EntryPage · InvalidInvitePage · PartyOnBigScreenPage)이
    // 전부 이 값을 넘겨야 한다.
    ...(search.party === '1' ? { party: true as const } : {}),
    // 빠른 대전으로 들어왔는가. 방을 만들지 않고 대기열에 선다(같은 이유로 조건부 키다).
    ...(search.mode === 'quick' ? { mode: 'quick' as const } : {}),
  }),
  component: () => {
    const { code, game, mode, party } = joinRoute.useSearch()
    if (code !== undefined && getRoomCodeError(code)) {
      return <InvalidInvitePage initialCode={code} />
    }
    return <NicknamePage gameKey={game} mode={mode} party={party} roomCode={code} />
  },
})

/**
 * 파티 모드 대시보드. 랜딩에는 wide(≥760px)에서만 진입점이 있으므로, 좁은 화면으로 여기
 * 도달하는 경우는 링크·북마크·기기 회전뿐이다 — 그때는 대시보드를 억지로 그리지 않고
 * 안내 화면으로 받는다(폰의 대시보드는 덜 좋은 경험이 아니라 틀린 경험이다).
 */
const partyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/party',
  validateSearch: (search: Record<string, unknown>) => ({
    // 카탈로그가 정한다 — 게임을 추가할 때 이 줄을 같이 고칠 일이 없어야 한다.
    game: isPartyGameKey(search.game) ? search.game : ('yacht' as const),
  }),
  component: () => {
    const { game } = partyRoute.useSearch()
    const wide = useMediaQuery('(min-width: 760px)')
    return wide ? <PartyDashboardPage gameKey={game} /> : <PartyOnBigScreenPage gameKey={game} />
  },
})

const lobbyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rooms/$roomId/lobby',
  component: () => {
    const { roomId } = lobbyRoute.useParams()
    return <LobbyPage roomId={roomId} />
  },
})

const gameRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rooms/$roomId/game',
  component: () => {
    const { roomId } = gameRoute.useParams()
    return <GamePage roomId={roomId} />
  },
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  tutorialRoute,
  leverageRoute,
  pingPongRoute,
  authCallbackRoute,
  joinRoute,
  partyRoute,
  lobbyRoute,
  gameRoute,
  devCatalogRoute,
  controllerLabRoute,
  motionLabRoute,
])

export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    // 화면 전환 연출의 스위치. 실제 애니메이션은 styles/global.css의
    // ::view-transition-* 규칙이 그린다(이유는 ScreenTransition 주석 참고).
    defaultViewTransition: true,
    ...(history ? { history } : {}),
  })
}

export const router = createAppRouter()

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
