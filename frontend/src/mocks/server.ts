import { setupServer } from 'msw/node'
import { createRestHandlers } from './restHandlers'

export const mockApiServer = setupServer(...createRestHandlers())
