import { MotionGestureRecognizer } from './MotionGestureRecognizer'
import { MOTION_SAMPLE_SILENT_MS } from './motionConfig'
import type { MotionAvailability, MotionGestureEvent, MotionGestureSnapshot } from './motionTypes'
import { MotionSampleNormalizer } from './normalizeMotionSample'

type PermissionResult = 'granted' | 'denied'

interface PermissionAwareDeviceMotionEvent {
  requestPermission?: () => Promise<PermissionResult>
}

export interface MotionInputControllerCallbacks {
  onAvailabilityChange(availability: MotionAvailability): void
  onGestureEvent(event: MotionGestureEvent): void
  onGestureSnapshot(snapshot: MotionGestureSnapshot): void
}

export class MotionInputController {
  private availability: MotionAvailability = 'unknown'
  private callbacks: MotionInputControllerCallbacks
  private destroyed = false
  private lastSnapshot: MotionGestureSnapshot | null = null
  private listening = false
  private normalizer = new MotionSampleNormalizer()
  private recognizer = new MotionGestureRecognizer()
  private silentTimer: ReturnType<typeof setTimeout> | null = null

  constructor(callbacks: MotionInputControllerCallbacks) {
    this.callbacks = callbacks
  }

  start() {
    if (this.destroyed) return
    if (!('DeviceMotionEvent' in window)) {
      this.setAvailability('unsupported')
      return
    }
    if (window.isSecureContext === false) {
      this.setAvailability('insecure')
      return
    }
    this.setAvailability('permissionRequired')
  }

  async requestPermission() {
    const requestPermission = getPermissionRequest()
    if (!requestPermission) {
      this.listen()
      return
    }

    this.setAvailability('requesting')
    try {
      const result = await requestPermission()
      if (this.destroyed) return
      if (result !== 'granted') {
        this.setAvailability('denied')
        return
      }
      this.listen()
    } catch {
      if (this.destroyed) return
      this.setAvailability('error')
    }
  }

  reset(reason = 'reset') {
    const event = this.recognizer.reset(reason)
    this.normalizer.reset()
    if (event) this.callbacks.onGestureEvent(event)
    this.emitSnapshot()
  }

  destroy() {
    this.destroyed = true
    this.stopListening()
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
    this.normalizer.reset()
    this.recognizer.reset('destroy')
  }

  private listen() {
    if (this.destroyed || this.listening) return
    this.listening = true
    window.addEventListener('devicemotion', this.handleMotion)
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
    this.setAvailability(document.hidden ? 'paused' : 'listening')
    this.armSilentTimer()
  }

  private stopListening() {
    if (!this.listening) return
    this.listening = false
    window.removeEventListener('devicemotion', this.handleMotion)
    if (this.silentTimer) clearTimeout(this.silentTimer)
    this.silentTimer = null
  }

  private handleMotion = (event: DeviceMotionEvent) => {
    if (document.hidden) return
    const sample = this.normalizer.push(event)
    if (!sample) return
    this.setAvailability('listening')
    this.armSilentTimer()
    for (const gestureEvent of this.recognizer.push(sample)) {
      this.callbacks.onGestureEvent(gestureEvent)
    }
    this.emitSnapshot()
  }

  private handleVisibilityChange = () => {
    if (document.hidden) {
      this.setAvailability('paused')
      this.reset('background')
      return
    }
    this.setAvailability('listening')
    this.armSilentTimer()
  }

  private armSilentTimer() {
    if (this.silentTimer) clearTimeout(this.silentTimer)
    this.silentTimer = setTimeout(() => {
      if (!document.hidden && this.listening) this.setAvailability('silent')
    }, MOTION_SAMPLE_SILENT_MS)
  }

  private setAvailability(availability: MotionAvailability) {
    if (availability === this.availability) return
    this.availability = availability
    this.callbacks.onAvailabilityChange(availability)
  }

  private emitSnapshot() {
    const next = this.recognizer.getSnapshot()
    if (this.lastSnapshot && snapshotsEqual(this.lastSnapshot, next)) return
    this.lastSnapshot = next
    this.callbacks.onGestureSnapshot(next)
  }
}

function getPermissionRequest() {
  const deviceMotionApi = window.DeviceMotionEvent as unknown as PermissionAwareDeviceMotionEvent
  return typeof deviceMotionApi.requestPermission === 'function'
    ? deviceMotionApi.requestPermission.bind(deviceMotionApi)
    : null
}

function snapshotsEqual(left: MotionGestureSnapshot, right: MotionGestureSnapshot) {
  return (
    left.calibrated === right.calibrated &&
    left.canConfirmThrow === right.canConfirmThrow &&
    left.gestureState === right.gestureState &&
    left.lastPulseDirection === right.lastPulseDirection &&
    left.noiseRms === right.noiseRms &&
    left.reversalCount === right.reversalCount &&
    left.effectiveThresholds.shakeMinRms === right.effectiveThresholds.shakeMinRms &&
    left.effectiveThresholds.shakePeak === right.effectiveThresholds.shakePeak &&
    left.effectiveThresholds.shakePeakRelease === right.effectiveThresholds.shakePeakRelease &&
    left.effectiveThresholds.throwImpulse === right.effectiveThresholds.throwImpulse &&
    left.effectiveThresholds.throwJerk === right.effectiveThresholds.throwJerk &&
    left.effectiveThresholds.throwPeak === right.effectiveThresholds.throwPeak
  )
}
