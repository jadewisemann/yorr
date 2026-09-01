/**
 * 전적 보관의 공개 표면. 배선(`server.ts`)과 탁구 AI 결과 REST는 여기만
 * import한다 — 내부 파일 경로에 의존하지 않는다(`game/completion/index.ts`와 같은 규약).
 *
 * `MatchArchiveService`는 2.7의 `MatchArchivePort`를 구조적으로 만족한다:
 * `server.ts`의 `noopMatchArchive` 자리에 그대로 들어간다.
 */
export { type MatchArchiveInput, MatchArchiveService } from './matchArchiveService.js'
export {
  type MatchArchiveStore,
  type MatchRecord,
  MysqlMatchArchiveStore,
} from './matchArchiveStore.js'
