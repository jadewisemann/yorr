/**
 * 굴림 요청 하나가 <b>시작·쏟기·완료를 각각 한 번만</b> 하도록 기억한다.
 *
 * 왜 필요한가: 같은 요청이 두 경로로 도착한다. 월드가 이미 서 있으면 props 변화를 보는
 * effect가 처리하고, 아직 로드 중이었으면 월드가 만들어진 직후 최신 상태를 replay하면서
 * 처리한다. 둘 다 도는 경우가 있어서 — 늦게 도착한 굴림이 그렇다 — 표시를 남기지 않으면
 * `startRoll`이 두 번 불려 주사위가 다시 튀고, `pour`가 두 번 불리면 두 번 쏟아진다.
 *
 * 월드를 인자로 받지 않는다. "무엇을 할지"는 호출부가 클로저로 주고 여기서는 "이미 했는가"만
 * 판단한다 — 그래야 이 파일이 three.js·rapier를 전혀 모른 채 단위 테스트된다.
 */
export function createRollRequestLedger() {
  const started = new Set<string>()
  const released = new Set<string>()
  const completed = new Set<string>()

  const once = (seen: Set<string>, requestId: string, run: () => void) => {
    if (seen.has(requestId)) return false
    seen.add(requestId)
    run()
    return true
  }

  return {
    /** 굴림을 시작한다. 이미 시작했으면 아무것도 하지 않고 false. */
    startOnce: (requestId: string, start: () => void) => once(started, requestId, start),
    /** 주사위를 쏟는다. 이미 쏟았으면 아무것도 하지 않고 false. */
    releaseOnce: (requestId: string, release: () => void) => once(released, requestId, release),
    /** 완료를 알린다. 이미 알렸으면 아무것도 하지 않고 false. */
    completeOnce: (requestId: string, complete: () => void) => once(completed, requestId, complete),
  }
}

export type RollRequestLedger = ReturnType<typeof createRollRequestLedger>
