import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAsyncTask, useFetchEffect } from '@/shared/api/useAsyncTask'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
  signal: AbortSignal
}

/** 진행 중인 요청 구간을 테스트가 직접 제어할 수 있게 만든 task. */
function createControllableTask<T>() {
  const pending: Deferred<T>[] = []
  const task = (signal: AbortSignal) => {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    pending.push({ promise, resolve, reject, signal })
    return promise
  }
  return { pending, task }
}

describe('useAsyncTask', () => {
  it('idle → loading → success 순서로 상태를 옮기고 onSuccess를 한 번 부른다', async () => {
    const onSuccess = vi.fn()
    const { pending, task } = createControllableTask<string>()
    const { result } = renderHook(() => useAsyncTask<[], string>(task, { onSuccess }))

    expect(result.current.isIdle).toBe(true)

    let execution: Promise<string | undefined> | undefined
    act(() => {
      execution = result.current.execute()
    })
    expect(result.current.isLoading).toBe(true)

    await act(async () => {
      pending[0]?.resolve('결과')
      await execution
    })

    expect(result.current.isSuccess).toBe(true)
    expect(result.current.data).toBe('결과')
    expect(result.current.error).toBeNull()
    expect(onSuccess).toHaveBeenCalledExactlyOnceWith('결과')
  })

  it('실패하면 error 상태로 남기고 onSuccess는 부르지 않는다', async () => {
    const onSuccess = vi.fn()
    const { pending, task } = createControllableTask<string>()
    const { result } = renderHook(() => useAsyncTask<[], string>(task, { onSuccess }))

    await act(async () => {
      const execution = result.current.execute()
      pending[0]?.reject(new Error('서버 오류'))
      await execution
    })

    expect(result.current.isError).toBe(true)
    expect(result.current.error?.message).toBe('서버 오류')
    expect(result.current.data).toBeNull()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('Error가 아닌 거부 이유도 Error로 감싼다', async () => {
    const { pending, task } = createControllableTask<string>()
    const { result } = renderHook(() => useAsyncTask<[], string>(task))

    await act(async () => {
      const execution = result.current.execute()
      pending[0]?.reject('문자열 거부')
      await execution
    })

    expect(result.current.error?.message).toBe('Unknown API error')
  })

  it('새 요청은 앞선 요청을 중단하고, 중단된 요청의 성공·실패는 상태에 반영하지 않는다', async () => {
    const { pending, task } = createControllableTask<string>()
    const { result } = renderHook(() => useAsyncTask<[], string>(task))

    let first: Promise<string | undefined> | undefined
    let second: Promise<string | undefined> | undefined
    await act(async () => {
      first = result.current.execute()
      second = result.current.execute()
      pending[0]?.resolve('낡은 결과')
      pending[1]?.resolve('최신 결과')
      await Promise.all([first, second])
    })

    expect(pending[0]?.signal.aborted).toBe(true)
    expect(await first).toBeUndefined()
    expect(await second).toBe('최신 결과')
    expect(result.current.data).toBe('최신 결과')

    // 중단된 요청이 뒤늦게 실패해도 최신 성공 상태를 덮지 않는다.
    let third: Promise<string | undefined> | undefined
    await act(async () => {
      third = result.current.execute()
      result.current.execute()
      pending[2]?.reject(new Error('낡은 실패'))
      pending[3]?.resolve('그 다음 결과')
      await Promise.all([third, pending[3]?.promise])
    })

    expect(await third).toBeUndefined()
    expect(result.current.isError).toBe(false)
    expect(result.current.data).toBe('그 다음 결과')
  })

  it('reset은 진행 중인 요청을 중단하고 idle로 되돌린다', async () => {
    const { pending, task } = createControllableTask<string>()
    const { result } = renderHook(() => useAsyncTask<[], string>(task))

    await act(async () => {
      const execution = result.current.execute()
      pending[0]?.resolve('결과')
      await execution
    })
    expect(result.current.isSuccess).toBe(true)

    act(() => {
      result.current.reset()
    })

    expect(result.current.isIdle).toBe(true)
    expect(result.current.data).toBeNull()
  })

  it('언마운트되면 진행 중인 요청을 중단하고 상태를 갱신하지 않는다', async () => {
    const { pending, task } = createControllableTask<string>()
    const { result, unmount } = renderHook(() => useAsyncTask<[], string>(task))

    let execution: Promise<string | undefined> | undefined
    act(() => {
      execution = result.current.execute()
    })
    unmount()

    pending[0]?.resolve('버려질 결과')

    expect(pending[0]?.signal.aborted).toBe(true)
    await expect(execution).resolves.toBeUndefined()
  })

  it('execute는 렌더가 반복돼도 같은 함수 참조를 유지한다', () => {
    const { pending: _pending, task } = createControllableTask<string>()
    const { result, rerender } = renderHook(() => useAsyncTask<[], string>(task))
    const firstExecute = result.current.execute

    rerender()

    expect(result.current.execute).toBe(firstExecute)
  })
})

describe('useFetchEffect', () => {
  it('queryKey가 있으면 즉시 조회하고, key가 바뀌면 다시 조회한다', async () => {
    const query = vi.fn(async () => 'A')
    const { result, rerender } = renderHook(
      ({ key }: { key: string | null }) => useFetchEffect(key, query),
      { initialProps: { key: 'game:1' as string | null } },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(query).toHaveBeenCalledOnce()

    rerender({ key: 'game:2' })

    await waitFor(() => expect(query).toHaveBeenCalledTimes(2))
  })

  it('queryKey가 null이면 조회하지 않고 이전 결과를 비운다', async () => {
    const query = vi.fn(async () => 'A')
    const { result, rerender } = renderHook(
      ({ key }: { key: string | null }) => useFetchEffect(key, query),
      { initialProps: { key: 'game:1' as string | null } },
    )
    await waitFor(() => expect(result.current.data).toBe('A'))

    rerender({ key: null })

    await waitFor(() => expect(result.current.isIdle).toBe(true))
    expect(result.current.data).toBeNull()
    expect(query).toHaveBeenCalledOnce()
  })

  it('refetch로 같은 key를 다시 조회할 수 있다', async () => {
    const query = vi.fn(async () => 'A')
    const { result } = renderHook(() => useFetchEffect('game:1', query))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    await act(async () => {
      await result.current.refetch()
    })

    expect(query).toHaveBeenCalledTimes(2)
  })
})
