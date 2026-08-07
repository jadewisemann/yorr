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

export function useAsyncTask<TArgs extends unknown[], TData>(
  task: (signal: AbortSignal, ...args: TArgs) => Promise<TData>,
  options: AsyncTaskOptions<TData> = {},
) {
  const [state, setState] = useState<AsyncState<TData>>(initialState)
  const taskRef = useRef(task)
  const onSuccessRef = useRef(options.onSuccess)
  const controllerRef = useRef<AbortController | null>(null)

  useLayoutEffect(() => {
    taskRef.current = task
    onSuccessRef.current = options.onSuccess
  })

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
