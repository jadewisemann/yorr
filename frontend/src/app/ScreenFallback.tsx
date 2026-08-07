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
