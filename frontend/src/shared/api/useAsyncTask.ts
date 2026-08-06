import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error'

interface AsyncState<TData> {
  data: TData | null
  error: Error | null
  status: AsyncStatus
}

interface AsyncTaskOptions<TData> {
  onSuccess?: (data: TData) => void
}

const initialState = {
  data: null,
  error: null,
  status: 'idle',
} as const

/**
 * 호출부가 직접 실행하는 비동기 작업 하나의 상태. 새 실행은 이전 실행을 중단한다.
 */
export function useAsyncTask<TArgs extends unknown[], TData>(
  task: (signal: AbortSignal, ...args: TArgs) => Promise<TData>,
  options: AsyncTaskOptions<TData> = {},
) {
  const [state, setState] = useState<AsyncState<TData>>(initialState)
  const taskRef = useRef(task)
  const onSuccessRef = useRef(options.onSuccess)
  const controllerRef = useRef<AbortController | null>(null)

  // execute는 이벤트 경로에서 호출되므로 useEffectEvent를 쓸 수 없다(Effect Event는 effect
  // 안에서만 호출할 수 있다). 최신 값을 ref로 넘기되, 대입은 렌더가 아니라 커밋 뒤에 한다.
  useLayoutEffect(() => {
    taskRef.current = task
    onSuccessRef.current = options.onSuccess
  })

  // 언마운트되면 진행 중인 요청을 끊는다. 끊긴 실행은 아래에서 signal.aborted로 걸러지므로
  // "마운트되어 있나" 플래그를 따로 두지 않는다 — abort가 그 역할을 이미 한다.
  useEffect(() => () => controllerRef.current?.abort(), [])

  const execute = useCallback(async (...args: TArgs) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setState({ data: null, error: null, status: 'loading' })

    try {
      const data = await taskRef.current(controller.signal, ...args)
      if (controller.signal.aborted) return undefined

      setState({ data, error: null, status: 'success' })
      onSuccessRef.current?.(data)
      return data
    } catch (error) {
      if (controller.signal.aborted) return undefined

      setState({ data: null, error: toError(error), status: 'error' })
      return undefined
    }
  }, [])

  const reset = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setState(initialState)
  }, [])

  return {
    ...state,
    execute,
    reset,
    isIdle: state.status === 'idle',
    isLoading: state.status === 'loading',
    isSuccess: state.status === 'success',
    isError: state.status === 'error',
  }
}

/**
 * `key`가 바뀔 때마다 요청을 한 번 건다. `key`가 null이면 걸지 않고 상태를 비운다.
 *
 * **캐시도 중복 제거도 하지 않는다** — 같은 key를 두 컴포넌트가 쓰면 요청도 두 번 나간다.
 * 이 앱에서 진행 상태의 권위자는 WebSocket이고 REST는 새로고침·직접 진입용 백필이라,
 * 캐시를 두면 스토어와 캐시 둘 중 누가 맞는지가 화면마다 갈린다. 그래서 이름이 `Query`가
 * 아니다 — 이건 조회 계층이 아니라 effect다.
 */
export function useFetchEffect<TData>(
  key: string | null,
  request: (signal: AbortSignal) => Promise<TData>,
  options: AsyncTaskOptions<TData> = {},
) {
  const task = useAsyncTask<[], TData>(request, options)
  const { execute, reset } = task

  useEffect(() => {
    if (key === null) {
      reset()
      return
    }

    void execute()
  }, [execute, key, reset])

  return { ...task, refetch: execute }
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error('Unknown API error')
}
