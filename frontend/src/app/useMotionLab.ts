import { useCallback, useEffect, useRef, useState } from 'react'
import { MotionGestureRecognizer } from '@/input/MotionGestureRecognizer'
import { MOTION_SAMPLE_SILENT_MS, type MotionGestureConfig } from '@/input/motionConfig'
import type {
  MotionAvailability,
  MotionGestureEvent,
  MotionGestureSnapshot,
} from '@/input/motionTypes'
import { MotionSampleNormalizer } from '@/input/normalizeMotionSample'
import { loadStoredConfig, storeConfig } from './motionLabParams'
import {
  createRecording,
  type MotionRecording,
  type MotionRecordingSample,
} from './motionLabReplay'

export interface LabChartSample {
  at: number
  horizontal: number
  forward: number
}

export interface LabEvent {
  id: number
  event: MotionGestureEvent
  /** 표시용 벽시계 시각 (ms epoch) */
  wallClock: number
}

export interface LabLiveStats {
  horizontal: number
  forward: number
  magnitude: number
  sampleRateHz: number
}

const CHART_WINDOW_MS = 4_000
const UI_THROTTLE_MS = 100
const EVENT_LOG_LIMIT = 200
const RECORDING_LIMIT_MS = 30_000

type PermissionResult = 'granted' | 'denied'

interface PermissionAwareDeviceMotionEvent {
  requestPermission?: () => Promise<PermissionResult>
}

function getPermissionRequest() {
  const deviceMotionApi = window.DeviceMotionEvent as unknown as PermissionAwareDeviceMotionEvent
  return typeof deviceMotionApi.requestPermission === 'function'
    ? deviceMotionApi.requestPermission.bind(deviceMotionApi)
    : null
}

function readOrientationAngle() {
  const screenAngle = window.screen.orientation?.angle
  if (typeof screenAngle === 'number') return screenAngle
  const legacyAngle = (window as Window & { orientation?: number }).orientation
  return typeof legacyAngle === 'number' ? legacyAngle : 0
}

function toVec(value: { x: number | null; y: number | null; z: number | null } | null) {
  if (value === null || value.x === null || value.y === null || value.z === null) return null
  return [value.x, value.y, value.z] as [number, number, number]
}

function appendRecordingSample(
  recording: { samples: MotionRecordingSample[]; startedAt: number },
  event: DeviceMotionEvent,
  angle: number,
) {
  const first = recording.samples[0]
  const elapsed = first === undefined ? 0 : event.timeStamp - recording.startedAt
  recording.samples.push({
    t: elapsed,
    acc: toVec(event.acceleration),
    accG: toVec(event.accelerationIncludingGravity),
    angle,
  })
  if (first === undefined) recording.startedAt = event.timeStamp
  return elapsed
}

function appendChartSample(buffer: LabChartSample[], sample: LabChartSample) {
  buffer.push(sample)
  const cutoff = sample.at - CHART_WINDOW_MS
  while (buffer[0]?.at !== undefined && buffer[0].at < cutoff) buffer.shift()
}

/**
 * MotionInputController와 같은 수명주기 규칙(권한·visibilitychange·silent 타이머)을 따르되,
 * config를 실시간 교체할 수 있고 차트 링버퍼·이벤트 로그·원시 녹화를 함께 관리하는 Lab 전용 훅.
 * 판정 자체는 프로덕션과 동일한 normalizer → recognizer 경로를 쓴다.
 */
