<<<<<<< HEAD:frontend/src/features/entry/EntryPage.tsx
import styles from './EntryPage.module.css'
=======
import { useCreateRoom } from '@/api/useRoomApi'
import { Button } from '@/components/Button'
>>>>>>> 96e7252d9d23d7d509ed4819e8180e49c884c7c8:frontend/src/screens/EntryPage.tsx

export function EntryPage() {
  const createRoom = useCreateRoom()

  const handleStart = () => {
    void createRoom.execute({ mode: 'party', gameType: 'yacht' })
  }

  return (
<<<<<<< HEAD:frontend/src/features/entry/EntryPage.tsx
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>REAL-TIME YACHT DICE</p>
        <h1>YORR</h1>
        <p>흔들거나 탭해서 함께 즐기는 모바일 요트다이스</p>
        <button type="button">게임 시작</button>
=======
    <main className="grid min-h-dvh place-items-center px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <section className="grid w-full max-w-lg gap-4 text-center">
        <p className="m-0 text-xs font-bold tracking-[0.16em] text-brand-strong">
          REAL-TIME YACHT DICE
        </p>
        <h1 className="m-0 text-[clamp(4rem,24vw,8rem)] leading-[0.9] font-bold tracking-[-0.08em] text-brand">
          YORR
        </h1>
        <p className="m-0 text-content-muted">흔들거나 탭해서 함께 즐기는 모바일 요트다이스</p>
        <Button
          className="mt-4 w-full rounded-full"
          size="lg"
          loading={createRoom.isLoading}
          onClick={handleStart}
        >
          게임 시작
        </Button>
        <div className="min-h-6 text-sm" aria-live="polite">
          {createRoom.data && `방 ${createRoom.data.roomCode} 생성됨`}
          {createRoom.error && `방 생성 실패: ${createRoom.error.message}`}
        </div>
>>>>>>> 96e7252d9d23d7d509ed4819e8180e49c884c7c8:frontend/src/screens/EntryPage.tsx
      </section>
    </main>
  )
}
