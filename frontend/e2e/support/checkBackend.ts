const DEPLOYED_DEV_ORIGIN = 'https://i15a406.p.ssafy.io'

export default async function checkBackend() {
  const origin = process.env.VITE_BACKEND_ORIGIN || DEPLOYED_DEV_ORIGIN
  const apiPrefix = origin === DEPLOYED_DEV_ORIGIN ? '/dev-api' : '/api'
  const probeUrl = `${origin}${apiPrefix}/v1/rooms`

  try {
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
