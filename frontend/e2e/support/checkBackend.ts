/**
 * real 모드 globalSetup — 백엔드가 안 떠 있으면 스펙 30개가 전부 타임아웃으로
 * 죽는 대신, 시작 전에 원인과 해결 방법을 한 문장으로 알려주고 즉시 실패한다.
 */

// vite.config.ts 의 proxy 와 같은 규칙: 배포 dev 서버만 /dev-api 접두어를 쓴다.
const DEPLOYED_DEV_ORIGIN = 'https://i15a406.p.ssafy.io'

export default async function checkBackend() {
  const origin = process.env.VITE_BACKEND_ORIGIN || DEPLOYED_DEV_ORIGIN
  const apiPrefix = origin === DEPLOYED_DEV_ORIGIN ? '/dev-api' : '/api'
  const probeUrl = `${origin}${apiPrefix}/v1/rooms`

  try {
    // 4xx 라도 응답이 오면 서버는 떠 있는 것이다. 연결 실패만 미기동으로 본다.
    await fetch(probeUrl, { method: 'POST', signal: AbortSignal.timeout(5_000) })
  } catch {
    const guidance =
      origin === DEPLOYED_DEV_ORIGIN
        ? [
            '배포 dev 서버가 내려간 상태면 로컬 백엔드로 우회할 수 있습니다:',
            '  cd backend && docker compose up -d && ./gradlew bootRun',
            '  VITE_BACKEND_ORIGIN=http://localhost:8080 npm run test:e2e:real',
          ]
        : ['로컬 백엔드를 먼저 띄우세요: cd backend && docker compose up -d && ./gradlew bootRun']

    throw new Error(
      [`real E2E 를 시작할 수 없습니다: 백엔드(${origin})가 응답하지 않습니다.`, ...guidance].join(
        '\n',
      ),
    )
  }
}
