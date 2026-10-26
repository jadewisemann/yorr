/**
 * 인증 헤더 조회 — 방·퀵매치·조회 REST가 같은 규칙을 쓴다.
 *
 * Fastify는 같은 이름의 헤더가 여러 번 오면 **배열**로 넘긴다. 이 API들은 첫 값만
 * 보므로 여기서 한 번만 풀고, 라우트마다 같은 3줄을 반복하지 않는다.
 */
export const header = (
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined => {
  const value = headers[name]
  return Array.isArray(value) ? value[0] : value
}
