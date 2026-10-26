/**
 * 게이트웨이가 쓰는 로거 표면. 테스트는 침묵 구현을 주입한다.
 */
export interface WsLogger {
  info(payload: unknown, message?: string): void
  warn(payload: unknown, message?: string): void
  error(payload: unknown, message?: string): void
}

export const silentLogger: WsLogger = { info: () => {}, warn: () => {}, error: () => {} }
