import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { vi } from 'vitest'
import { InAppBrowserGate } from '@/app/InAppBrowserGate'
import { RealtimeSync } from '@/app/RealtimeSync'
import { createAppRouter } from '@/app/router'
import { mockApiServer } from '@/mocks/server'
import { ChatProvider } from '@/realtime/chat/ChatContext'
import { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import type { RoomSession } from '@/room/api/roomApi'
import { useAppStore } from '@/store'

export interface AppHarnessOptions {
  browserApis?: boolean
  initialPath?: string
  realtimeClient?: FakeRealtimeClient
  session?: RoomSession | null
}

interface MockApiErrorOptions {
  code: string
  path: string
  status?: number
  until?: Promise<unknown>
}

export function renderAppHarness(options: AppHarnessOptions = {}) {
  resetAppTestState()
  if (options.session) useAppStore.getState().setRoomSession(options.session)

  const history = createMemoryHistory({
    initialEntries: [options.initialPath ?? '/'],
  })
  const router = createAppRouter(history)
  const realtimeClient = options.realtimeClient ?? new FakeRealtimeClient()
  const user = userEvent.setup()
  const browserApis = options.browserApis ? installBrowserApiMocks() : undefined
  const view = render(
    <InAppBrowserGate>
      <RealtimeSync client={realtimeClient}>
        <ChatProvider>
          <RouterProvider router={router} />
        </ChatProvider>
      </RealtimeSync>
    </InAppBrowserGate>,
  )

  return {
    ...view,
    browserApis,
    realtimeClient,
    router,
    user,
  }
}

export function resetAppTestState() {
  safely(() => useAppStore.getState().reset())
  safely(() => window.sessionStorage.clear())
  safely(() => window.localStorage.clear())
}

export function mockApiError({ code, path, status = 400, until }: MockApiErrorOptions) {
  mockApiServer.use(
    http.post(path, async () => {
      await until
      return HttpResponse.json(
        {
          code,
          message: code,
        },
        { status },
      )
    }),
  )
}

function installBrowserApiMocks() {
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  const shareDescriptor = Object.getOwnPropertyDescriptor(navigator, 'share')
  const writeText = vi.fn(async (_text: string) => undefined)
  const share = vi.fn(async (_data?: ShareData) => undefined)

  defineNavigatorApi('clipboard', { writeText })
  defineNavigatorApi('share', share)

  return {
    share,
    writeText,
    restore() {
      restoreNavigatorApi('clipboard', clipboardDescriptor)
      restoreNavigatorApi('share', shareDescriptor)
    },
  }
}

export function installUserAgentMock(userAgent: string) {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'userAgent')
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  })

  return {
    restore() {
      if (descriptor) {
        Object.defineProperty(navigator, 'userAgent', descriptor)
        return
      }
      Reflect.deleteProperty(navigator, 'userAgent')
    },
  }
}

function safely(action: () => void) {
  try {
    action()
  } catch {}
}

function defineNavigatorApi(name: 'clipboard' | 'share', value: unknown) {
  Object.defineProperty(navigator, name, {
    configurable: true,
    value,
  })
}

function restoreNavigatorApi(name: 'clipboard' | 'share', descriptor?: PropertyDescriptor) {
  if (descriptor) {
    Object.defineProperty(navigator, name, descriptor)
    return
  }
  Reflect.deleteProperty(navigator, name)
}
