import { ApiError } from './client'

export interface UserError {
  message: string
  canChangeRoom: boolean
  clearsSession: boolean
}

const apiErrors: Record<string, UserError> = {
  ROOM_NOT_FOUND: {
    message: '존재하지 않거나 더 이상 사용할 수 없는 방이에요.',
    canChangeRoom: true,
    clearsSession: false,
  },
  ROOM_FULL: {
    message: '방이 가득 찼어요. 다른 초대 코드로 참가해 주세요.',
    canChangeRoom: true,
    clearsSession: false,
  },
  GAME_ALREADY_STARTED: {
    message: '이미 게임이 시작된 방에는 참가할 수 없어요.',
    canChangeRoom: true,
    clearsSession: false,
  },
  ALREADY_IN_ROOM: {
    message: '이미 참여 중인 방이 있어요. 그 방에서 나온 뒤 다시 시도해 주세요.',
    canChangeRoom: false,
    clearsSession: false,
  },
  UNAUTHORIZED: {
    message: '로그인 정보가 만료됐어요. 다시 로그인해 주세요.',
    canChangeRoom: false,
    clearsSession: false,
  },
  QUICK_MATCH_NOT_SUPPORTED: {
    message: '이 게임은 아직 온라인 대전을 지원하지 않아요.',
    canChangeRoom: false,
    clearsSession: false,
  },
  SESSION_EXPIRED: {
    message: '입장 정보가 만료됐어요. 방에 다시 참가해 주세요.',
    canChangeRoom: true,
    clearsSession: true,
  },
  RATE_LIMITED: {
    message: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
    canChangeRoom: false,
    clearsSession: false,
  },
  INTERNAL: {
    message: '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    canChangeRoom: false,
    clearsSession: false,
  },
}

export function toUserError(error: Error): UserError {
  const knownError = error instanceof ApiError && error.code ? apiErrors[error.code] : undefined
  if (knownError) {
    return knownError
  }

  if (!(error instanceof ApiError)) {
    return {
      message: '네트워크 연결을 확인하고 다시 시도해 주세요.',
      canChangeRoom: false,
      clearsSession: false,
    }
  }

  return {
    message: '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.',
    canChangeRoom: false,
    clearsSession: false,
  }
}
