/**
 * 컨테이너 크기 변화를 **가라앉은 뒤에** 반영한다.
 *
 * 그냥 매번 반영하지 않는 이유: 모바일에서 주소창이 접히거나 화면을 돌리면 크기가
 * 수십 프레임에 걸쳐 조금씩 바뀐다. 그때마다 렌더러를 다시 잡으면 굴림 중에 눈에
 * 띄게 끊긴다. 그래서 **작은 변화는 즉시**, 큰 변화는 180ms 조용해질 때까지 미룬다.
 */
const SETTLE_THRESHOLD_PX = 120
const SETTLE_DELAY_MS = 180

export class ResizeSettler {
  private timer: ReturnType<typeof setTimeout> | null = null
  private appliedWidth = 0
  private appliedHeight = 0

  constructor(
    private readonly options: {
      readonly container: HTMLElement
      /** 파괴된 뒤의 늦은 콜백을 걸러 낸다. */
      readonly isActive: () => boolean
      /** 실제 반영. 끝나면 `markApplied`가 함께 불린다. */
      readonly apply: () => void
      /** 미루는 동안 화면에 알린다(굴림을 잠시 멈춘다). */
      readonly onPending: (pending: boolean) => void
      /** 미뤘던 반영이 끝난 뒤 — 프레임 시계를 다시 맞추는 자리다. */
      readonly onSettled: () => void
    },
  ) {}

  /** 반영이 끝난 크기를 기록한다. 다음 변화량은 이 값과의 차이로 잰다. */
  markApplied(width: number, height: number): void {
    this.appliedWidth = width
    this.appliedHeight = height
  }

  queue(): void {
    if (!this.options.isActive()) return
    const width = Math.max(1, this.options.container.clientWidth)
    const height = Math.max(1, this.options.container.clientHeight)
    const delta = Math.max(
      Math.abs(width - this.appliedWidth),
      Math.abs(height - this.appliedHeight),
    )
    if (delta === 0) return
    if (delta <= SETTLE_THRESHOLD_PX && this.timer === null) {
      this.options.apply()
      return
    }
    this.options.onPending(true)
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      if (!this.options.isActive()) return
      this.timer = null
      this.options.apply()
      this.options.onSettled()
      this.options.onPending(false)
    }, SETTLE_DELAY_MS)
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }
}
