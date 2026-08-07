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
    startOnce: (requestId: string, start: () => void) => once(started, requestId, start),
    releaseOnce: (requestId: string, release: () => void) => once(released, requestId, release),
    completeOnce: (requestId: string, complete: () => void) => once(completed, requestId, complete),
  }
}

export type RollRequestLedger = ReturnType<typeof createRollRequestLedger>
