import { crc32 } from 'node:zlib'

/**
 * Flyway가 마이그레이션 파일에 붙이는 체크섬을 **같은 값으로** 계산한다 — ADR-0005.
 *
 * Flyway(`ChecksumCalculator`)는 파일을 `BufferedReader`로 한 줄씩 읽어 **줄
 * 종결자를 뺀** 각 줄의 UTF-8 바이트로 CRC32를 갱신하고, 결과를 signed int로
 * 잘라 `flyway_schema_history.checksum`(INT)에 넣는다. 그래서
 *
 * - `\n` · `\r\n` · `\r` 차이는 체크섬에 영향이 없고(줄 종결자는 빠진다),
 * - 파일 끝의 개행 유무도 영향이 없으며,
 * - 첫 줄의 BOM은 제거된다.
 *
 * 이 함수가 Flyway와 1비트라도 다르면 Java 쪽 Flyway가 부팅 시
 * `validateOnMigrate`에서 checksum mismatch로 죽는다 — 전환기에 두 백엔드가 같은
 * 이력 테이블을 보기 때문이다. 계약이므로 값을 고정한 단위 테스트가 있다.
 */
export const flywayChecksum = (content: string): number => {
  // BufferedReader.readLine()과 같은 분할: 종결자는 결과에 포함되지 않는다.
  const lines = content.split(/\r\n|\n|\r/)
  const first = lines[0]
  if (first?.startsWith('\uFEFF')) lines[0] = first.slice(1)
  // 줄들을 이어 붙인 바이트열의 CRC32 = 줄마다 update한 CRC32(스트리밍 함수).
  return crc32(Buffer.from(lines.join(''), 'utf8')) | 0
}
