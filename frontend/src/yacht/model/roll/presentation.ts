import type { RollAnimationMode, RollInputMode } from './animation'

export interface RollPresentation {
  inputMode: RollAnimationMode | null
  releaseRequestId: string | null
  remoteShaking: boolean
  requesting: boolean
}

export type RollPresentationAction =
  | { type: 'requested'; inputMode: RollInputMode }
  | { type: 'requestFailed' }
  | { type: 'broadcastAccepted'; mode: RollAnimationMode }
  | { type: 'released'; requestId: string }
  | { type: 'remoteShakeStarted' }
  | { type: 'completed' }
  | { type: 'turnReset' }

export const IDLE_ROLL_PRESENTATION: RollPresentation = {
  inputMode: null,
  releaseRequestId: null,
  remoteShaking: false,
  requesting: false,
}

export function rollPresentationReducer(
  state: RollPresentation,
  action: RollPresentationAction,
): RollPresentation {
  switch (action.type) {
    case 'requested':
      return { ...state, inputMode: action.inputMode, releaseRequestId: null, requesting: true }
    case 'requestFailed':
      return { ...state, inputMode: null, requesting: false }
    case 'completed':
      return { ...state, inputMode: null, releaseRequestId: null, requesting: false }
    case 'broadcastAccepted':
      return {
        inputMode: action.mode,
        releaseRequestId: null,
        remoteShaking: false,
        requesting: false,
      }
    case 'released':
      return { ...state, releaseRequestId: action.requestId }
    case 'remoteShakeStarted':
      return { ...state, remoteShaking: true }
    case 'turnReset':
      return IDLE_ROLL_PRESENTATION
  }
}
