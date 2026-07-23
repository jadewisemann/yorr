import { setupWorker } from 'msw/browser'
import { createRestHandlers } from './restHandlers'

export const mockApiWorker = setupWorker(...createRestHandlers())