export function useMotionLab() {
  const [config, setConfig] = useState(loadStoredConfig)
  const [availability, setAvailability] = useState<MotionAvailability>('unknown')
  const [snapshot, setSnapshot] = useState<MotionGestureSnapshot | null>(null)
  const [stats, setStats] = useState<LabLiveStats>({
    forward: 0,
    horizontal: 0,
    magnitude: 0,
    sampleRateHz: 0,
  })
  const [events, setEvents] = useState<LabEvent[]>([])
  const [isRecording, setIsRecording] = useState(false)
  const [lastRecording, setLastRecording] = useState<MotionRecording | null>(null)

  const configRef = useRef(config)
  const normalizerRef = useRef(new MotionSampleNormalizer())
  const recognizerRef = useRef<MotionGestureRecognizer | null>(null)
  if (recognizerRef.current === null) {
    recognizerRef.current = new MotionGestureRecognizer(config)
  }

  const chartBufferRef = useRef<LabChartSample[]>([])
  const listeningRef = useRef(false)
  const silentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastUiUpdateRef = useRef(0)
  const eventIdRef = useRef(0)
  const recordingRef = useRef<{ samples: MotionRecordingSample[]; startedAt: number } | null>(null)

  const appendEvents = useCallback((gestureEvents: MotionGestureEvent[]) => {
    if (gestureEvents.length === 0) return
    const stamped = gestureEvents.map((event) => {
      eventIdRef.current += 1
      return { id: eventIdRef.current, event, wallClock: Date.now() }
    })
    setEvents((previous) => [...stamped.reverse(), ...previous].slice(0, EVENT_LOG_LIMIT))
  }, [])

  const armSilentTimer = useCallback(() => {
    if (silentTimerRef.current) clearTimeout(silentTimerRef.current)
    silentTimerRef.current = setTimeout(() => {
      if (!document.hidden && listeningRef.current) setAvailability('silent')
    }, MOTION_SAMPLE_SILENT_MS)
  }, [])

  const finishRecording = useCallback(() => {
    const active = recordingRef.current
    recordingRef.current = null
    setIsRecording(false)
    if (!active || active.samples.length === 0) return
    setLastRecording(createRecording(active.samples, new Date().toISOString(), navigator.userAgent))
  }, [])

  const handleMotion = useCallback(
    (event: DeviceMotionEvent) => {
      if (document.hidden) return
      const angle = readOrientationAngle()

      const recording = recordingRef.current
      const recordingElapsed = recording ? appendRecordingSample(recording, event, angle) : 0
      if (recordingElapsed >= RECORDING_LIMIT_MS) finishRecording()

      const sample = normalizerRef.current.push(event, angle)
      if (!sample) return
      setAvailability('listening')
      armSilentTimer()

      const buffer = chartBufferRef.current
      appendChartSample(buffer, {
        at: sample.at,
        horizontal: sample.horizontal,
        forward: sample.forward,
      })

      const recognizer = recognizerRef.current
      if (recognizer) appendEvents(recognizer.push(sample))

      const now = performance.now()
      if (now - lastUiUpdateRef.current >= UI_THROTTLE_MS) {
        lastUiUpdateRef.current = now
        if (recognizer) setSnapshot(recognizer.getSnapshot())
        const recent = buffer.filter((entry) => entry.at >= sample.at - 1_000)
        setStats({
          forward: sample.forward,
          horizontal: sample.horizontal,
          magnitude: sample.magnitude,
          sampleRateHz: recent.length,
        })
      }
    },
    [appendEvents, armSilentTimer, finishRecording],
  )

  const resetPipeline = useCallback(
    (reason: string) => {
      const cancelEvent = recognizerRef.current?.reset(reason)
      normalizerRef.current.reset()
      if (cancelEvent) appendEvents([cancelEvent])
      const recognizer = recognizerRef.current
      if (recognizer) setSnapshot(recognizer.getSnapshot())
    },
    [appendEvents],
  )

  const handleVisibilityChange = useCallback(() => {
    if (document.hidden) {
      setAvailability('paused')
      resetPipeline('background')
      return
    }
    setAvailability('listening')
    armSilentTimer()
  }, [armSilentTimer, resetPipeline])

  const listen = useCallback(() => {
    if (listeningRef.current) return
    listeningRef.current = true
    window.addEventListener('devicemotion', handleMotion)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    setAvailability(document.hidden ? 'paused' : 'listening')
    armSilentTimer()
  }, [armSilentTimer, handleMotion, handleVisibilityChange])

  const requestPermission = useCallback(async () => {
    const permissionRequest = getPermissionRequest()
    if (!permissionRequest) {
      listen()
      return
    }
    setAvailability('requesting')
    try {
      const result = await permissionRequest()
      if (result !== 'granted') {
        setAvailability('denied')
        return
      }
      listen()
    } catch {
      setAvailability('error')
    }
  }, [listen])

  useEffect(() => {
    if (!('DeviceMotionEvent' in window)) {
      setAvailability('unsupported')
      return
    }
    if (window.isSecureContext === false) {
      setAvailability('insecure')
      return
    }
    setAvailability('permissionRequired')

    return () => {
      listeningRef.current = false
      window.removeEventListener('devicemotion', handleMotion)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (silentTimerRef.current) clearTimeout(silentTimerRef.current)
    }
  }, [handleMotion, handleVisibilityChange])

  const applyConfig = useCallback((next: MotionGestureConfig) => {
    configRef.current = next
    setConfig(next)
    storeConfig(next)
    // 재생성으로 즉시 적용 — 워밍업 캘리브레이션이 다시 돈다.
    recognizerRef.current = new MotionGestureRecognizer(next)
    normalizerRef.current.reset()
    setSnapshot(recognizerRef.current.getSnapshot())
  }, [])

  const startRecording = useCallback(() => {
    recordingRef.current = { samples: [], startedAt: 0 }
    setIsRecording(true)
  }, [])

  const clearEvents = useCallback(() => setEvents([]), [])

  return {
    availability,
    snapshot,
    stats,
    events,
    config,
    applyConfig,
    requestPermission,
    chartBufferRef,
    clearEvents,
    isRecording,
    startRecording,
    stopRecording: finishRecording,
    lastRecording,
    loadRecording: setLastRecording,
  }
}
