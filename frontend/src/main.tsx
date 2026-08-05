import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/app/App'
import { enableMocking } from '@/mocks/enableMocking'
import '@/styles/global.css'

async function bootstrap() {
  await enableMocking()

  const rootElement = document.getElementById('root')

  if (!rootElement) {
    throw new Error('Root element was not found')
  }

  // index.html의 인라인 스플래시를 걷어낸다. createRoot는 컨테이너를 비우고 시작하므로
  // 남겨두면 첫 렌더에서 저절로 사라지지만, 명시적으로 지워야 "언제 사라지는지"가 코드에 남는다.
  document.getElementById('boot-splash')?.remove()

  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
