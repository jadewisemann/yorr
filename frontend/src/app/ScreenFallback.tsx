/**
 * 화면 청크를 받는 동안 잠깐 서는 자리.
 *
 * 랜딩 말고는 전부 지연 로드라, 방으로 들어가는 순간 이 화면이 한 번 스친다.
 * index.html의 인라인 스플래시와 같은 모양이어야 "다른 화면으로 튀었다"로 보이지 않는다.
 */
export function ScreenFallback() {
  return (
    <div aria-busy="true" className="grid h-svh w-full place-items-center bg-canvas" role="status">
      <span className="sr-only">불러오는 중</span>
      <span
        aria-hidden="true"
        className="size-8 animate-spin-slow rounded-full border-2 border-content/25 border-t-content motion-reduce:animate-none"
      />
    </div>
  )
}
