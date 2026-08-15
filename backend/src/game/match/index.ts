/**
 * 전적 보관의 공개 표면. 배선(`server.ts`)과 탁구 AI 결과 REST는 여기만
 * import한다 — 내부 파일 경로에 의존하지 않는다.
 *
 * `MatchArchiveService`는 게임 종료의 `MatchArchivePort`를 구조적으로 만족한다.
 */
export {
  type MatchArchiveInput,
  MatchArchiveService,
} from './matchArchiveService.js'
export {
  type MatchArchiveStore,
  type MatchRecord,
  MysqlMatchArchiveStore,
} from './matchArchiveStore.js'
